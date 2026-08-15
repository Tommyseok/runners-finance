import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankTxnKind, BankTxnMatchStatus, LedgerEntry } from "@/lib/db-types";

export interface AccountBalance {
  bankAccountId: string;
  label: string;
  bankName: string;
  balance: number | null;
  lastTxnAt: string | null;
}

/** 계좌별 현재 잔액 = 가장 최근 거래의 잔액(은행 계산값). */
export async function getBankBalances(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AccountBalance[]> {
  const { data: accts } = await supabase
    .from("bank_account")
    .select("id, label, bank_name, is_active")
    .eq("org_id", orgId)
    .order("label");

  const result: AccountBalance[] = [];
  for (const a of (accts ?? []) as {
    id: string;
    label: string;
    bank_name: string;
  }[]) {
    const { data: latest } = await supabase
      .from("bank_transaction")
      .select("balance, txn_at")
      .eq("bank_account_id", a.id)
      .order("txn_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    result.push({
      bankAccountId: a.id,
      label: a.label,
      bankName: a.bank_name,
      balance: (latest as { balance: number | null } | null)?.balance ?? null,
      lastTxnAt: (latest as { txn_at: string } | null)?.txn_at ?? null,
    });
  }
  return result;
}

export interface LedgerMonth {
  month: string; // YYYY-MM
  entries: LedgerEntry[];
  incomeTotal: number;
  expenseTotal: number;
}

/** 일자 범위 (YYYY-MM-DD, to 포함). from/to가 있으면 month보다 우선. */
export interface LedgerRange {
  from?: string;
  to?: string;
}

/** 월별 통합원장 (입금/출금). month='all'이면 전체. range가 있으면 month 무시. */
export async function getLedgerEntries(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  range?: LedgerRange,
): Promise<LedgerMonth> {
  let query = supabase
    .from("ledger_entry")
    .select("*")
    .eq("org_id", orgId)
    .order("txn_at", { ascending: false });

  if (range?.from || range?.to) {
    if (range.from) query = query.gte("txn_date", range.from);
    if (range.to) query = query.lte("txn_date", range.to);
  } else if (month && month !== "all") {
    const [y, m] = month.split("-").map(Number);
    if (y && m) {
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end =
        m === 12
          ? `${y + 1}-01-01`
          : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      query = query.gte("txn_date", start).lt("txn_date", end);
    }
  }

  // PostgREST 기본 max-rows(1000)에 걸려 전체기간 결산이 조용히 잘리지 않도록 페이지 단위로 전부 가져온다.
  const PAGE = 1000;
  const entries: LedgerEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await query.range(offset, offset + PAGE - 1);
    const page = (data ?? []) as LedgerEntry[];
    entries.push(...page);
    if (page.length < PAGE) break;
  }
  // 잘못입금/내부이체는 수입·지출 합계에서 제외
  const real = entries.filter((e) => e.kind !== "wash" && e.kind !== "transfer");
  const incomeTotal = real
    .filter((e) => e.direction === "income")
    .reduce((s, e) => s + e.deposit, 0);
  const expenseTotal = real
    .filter((e) => e.direction === "expense")
    .reduce((s, e) => s + e.withdraw, 0);

  return { month, entries, incomeTotal, expenseTotal };
}

export interface EnrichedLedgerEntry {
  id: string;
  bankAccountId: string;
  accountLabel: string;
  /** 추적용 거래번호 "MMDD-계좌-순번" (예: 0803-033-2). 은행 기록 불변이라 시점과 무관하게 동일. */
  txnRef: string;
  txnDate: string;
  direction: "income" | "expense";
  deposit: number;
  withdraw: number;
  balance: number | null;
  counterparty: string | null;
  kind: BankTxnKind;
  matchStatus: BankTxnMatchStatus;
  category: string; // 계정항목
  content: string; // 내용/적요
  receiptNo: number | null;
  /** 증빙번호 — 세부계정별 순번 표기 (예: "소그룹-3"). 지출일 오름차순 기준. */
  receiptRef: string | null;
  payer: string | null;
  /** 매칭된 영수증의 증빙 사진 존재 여부 (영수증 없는 행은 null) */
  hasImage: boolean | null;
}

/**
 * 증빙번호 맵 (영수증 id → "계정-순번").
 * 계정항목별로 지출일(같으면 내부번호) 오름차순으로 1부터 부여 — 문서 표기용.
 */
export async function buildReceiptRefMap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const [{ data: receipts }, { data: cats }] = await Promise.all([
    supabase
      .from("receipt")
      .select("id, receipt_no, category_id, expense_date")
      .eq("org_id", orgId),
    supabase.from("budget_category").select("id, name").eq("org_id", orgId),
  ]);
  const catName = new Map(
    ((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const shortName = (categoryId: string | null): string => {
    const full = categoryId ? (catName.get(categoryId) ?? "미지정") : "미지정";
    return full.replace(/^\[[^\]]*\]\s*/, "") || full;
  };
  const rows = ((receipts ?? []) as {
    id: string;
    receipt_no: number | null;
    category_id: string | null;
    expense_date: string | null;
  }[]).map((r) => ({ ...r, group: shortName(r.category_id) }));
  rows.sort((a, b) => {
    if (a.group !== b.group) return a.group < b.group ? -1 : 1;
    const da = a.expense_date ?? "9999";
    const db = b.expense_date ?? "9999";
    if (da !== db) return da < db ? -1 : 1;
    return (a.receipt_no ?? 0) - (b.receipt_no ?? 0);
  });
  const map = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const r of rows) {
    const seq = (counters.get(r.group) ?? 0) + 1;
    counters.set(r.group, seq);
    map.set(r.id, `${r.group}-${seq}`);
  }
  return map;
}

