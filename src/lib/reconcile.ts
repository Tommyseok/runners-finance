import type { BankTxnKind } from "./db-types";

/**
 * 자동대사 — Python `scripts/master-reconcile.py` + `build-reconcile-report.py` TS 포팅.
 * 순수 함수. DB 접근 없음.
 *
 * 분류:
 *  - wash:     잘못입금 환불 (memo ∈ {잘못입금됨, 교회로다시이체함}) — 지출아님
 *  - transfer: 계좌간/모교회 이체 (거래처에 '대한예수교장로회') — 지출아님
 *  - income:   입금行
 *  - expense:  나머지 출금 → 영수증과 매칭
 */

export interface ReconTxn {
  index: number;
  date: string; // YYYY-MM-DD
  withdraw: number;
  deposit: number;
  counterparty: string;
  memo: string;
  method: string;
}

export interface ReconReceipt {
  id: string;
  expenseDate: string | null; // YYYY-MM-DD
  amount: number;
  userName: string | null;
}

export interface ReconResult {
  index: number;
  kind: BankTxnKind;
  matchStatus: "matched" | "unmatched" | "na";
  matchedReceiptIds: string[];
}

// 잘못입금 환불은 입금/출금 양쪽에 나타남:
//  출금 '잘못입금됨'·'교회로다시이체함', 입금 '교회에서 잘못입금'·'잘못입금됨'
const WASH_MEMO_RE = /잘못입금|다시이체/;

export function isWash(t: Pick<ReconTxn, "memo">): boolean {
  return WASH_MEMO_RE.test((t.memo ?? "").trim());
}

// 모교회/계좌간 이체는 입금·출금 양방향 모두 비지출·비수입 처리 (예: 129,500 033↔017)
export function isTransfer(t: Pick<ReconTxn, "counterparty" | "memo">): boolean {
  return !isWash(t) && (t.counterparty ?? "").includes("대한예수교장로회");
}

function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs((da - db) / 86_400_000);
}

function windowFor(method: string): number {
  // 카드 결제는 1~3일 내 청산, 환급 이체는 보통 2주 내. 25일이면 정상 지연은 포괄하되
  // 같은 금액의 다른 달 거래를 가로채는 것을 방지.
  return (method ?? "").includes("카드") ? 14 : 25;
}

/** 거래처에 영수증 지출인명이 포함되는지 (접미사 2자 매칭 포함) */
function nameMatch(userName: string | null, counterparty: string): boolean {
  const u = (userName ?? "").trim();
  if (!u) return false;
  if (counterparty.includes(u)) return true;
  return u.length >= 2 && counterparty.includes(u.slice(-2));
}

/**
 * 은행 거래내역 ↔ 영수증 자동대사.
 * @returns txns 순서 정렬된 결과 배열
 */
export function reconcileBank(
  txns: ReconTxn[],
  receipts: ReconReceipt[],
): ReconResult[] {
  // 1. 기본 분류 (mutable — 이후 보정)
  const kinds: BankTxnKind[] = txns.map((t) => {
    if (isWash(t)) return "wash";
    if (isTransfer(t)) return "transfer";
    if (t.deposit > 0) return "income";
    if (t.withdraw > 0) return "expense";
    return "unknown";
  });

  // 2. 잘못입금 환불 출금에 대응하는 입금도 wash로 자동 분류.
  //    (예: 전성희 헌금 280,000이 자체통장에 잘못 입금됐다 환불된 케이스 →
  //     입금 3건도 수입이 아닌 잘못입금으로. 매 import마다 자동 적용)
  markWashRefundDeposits(txns, kinds);

  const used = new Set<string>();
  const matchByIndex = new Map<number, string[]>();

  // 지출만(카드 먼저 → 1:1이 묶음에 먹히지 않게)
  const expenses = txns
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => kinds[i] === "expense")
    .sort((a, b) => {
      const ca = a.t.method.includes("카드") ? 0 : 1;
      const cb = b.t.method.includes("카드") ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.t.date.localeCompare(b.t.date);
    });

  function matchSingle(t: ReconTxn): ReconReceipt | null {
    const win = windowFor(t.method);
    let best: ReconReceipt | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const r of receipts) {
      if (used.has(r.id)) continue;
      if (r.amount !== t.withdraw) continue;
      const diff = r.expenseDate ? dayDiff(t.date, r.expenseDate) : 99;
      if (diff <= win && diff < bestDiff) {
        best = r;
        bestDiff = diff;
      }
    }
    return best;
  }

  function matchLump(t: ReconTxn): ReconReceipt[] | null {
    if (t.method.includes("카드")) return null;
    const LUMP_WINDOW = 40; // 묶음은 여러 영수증을 한 번에 환급하므로 더 넓게
    const cands = receipts.filter(
      (r) =>
        !used.has(r.id) &&
        r.expenseDate &&
        r.amount > 0 &&
        nameMatch(r.userName, t.counterparty) &&
        dayDiff(t.date, r.expenseDate) <= LUMP_WINDOW,
    );
    if (cands.length < 2 || cands.length > 18) return null;
    cands.sort((a, b) => (a.expenseDate! < b.expenseDate! ? -1 : 1));
    // subset-sum: 작은 부분집합 우선
    const target = t.withdraw;
    const n = cands.length;
    for (let k = 2; k <= n; k++) {
      const combo = findCombo(cands, k, target);
      if (combo) return combo;
    }
    return null;
  }

  function recordMatch(i: number, ids: string[]) {
    for (const id of ids) used.add(id);
    matchByIndex.set(i, ids);
  }

  // 같은 금액 단일 영수증이 아예 없는 거래 = "강제 묶음"(예: 390,000=215k+119k+52k+4k).
  // 단일이 이 묶음의 구성요소를 가로채기 전에 먼저 처리.
  const hasAnyReceiptOfAmount = (amt: number) => receipts.some((r) => r.amount === amt);
  const forcedLump = expenses.filter(({ t }) => !hasAnyReceiptOfAmount(t.withdraw));
  const rest = expenses.filter(({ t }) => hasAnyReceiptOfAmount(t.withdraw));

  for (const { t, i } of forcedLump) {
    const lump = matchLump(t);
    recordMatch(i, lump ? lump.map((r) => r.id) : []);
  }
  for (const { t, i } of rest) {
    const single = matchSingle(t);
    if (single) {
      recordMatch(i, [single.id]);
      continue;
    }
    const lump = matchLump(t);
    recordMatch(i, lump ? lump.map((r) => r.id) : []);
  }

  // 결과 = 최종 kind + 지출 매칭
  return txns.map((t, i) => {
    if (kinds[i] === "expense") {
      const ids = matchByIndex.get(i) ?? [];
      return {
        index: i,
        kind: "expense" as BankTxnKind,
        matchStatus: ids.length ? ("matched" as const) : ("unmatched" as const),
        matchedReceiptIds: ids,
      };
    }
    return {
      index: i,
      kind: kinds[i],
      matchStatus: "na" as const,
      matchedReceiptIds: [],
    };
  });
}

