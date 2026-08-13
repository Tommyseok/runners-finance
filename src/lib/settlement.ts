import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBankBalances,
  getEnrichedLedger,
  type EnrichedLedgerEntry,
  type LedgerRange,
} from "@/lib/ledger";

/**
 * 결산 상세 시트 고정 목록 (사용자 결산 템플릿과 동일).
 * 새 계정항목이 생겨도 시트는 늘지 않는다 — 요약 시트에는 모두 포함됨.
 */
export const SETTLEMENT_DETAIL_SHEETS = [
  { sheetName: "여름수련회", categories: ["[훈련비] 여름수련회"] },
  { sheetName: "겨울수련회", categories: ["[훈련비] 겨울수련회"] },
  { sheetName: "소그룹운영비", categories: ["[운영비] 소그룹"] },
  { sheetName: "찬양팀지원비", categories: ["[운영비] 찬양팀"] },
  { sheetName: "심방비", categories: ["[운영비] 심방비"] },
  { sheetName: "교사지원", categories: ["[지원비] 교사지원"] },
  {
    sheetName: "전체행사비",
    categories: ["[행사비] 학년모임", "[행사비] 고등부행사 (체육대회 등)"],
  },
] as const;

export type AccountGroup = "self" | "church" | "other";

/**
 * 자체(신한 017) / 교회(국민 033) 구분 — 계좌 라벨의 식별 숫자로 판별.
 * 주의: 계좌 라벨이 바뀌어 어느 쪽에도 매칭되지 않으면 자체/교회 분할 열에는 빠지고
 * 수입/지출 '계' 열에만 합산된다 (합계는 항상 정확).
 */
export function classifyAccount(label: string): AccountGroup {
  if (label.includes("017")) return "self";
  if (label.includes("033")) return "church";
  return "other";
}

export interface SettlementCategoryRow {
  category: string;
  count: number;
  incomeSelf: number;
  incomeChurch: number;
  incomeTotal: number;
  expenseSelf: number;
  expenseChurch: number;
  expenseTotal: number;
  net: number;
  /** 실지출((비지출) 제외) 대비 비중, 0~1 */
  expenseShare: number;
}

export interface DetailAccountRow {
  accountLabel: string;
  count: number;
  amount: number;
  /** 시트 지출 합계 대비 비중, 0~1 */
  share: number;
}

export interface SettlementDetail {
  sheetName: string;
  categories: readonly string[];
  entries: EnrichedLedgerEntry[]; // 지출만, 최신순
  count: number;
  expenseTotal: number;
  byAccount: DetailAccountRow[];
}

export interface SettlementData {
  orgName: string;
  entries: EnrichedLedgerEntry[];
  summary: SettlementCategoryRow[];
  summaryTotals: SettlementCategoryRow;
  /** wash/transfer 제외 실수입·실지출 — 원장 헤더와 동일 기준 */
  ledgerIncomeTotal: number;
  ledgerExpenseTotal: number;
  totalBalance: number;
}

const NON_CASH = "(비지출)";
const UNMATCHED = "(영수증 미매칭)";

function emptyRow(category: string): SettlementCategoryRow {
  return {
    category,
    count: 0,
    incomeSelf: 0,
    incomeChurch: 0,
    incomeTotal: 0,
    expenseSelf: 0,
    expenseChurch: 0,
    expenseTotal: 0,
    net: 0,
    expenseShare: 0,
  };
}