/**
 * 대사 후 원장 — 각 입출금 행에 매칭된 영수증의 계정·거래처·지출인·영수증No,
 * 또는 수입 항목을 결합. PDF/엑셀과 영수증No로 교차참조 가능.
 */
export async function getEnrichedLedger(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  range?: LedgerRange,
): Promise<EnrichedLedgerEntry[]> {
  const [{ entries }, refMap] = await Promise.all([
    getLedgerEntries(supabase, orgId, month, range),
    buildReceiptRefMap(supabase, orgId),
  ]);

  const receiptIds = Array.from(
    new Set(entries.map((e) => e.matched_receipt_id).filter(Boolean) as string[]),
  );
  const incomeTxnIds = entries
    .filter((e) => e.direction === "income")
    .map((e) => e.id);

  const [accRes, rcptRes, incRes] = await Promise.all([
    supabase.from("bank_account").select("id, label").eq("org_id", orgId),
    receiptIds.length
      ? supabase
          .from("receipt")
          .select("id, receipt_no, merchant, description, category_id, user_id")
          .in("id", receiptIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    incomeTxnIds.length
      ? supabase
          .from("income")
          .select("bank_transaction_id, category, memo")
          .eq("org_id", orgId)
          .in("bank_transaction_id", incomeTxnIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const accLabel = new Map(
    ((accRes.data ?? []) as { id: string; label: string }[]).map((a) => [a.id, a.label]),
  );
  const receipts = (rcptRes.data ?? []) as {
    id: string;
    receipt_no: number | null;
    merchant: string | null;
    description: string | null;
    category_id: string | null;
    user_id: string;
  }[];
  const incomeByTxn = new Map(
    ((incRes.data ?? []) as {
      bank_transaction_id: string | null;
      category: string;
      memo: string | null;
    }[]).map((i) => [i.bank_transaction_id, i]),
  );

  // 영수증의 카테고리/지출인 batch
  const catIds = Array.from(
    new Set(receipts.map((r) => r.category_id).filter(Boolean) as string[]),
  );
  const userIds = Array.from(new Set(receipts.map((r) => r.user_id)));
  const [catRes, userRes] = await Promise.all([
    catIds.length
      ? supabase.from("budget_category").select("id, name").in("id", catIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.length
      ? supabase.from("profile").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
  ]);
  const catName = new Map(
    ((catRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const userName = new Map(
    ((userRes.data ?? []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name]),
  );
  const receiptById = new Map(receipts.map((r) => [r.id, r]));

  // 증빙 사진 존재 여부 (사진 없는 매칭 영수증 표시용)
  const imageReceiptIds = new Set<string>();
  for (let i = 0; i < receiptIds.length; i += 100) {
    const { data: imgRows } = await supabase
      .from("receipt_image")
      .select("receipt_id")
      .in("receipt_id", receiptIds.slice(i, i + 100));
    for (const row of (imgRows ?? []) as { receipt_id: string }[]) {
      imageReceiptIds.add(row.receipt_id);
    }
  }

  // 거래번호: 같은 날짜·계좌 안에서 시간 오름차순 순번 (entries는 최신순이므로 역순으로 센다)
  const accountDigits = (label: string): string => {
    const m = label.match(/\((\d+)\)/);
    return m ? m[1] : label;
  };
  const refByEntryId = new Map<string, string>();
  const dayCounters = new Map<string, number>();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    const digits = accountDigits(accLabel.get(e.bank_account_id) ?? "-");
    const dayKey = `${e.txn_date}|${digits}`;
    const seq = (dayCounters.get(dayKey) ?? 0) + 1;
    dayCounters.set(dayKey, seq);
    const mmdd = e.txn_date.slice(5).replace("-", "");
    refByEntryId.set(e.id, `${mmdd}-${digits}-${seq}`);
  }

  return entries.map((e) => {
    let category = "";
    let content = "";
    let receiptNo: number | null = null;
    let receiptRef: string | null = null;
    let payer: string | null = null;
    let hasImage: boolean | null = null;

    if (e.kind === "wash") {
      category = "(비지출)";
      content = "잘못입금 환불";
    } else if (e.kind === "transfer") {
      category = "(비지출)";
      content = "계좌간 이체";
    } else if (e.direction === "income") {
      const inc = incomeByTxn.get(e.id);
      category = inc?.category ?? "수입";
      content = inc?.memo ?? e.counterparty ?? "입금";
    } else if (e.matched_receipt_id) {
      const r = receiptById.get(e.matched_receipt_id);
      if (r) {
        category = r.category_id ? (catName.get(r.category_id) ?? "-") : "-";
        payer = userName.get(r.user_id) ?? null;
        content = r.merchant || r.description || "-";
        receiptNo = r.receipt_no;
        receiptRef = refMap.get(r.id) ?? null;
        hasImage = imageReceiptIds.has(r.id);
      }
    } else {
      category = "(영수증 미매칭)";
      content = e.counterparty ?? "-";
    }

    return {
      id: e.id,
      bankAccountId: e.bank_account_id,
      accountLabel: accLabel.get(e.bank_account_id) ?? "-",
      txnRef: refByEntryId.get(e.id) ?? "-",
      txnDate: e.txn_date,
      direction: e.direction,
      deposit: e.deposit,
      withdraw: e.withdraw,
      balance: e.balance,
      counterparty: e.counterparty,
      kind: e.kind,
      matchStatus: e.match_status,
      category,
      content,
      receiptNo,
      receiptRef,
      payer,
      hasImage,
    };
  });
}

export function monthOptions(count = 12): { value: string; label: string }[] {
  const now = new Date();
  const opts: { value: string; label: string }[] = [{ value: "all", label: "전체" }];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    });
  }
  return opts;
}
