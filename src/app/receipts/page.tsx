import Link from "next/link";
import { Receipt as ReceiptIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireMembership } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { BudgetCategory, Receipt } from "@/lib/db-types";
import { ReceiptsFilters } from "./filters";

export const dynamic = "force-dynamic";

interface SearchParams {
  month?: string;
  category?: string;
  status?: string;
}

export default async function ReceiptsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { user, profile, supabase } = await requireMembership();

  const { data: cats } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", profile.org_id!)
    .order("sort_order");
  const categories = (cats ?? []) as BudgetCategory[];

  let query = supabase
    .from("receipt")
    .select("*")
    .eq("user_id", user.id)
    .order("expense_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (searchParams.status === "pending" || searchParams.status === "paid") {
    query = query.eq("status", searchParams.status);
  }
  if (searchParams.category) {
    query = query.eq("category_id", searchParams.category);
  }
  if (searchParams.month) {
    const [y, m] = searchParams.month.split("-").map(Number);
    if (y && m) {
      const start = new Date(y, m - 1, 1).toISOString().slice(0, 10);
      const end = new Date(y, m, 1).toISOString().slice(0, 10);
      query = query.gte("expense_date", start).lt("expense_date", end);
    }
  }

  const { data: rows } = await query;
  const receipts = (rows ?? []) as Receipt[];
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="내 영수증" />
      <div className="px-4 py-3">
        <ReceiptsFilters
          categories={categories}
          current={{
            month: searchParams.month ?? "",
            category: searchParams.category ?? "",
            status: searchParams.status ?? "",
          }}
        />
      </div>

      <div className="space-y-2 px-4 pb-4">
        {receipts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <ReceiptIcon className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                조건에 맞는 영수증이 없습니다.
              </p>
            </CardContent>
          </Card>
        ) : (
          receipts.map((r) => (
            <Link key={r.id} href={`/receipts/${r.id}`}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {r.merchant ?? "(가맹점 미입력)"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(r.expense_date)}</span>
                      {r.category_id && catMap.has(r.category_id) && (
                        <>
                          <span>·</span>
                          <span>{catMap.get(r.category_id)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="text-base font-bold">
                      {formatCurrency(r.total_amount)}
                    </div>
                    <Badge variant={r.status === "paid" ? "success" : "warning"}>
                      {r.status === "paid" ? "입금완료" : "대기"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </AppShell>
  );
}