/**
 * 잘못입금 환불 출금(kind=wash, 출금)에 대응하는 입금을 찾아 wash로 표시.
 * 거래처명이 겹치고 ±7일 내, 금액이 같거나 부분합이 같은 입금을 환불 대상으로 본다.
 */
function markWashRefundDeposits(txns: ReconTxn[], kinds: BankTxnKind[]): void {
  for (let wi = 0; wi < txns.length; wi++) {
    if (kinds[wi] !== "wash" || txns[wi].withdraw <= 0) continue;
    const w = txns[wi];
    const base = (w.counterparty || "").split("/")[0].trim();
    if (!base) continue;

    const cands: { idx: number; amount: number }[] = [];
    for (let di = 0; di < txns.length; di++) {
      if (kinds[di] !== "income") continue; // 이미 wash/transfer면 제외
      const d = txns[di];
      if (d.deposit <= 0) continue;
      if (!(d.counterparty || "").includes(base)) continue;
      if (dayDiff(d.date, w.date) > 7) continue;
      cands.push({ idx: di, amount: d.deposit });
    }
    if (!cands.length) continue;

    const single = cands.find((c) => c.amount === w.withdraw);
    if (single) {
      kinds[single.idx] = "wash";
      continue;
    }
    const subset = depositSubset(cands, w.withdraw);
    if (subset) for (const c of subset) kinds[c.idx] = "wash";
  }
}

/** 입금 후보 중 합이 target인 부분집합 (소규모 백트래킹). */
function depositSubset(
  items: { idx: number; amount: number }[],
  target: number,
): { idx: number; amount: number }[] | null {
  if (items.length > 16) return null;
  const sorted = [...items].sort((a, b) => a.amount - b.amount);
  const result: { idx: number; amount: number }[] = [];
  function bt(start: number, sum: number): boolean {
    if (sum === target && result.length > 0) return true;
    if (sum > target) return false;
    for (let i = start; i < sorted.length; i++) {
      result.push(sorted[i]);
      if (bt(i + 1, sum + sorted[i].amount)) return true;
      result.pop();
    }
    return false;
  }
  return bt(0, 0) ? [...result] : null;
}

/** k개 부분집합 중 합이 target인 첫 조합 (소규모 백트래킹) */
function findCombo(
  items: ReconReceipt[],
  k: number,
  target: number,
): ReconReceipt[] | null {
  const result: ReconReceipt[] = [];
  function backtrack(start: number, remaining: number, sum: number): boolean {
    if (remaining === 0) return sum === target;
    for (let i = start; i <= items.length - remaining; i++) {
      const next = sum + items[i].amount;
      if (next > target) continue;
      result.push(items[i]);
      if (backtrack(i + 1, remaining - 1, next)) return true;
      result.pop();
    }
    return false;
  }
  return backtrack(0, k, 0) ? [...result] : null;
}
