import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Landmark } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireMembership } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getBankBalances, getEnrichedLedger, monthOptions } from "@/lib/ledger";
import { LedgerExcelButton } from "./ledger-excel-button";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const { profile, supabase } = await requireMembership();
  const orgId = profile.org_id!;
  const month = searchParams.month ?? "all";
  const isAdmin = profile.role === "admin";

  const [balances, entries] = await Promise.all([
    getBankBalances(supabase, orgId),
    getEnrichedLedger(supabase, orgId, month),
  ]);

  const real = entries.filter((e) => e.kind !== "wash" && e.kind !== "transfer");
  const incomeTotal = real
    .filter((e) => e.direction === "income")
    .reduce((s, e) => s + e.deposit, 0);
  const expenseTotal = real
    .filter((e) => e.direction === "expense")
    .reduce((s, e) => s + e.withdraw, 0);
  const ledger = { entries, incomeTotal, expenseTotal };

  const totalBalance = balances.reduce((s, b) => s + (b.balance ?? 0), 0);
  const months = monthOptions();

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="입출금 원장" />
      <div className="space-y-3 px-4 py-4">
        {/* 잔액 요약 */}
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-5">
            <div className="text-xs opacity-80">전체 잔액</div>
            <div className="mt-1 text-2xl font-bold">
              {formatCurrency(totalBalance)}
            </div>
            <div className="mt-3 space-y-1">
              {balances.map((b) => (
                <div
                  key={b.bankAccountId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="opacity-90">
                    <Landmark className="mr-1 inline h-3.5 w-3.5" />
                    {b.label}
                  </span>
                  <span className="font-semibold">
                    {b.balance === null ? "통장 미등록" : formatCurrency(b.balance)}
                  </span>
                </div>
              ))}
              {balances.length === 0 && (
                <div className="text-xs opacity-80">등록된 통장이 없습니다.</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 수입/지출 요약 */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-600" /> 수입
              </div>
              <div className="mt-1 text-lg font-bold text-emerald-700">
                {formatCurrency(ledger.incomeTotal)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowDownCircle className="h-3.5 w-3.5 text-rose-600" /> 지출
              </div>
              <div className="mt-1 text-lg font-bold text-rose-700">
                {formatCurrency(ledger.expenseTotal)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 월 필터 */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {months.slice(0, 7).map((m) => (
            <Link
              key={m.value}
              href={`/ledger?month=${m.value}`}
              className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                month === m.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {m.label}
            </Link>
          ))}
        </div>

        {isAdmin && <LedgerExcelButton month={month} />}

        {/* 거래 목록 */}
        <Card>
          <CardContent className="p-0">
            {ledger.entries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                통장 내역이 없습니다.
                {profile.role === "admin" && (
                  <div className="mt-2">
                    <Link href="/admin/bank/import" className="text-primary underline">
                      통장 .xls 업로드하기
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {ledger.entries.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {e.counterparty ?? "(거래처 미상)"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{formatDate(e.txnDate)}</span>
                          <span>· {e.category}</span>
                          {e.receiptNo != null && (
                            <Badge variant="secondary" className="text-[10px]">
                              영수증 #{e.receiptNo}
                            </Badge>
                          )}
                          {e.kind === "wash" && (
                            <Badge variant="secondary" className="text-[10px]">
                              잘못입금
                            </Badge>
                          )}
                          {e.kind === "transfer" && (
                            <Badge variant="secondary" className="text-[10px]">
                              내부이체
                            </Badge>
                          )}
                          {e.direction === "expense" &&
                            e.kind === "expense" &&
                            e.matchStatus === "unmatched" && (
                              <Badge variant="warning" className="text-[10px]">
                                영수증 없음
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
                        <div
                          className={`text-sm font-semibold ${
                            e.direction === "income"
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          {e.direction === "income" ? "+" : "−"}
                          {formatCurrency(
                            e.direction === "income" ? e.deposit : e.withdraw,
                          )}
                        </div>
                        {e.balance !== null && (
                          <div className="text-[11px] text-muted-foreground">
                            잔액 {formatCurrency(e.balance)}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
