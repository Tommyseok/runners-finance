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

/** 월별 통합원장 (입금/출금). month='all'이면 전체. */
export async function getLedgerEntries(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
): Promise<LedgerMonth> {
  let query = supabase
    .from("ledger_entry")
    .select("*")
    .eq("org_id", orgId)
    .order("txn_at", { ascending: false });

  if (month && month !== "all") {
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

  const { data } = await query;
  const entries = (data ?? []) as LedgerEntry[];
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
  payer: string | null;
}

/**
 * 대사 후 원장 — 각 입출금 행에 매칭된 영수증의 계정·거래처·지출인·영수증No,
 * 또는 수입 항목을 결합. PDF/엑셀과 영수증No로 교차참조 가능.
 */
export async function getEnrichedLedger(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
): Promise<EnrichedLedgerEntry[]> {
  const { entries } = await getLedgerEntries(supabase, orgId, month);

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

  return entries.map((e) => {
    let category = "";
    let content = "";
    let receiptNo: number | null = null;
    let payer: string | null = null;

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
      }
    } else {
      category = "(영수증 미매칭)";
      content = e.counterparty ?? "-";
    }

    return {
      id: e.id,
      bankAccountId: e.bank_account_id,
      accountLabel: accLabel.get(e.bank_account_id) ?? "-",
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
      payer,
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
