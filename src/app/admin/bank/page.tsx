import Link from "next/link";
import { Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getBankBalances } from "@/lib/ledger";
import type { BankImportBatch, BankTransaction } from "@/lib/db-types";
import { ReconcileButton } from "./reconcile-button";

export const dynamic = "force-dynamic";

export default async function AdminBankPage() {
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  const [balances, { data: unmatchedRaw }, { data: batchRaw }, { data: recentRaw }] =
    await Promise.all([
      getBankBalances(supabase, orgId),
      supabase
        .from("bank_transaction")
        .select("*")
        .eq("org_id", orgId)
        .eq("kind", "expense")
        .eq("match_status", "unmatched")
        .order("txn_at", { ascending: false }),
      supabase
        .from("bank_import_batch")
        .select("*")
        .eq("org_id", orgId)
        .order("imported_at", { ascending: false })
        .limit(10),
      supabase
        .from("bank_transaction")
        .select("*")
        .eq("org_id", orgId)
        .order("txn_at", { ascending: false })
        .limit(30),
    ]);

  const unmatched = (unmatchedRaw ?? []) as BankTransaction[];
  const batches = (batchRaw ?? []) as BankImportBatch[];
  const recent = (recentRaw ?? []) as BankTransaction[];

  return (
    <AppShell isAdmin>
      <PageHeader title="통장 관리" back />
      <div className="space-y-3 px-4 py-4">
        <Link href="/admin/bank/import">
          <Button className="w-full">
            <Upload className="h-4 w-4" /> 월별 통장 .xls 업로드
          </Button>
        </Link>

        {/* 잔액 */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-semibold">계좌 잔액</div>
            {balances.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                통장이 없습니다.
              </p>
            ) : (
              balances.map((b) => (
                <div
                  key={b.bankAccountId}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{b.label}</span>
                  <span className="font-semibold">
                    {b.balance === null ? "미등록" : formatCurrency(b.balance)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <ReconcileButton />

        {/* 미매칭(영수증 없는 지출) */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">영수증 없는 지출</div>
              <Badge variant={unmatched.length ? "warning" : "success"}>
                {unmatched.length}건
              </Badge>
            </div>
            {unmatched.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                모든 지출이 영수증과 매칭되었습니다 ✓
              </p>
            ) : (
              <ul className="divide-y">
                {unmatched.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{t.counterparty}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(t.txn_at)} · {t.method}
                      </div>
                    </div>
                    <span className="font-semibold text-rose-700">
                      {formatCurrency(t.withdraw)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 최근 거래 */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 text-sm font-semibold">최근 거래 (30건)</div>
            {recent.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                업로드된 거래가 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {recent.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{t.counterparty ?? "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(t.txn_at)}
                      </div>
                    </div>
                    <span
                      className={
                        t.deposit > 0
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-rose-700"
                      }
                    >
                      {t.deposit > 0 ? "+" : "−"}
                      {formatCurrency(t.deposit > 0 ? t.deposit : t.withdraw)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 업로드 이력 */}
        {batches.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-sm font-semibold">업로드 이력</div>
              <ul className="divide-y">
                {batches.map((b) => (
                  <li key={b.id} className="py-2 text-xs text-muted-foreground">
                    {formatDate(b.imported_at)} · {b.file_name} · {b.row_count}건
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