/** 결산 데이터 — 원장 엔트리를 계정항목·계좌별로 집계하고 고정 상세 시트를 구성. */
export async function getSettlementData(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  range?: LedgerRange,
): Promise<SettlementData> {
  const [entries, balances, orgRes, catRes] = await Promise.all([
    getEnrichedLedger(supabase, orgId, month, range),
    getBankBalances(supabase, orgId),
    supabase.from("organization").select("name").eq("id", orgId).single(),
    supabase
      .from("budget_category")
      .select("name, sort_order")
      .eq("org_id", orgId)
      .order("sort_order")
      .order("name"),
  ]);
  const orgName = (orgRes.data as { name: string } | null)?.name ?? "조직";
  const totalBalance = balances.reduce((s, b) => s + (b.balance ?? 0), 0);

  // 집계
  const rows = new Map<string, SettlementCategoryRow>();
  for (const e of entries) {
    const key = e.category || "-";
    const prev = rows.get(key) ?? emptyRow(key);
    const group = classifyAccount(e.accountLabel);
    const next = { ...prev, count: prev.count + 1 };
    if (e.direction === "income") {
      next.incomeTotal += e.deposit;
      if (group === "self") next.incomeSelf += e.deposit;
      if (group === "church") next.incomeChurch += e.deposit;
    } else {
      next.expenseTotal += e.withdraw;
      if (group === "self") next.expenseSelf += e.withdraw;
      if (group === "church") next.expenseChurch += e.withdraw;
    }
    rows.set(key, next);
  }

  const real = entries.filter((e) => e.kind !== "wash" && e.kind !== "transfer");
  const ledgerIncomeTotal = real
    .filter((e) => e.direction === "income")
    .reduce((s, e) => s + e.deposit, 0);
  const ledgerExpenseTotal = real
    .filter((e) => e.direction === "expense")
    .reduce((s, e) => s + e.withdraw, 0);

  // 순액·지출 비중 (분모: 총지출 — (비지출) 포함 전체, 템플릿과 동일하게 합계가 100%가 되도록)
  const grandExpense = Array.from(rows.values()).reduce((s, r) => s + r.expenseTotal, 0);
  const finalize = (r: SettlementCategoryRow): SettlementCategoryRow => ({
    ...r,
    net: r.incomeTotal - r.expenseTotal,
    expenseShare: grandExpense > 0 ? r.expenseTotal / grandExpense : 0,
  });

  // 정렬: 지출 카테고리(sort_order) → 수입 카테고리(수입 계 큰 순) → (영수증 미매칭) → (비지출)
  const budgetOrder = new Map(
    ((catRes.data ?? []) as { name: string; sort_order: number }[]).map((c, i) => [c.name, i]),
  );
  const summary: SettlementCategoryRow[] = [];
  const rest: SettlementCategoryRow[] = [];
  for (const row of rows.values()) {
    if (row.category === NON_CASH || row.category === UNMATCHED) continue;
    if (budgetOrder.has(row.category)) summary.push(finalize(row));
    else rest.push(finalize(row));
  }
  summary.sort(
    (a, b) => (budgetOrder.get(a.category) ?? 0) - (budgetOrder.get(b.category) ?? 0),
  );
  rest.sort((a, b) => b.incomeTotal - a.incomeTotal);
  summary.push(...rest);
  const unmatchedRow = rows.get(UNMATCHED);
  if (unmatchedRow) summary.push(finalize(unmatchedRow));
  const nonCashRow = rows.get(NON_CASH);
  if (nonCashRow) summary.push(finalize(nonCashRow));

  const summaryTotals = finalize(
    summary.reduce(
      (acc, r) => ({
        ...acc,
        count: acc.count + r.count,
        incomeSelf: acc.incomeSelf + r.incomeSelf,
        incomeChurch: acc.incomeChurch + r.incomeChurch,
        incomeTotal: acc.incomeTotal + r.incomeTotal,
        expenseSelf: acc.expenseSelf + r.expenseSelf,
        expenseChurch: acc.expenseChurch + r.expenseChurch,
        expenseTotal: acc.expenseTotal + r.expenseTotal,
      }),
      emptyRow("합계"),
    ),
  );

  return {
    orgName,
    entries,
    summary,
    summaryTotals,
    ledgerIncomeTotal,
    ledgerExpenseTotal,
    totalBalance,
  };
}

/** 고정 상세 시트 데이터 — 지출 엔트리 필터(최신순 유지) + 계좌별 구분. */
export function buildSettlementDetails(
  entries: EnrichedLedgerEntry[],
): SettlementDetail[] {
  return SETTLEMENT_DETAIL_SHEETS.map((def) => {
    const detailEntries = entries.filter(
      (e) => e.direction === "expense" && (def.categories as readonly string[]).includes(e.category),
    );
    const expenseTotal = detailEntries.reduce((s, e) => s + e.withdraw, 0);
    const byAccountMap = new Map<string, { count: number; amount: number }>();
    for (const e of detailEntries) {
      const prev = byAccountMap.get(e.accountLabel) ?? { count: 0, amount: 0 };
      byAccountMap.set(e.accountLabel, {
        count: prev.count + 1,
        amount: prev.amount + e.withdraw,
      });
    }
    const byAccount: DetailAccountRow[] = Array.from(byAccountMap.entries())
      .map(([accountLabel, v]) => ({
        accountLabel,
        count: v.count,
        amount: v.amount,
        share: expenseTotal > 0 ? v.amount / expenseTotal : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    return {
      sheetName: def.sheetName,
      categories: def.categories,
      entries: detailEntries,
      count: detailEntries.length,
      expenseTotal,
      byAccount,
    };
  });
}
