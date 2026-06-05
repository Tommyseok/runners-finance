import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerEntry } from "@/lib/db-types";

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
