import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import { buildSettlementDetails, getSettlementData } from "@/lib/settlement";
import { SettlementClient } from "./settlement-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string | undefined): string | undefined {
  return typeof v === "string" && DATE_RE.test(v) ? v : undefined;
}

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; label?: string; preset?: string };
}) {
  const { profile, supabase } = await requireMembership();
  const orgId = profile.org_id!;
  const isAdmin = profile.role === "admin";
  const from = validDate(searchParams.from);
  const to = validDate(searchParams.to);
  const range = from || to ? { from, to } : undefined;
  const periodLabel =
    range && searchParams.label
      ? searchParams.label
      : range
        ? `${from ?? ""} ~ ${to ?? ""}`
        : "전체기간";
  const presetId = range ? (searchParams.preset ?? "custom") : "all";

  const data = await getSettlementData(supabase, orgId, "all", range);
  const details = buildSettlementDetails(data.splitEntries);

  // 활성 게시 (마이그레이션 전이면 테이블이 없을 수 있으므로 오류는 무시)
  let publication: { periodLabel: string; publishedAt: string } | null = null;
  {
    const { data: pub } = await supabase
      .from("settlement_publication")
      .select("period_label, published_at")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pub) {
      publication = {
        periodLabel: (pub as { period_label: string }).period_label,
        publishedAt: (pub as { published_at: string }).published_at,
      };
    }
  }
  const t = data.summaryTotals;
  const nonCash = data.summary.find((s) => s.category === "(비지출)");
  const checkIncomeDiff =
    t.incomeTotal - (nonCash?.incomeTotal ?? 0) - data.ledgerIncomeTotal;
  const checkExpenseDiff =
    t.expenseTotal - (nonCash?.expenseTotal ?? 0) - data.ledgerExpenseTotal;
  const verified = checkIncomeDiff === 0 && checkExpenseDiff === 0;

  return (
    <AppShell isAdmin={isAdmin}>
      <PageHeader title="결산" back />
      <div className="space-y-3 px-4 py-4">
        <SettlementClient
          from={from}
          to={to}
          periodLabel={periodLabel}
          presetId={presetId}
          isAdmin={isAdmin}
          publication={publication}
        />

        {/* 수입/지출/순액 요약 */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-600" /> 수입 ({periodLabel})
              </div>
              <div className="mt-1 text-lg font-bold text-emerald-700">
                {formatCurrency(data.ledgerIncomeTotal)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowDownCircle className="h-3.5 w-3.5 text-rose-600" /> 지출 ({periodLabel})
              </div>
              <div className="mt-1 text-lg font-bold text-rose-700">
                {formatCurrency(data.ledgerExpenseTotal)}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Scale className="h-3.5 w-3.5" /> 순액 (수입 − 지출)
            </div>
            <div
              className={`text-lg font-bold ${
                data.ledgerIncomeTotal - data.ledgerExpenseTotal >= 0
                  ? "text-emerald-700"
                  : "text-rose-700"
              }`}
            >
              {formatCurrency(data.ledgerIncomeTotal - data.ledgerExpenseTotal)}
            </div>
          </CardContent>
        </Card>

        {/* 계정항목요약 */}
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3">
              <div className="text-sm font-semibold">계정항목별 요약</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                여러 영수증을 묶어 정산한 출금은 영수증의 계정항목으로 분리 집계 (건수 = 분리 후 기준)
              </div>
            </div>
            {data.summary.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                해당 기간에 거래가 없습니다.
              </div>
            ) : (
              <ul className="divide-y">
                {data.summary.map((row) => (
                  <li key={row.category}>
                    <details className="group">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{row.category}</div>
                          <div className="text-xs text-muted-foreground">{row.count}건</div>
                        </div>
                        <div className="shrink-0 text-right text-sm">
                          {row.incomeTotal > 0 && (
                            <div className="font-semibold text-emerald-700">
                              +{formatCurrency(row.incomeTotal)}
                            </div>
                          )}
                          {row.expenseTotal > 0 && (
                            <div className="font-semibold text-rose-700">
                              −{formatCurrency(row.expenseTotal)}
                            </div>
                          )}
                          {row.incomeTotal === 0 && row.expenseTotal === 0 && (
                            <div className="text-muted-foreground">-</div>
                          )}
                        </div>
                      </summary>
                      <div className="space-y-1 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>자체 통장 (017)</span>
                          <span>
                            {row.incomeSelf > 0 && `수입 ${formatCurrency(row.incomeSelf)} `}
                            {row.expenseSelf > 0 && `지출 ${formatCurrency(row.expenseSelf)}`}
                            {row.incomeSelf === 0 && row.expenseSelf === 0 && "-"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>교회 통장 (033)</span>
                          <span>
                            {row.incomeChurch > 0 && `수입 ${formatCurrency(row.incomeChurch)} `}
                            {row.expenseChurch > 0 && `지출 ${formatCurrency(row.expenseChurch)}`}
                            {row.incomeChurch === 0 && row.expenseChurch === 0 && "-"}
                          </span>
                        </div>
                        {row.expenseTotal > 0 && (
                          <div className="flex justify-between">
                            <span>지출 비중</span>
                            <span>{(row.expenseShare * 100).toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
                <li className="flex items-center justify-between px-4 py-3 text-sm font-bold">
                  <span>합계 ({t.count}건)</span>
                  <span className="text-right">
                    <span className="text-emerald-700">+{formatCurrency(t.incomeTotal)}</span>
                    {"  "}
                    <span className="text-rose-700">−{formatCurrency(t.expenseTotal)}</span>
                  </span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 검증 */}
        <Card>
          <CardContent className="flex items-center justify-between p-4 text-xs text-muted-foreground">
            <span>검증: 요약 합계 − (비지출) = 원장 수입/지출</span>
            {verified ? (
              <Badge variant="secondary" className="text-emerald-700">일치</Badge>
            ) : (
              <Badge variant="warning">
                불일치 (수입 {formatCurrency(checkIncomeDiff)} / 지출 {formatCurrency(checkExpenseDiff)})
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* 지출 상세 (고정 7개 항목) */}
        <div className="pt-1 text-sm font-semibold">지출 상세</div>
        {details.map((d) => (
          <Card key={d.sheetName}>
            <CardContent className="p-0">
              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div>
                    <div className="text-sm font-semibold">{d.sheetName}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.categories.join(" + ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-rose-700">
                      {formatCurrency(d.expenseTotal)}
                    </div>
                    <div className="text-xs text-muted-foreground">{d.count}건</div>
                  </div>
                </summary>
                {d.entries.length === 0 ? (
                  <div className="border-t p-6 text-center text-xs text-muted-foreground">
                    해당 기간에 지출이 없습니다.
                  </div>
                ) : (
                  <>
                    <ul className="divide-y border-t">
                      {d.entries.map((e, i) => {
                        const cumulative = d.entries
                          .slice(0, i + 1)
                          .reduce((s, x) => s + x.withdraw, 0);
                        return (
                          <li key={e.id} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {e.counterparty ?? "(거래처 미상)"}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <span>{formatDate(e.txnDate)}</span>
                                  {e.receiptNo != null && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      영수증 #{e.receiptNo}
                                    </Badge>
                                  )}
                                </div>
                                {e.content && e.content !== "-" && (
                                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {e.content}
                                    {e.payer ? ` · ${e.payer}` : ""}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-semibold text-rose-700">
                                  −{formatCurrency(e.withdraw)}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  누계 {formatCurrency(cumulative)}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="space-y-1 border-t bg-muted/40 px-4 py-3 text-xs">
                      <div className="font-semibold">계좌별 지출 구분</div>
                      {d.byAccount.map((acc) => (
                        <div
                          key={acc.accountLabel}
                          className="flex justify-between text-muted-foreground"
                        >
                          <span>
                            {acc.accountLabel} · {acc.count}건
                          </span>
                          <span>
                            {formatCurrency(acc.amount)} ({(acc.share * 100).toFixed(1)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
