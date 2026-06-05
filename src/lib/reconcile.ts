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
  const used = new Set<string>();
  const resultByIndex = new Map<number, ReconResult>();

  // 출금 중 지출만(카드 먼저 → 1:1이 묶음에 먹히지 않게)
  const expenses = txns
    .filter((t) => t.withdraw > 0 && !isWash(t) && !isTransfer(t))
    .sort((a, b) => {
      const ca = a.method.includes("카드") ? 0 : 1;
      const cb = b.method.includes("카드") ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.date.localeCompare(b.date);
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

  function recordMatch(t: ReconTxn, ids: string[]) {
    for (const id of ids) used.add(id);
    resultByIndex.set(t.index, {
      index: t.index,
      kind: "expense",
      matchStatus: ids.length ? "matched" : "unmatched",
      matchedReceiptIds: ids,
    });
  }

  // 같은 금액 단일 영수증이 아예 없는 거래 = "강제 묶음"(예: 390,000=215k+119k+52k+4k).
  // 단일이 이 묶음의 구성요소를 가로채기 전에 먼저 처리.
  const hasAnyReceiptOfAmount = (amt: number) => receipts.some((r) => r.amount === amt);
  const forcedLump = expenses.filter((t) => !hasAnyReceiptOfAmount(t.withdraw));
  const rest = expenses.filter((t) => hasAnyReceiptOfAmount(t.withdraw));

  for (const t of forcedLump) {
    const lump = matchLump(t);
    recordMatch(t, lump ? lump.map((r) => r.id) : []);
  }
  for (const t of rest) {
    const single = matchSingle(t);
    if (single) {
      recordMatch(t, [single.id]);
      continue;
    }
    const lump = matchLump(t);
    recordMatch(t, lump ? lump.map((r) => r.id) : []);
  }

  // 나머지 분류
  return txns.map((t) => {
    const existing = resultByIndex.get(t.index);
    if (existing) return existing;
    let kind: BankTxnKind = "unknown";
    if (isWash(t)) kind = "wash";
    else if (isTransfer(t)) kind = "transfer";
    else if (t.deposit > 0) kind = "income";
    else if (t.withdraw > 0) kind = "expense";
    return {
      index: t.index,
      kind,
      matchStatus: "na",
      matchedReceiptIds: [],
    };
  });
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
