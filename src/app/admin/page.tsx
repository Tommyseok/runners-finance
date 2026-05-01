import Link from "next/link";
import {
  ChevronRight,
  CreditCard,
  ListChecks,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import type { BudgetCategory, Profile, Receipt } from "@/lib/db-types";
import { DownloadCards } from "./downloads/download-cards";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  const { data: pendingRows } = await supabase
    .from("receipt")
    .select("total_amount, user_id")
    .eq("org_id", orgId)
    .eq("status", "pending");
  const pending = (pendingRows ?? []) as Pick<Receipt, "total_amount" | "user_id">[];
  const pendingTotal = pending.reduce((s, r) => s + (r.total_amount ?? 0), 0);

  // 이번 달 카테고리별 합계
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);

  const { data: monthRows } = await supabase
    .from("receipt")
    .select("total_amount, category_id")
    .eq("org_id", orgId)
    .gte("expense_date", start)
    .lt("expense_date", end);
  const month = (monthRows ?? []) as Pick<
    Receipt,
    "total_amount" | "category_id"
  >[];

  const { data: catRows } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order");
  const categories = (catRows ?? []) as BudgetCategory[];
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  const byCategory = new Map<string, number>();
  for (const r of month) {
    const key = r.category_id ?? "__none__";
    byCategory.set(key, (byCategory.get(key) ?? 0) + (r.total_amount ?? 0));
  }
  const monthTotal = month.reduce((s, r) => s + (r.total_amount ?? 0), 0);

  // 교사별 청구 현황 (pending 합계)
  const byUser = new Map<string, number>();
  for (const r of pending) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + (r.total_amount ?? 0));
  }
  const userIds = Array.from(byUser.keys());
  let userNames = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("profile")
      .select("id, name")
      .in("id", userIds);
    userNames = new Map(
      ((users as Pick<Profile, "id" | "name">[] | null) ?? []).map((u) => [
        u.id,
        u.name ?? "(이름 없음)",
      ]),
    );
  }
  const userRows = Array.from(byUser.entries())
    .map(([uid, total]) => ({ uid, total, name: userNames.get(uid) ?? "" }))
    .sort((a, b) => b.total - a.total);

  const isDev = process.env.NODE_ENV === "development";
  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthOptions.push({
      value,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    });
  }

  return (
    <AppShell isAdmin>
      <PageHeader title="관리자" />
      <div className="space-y-3 px-4 py-4">
        <Link href="/admin/payments">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs opacity-80">송금 대기</div>
                <div className="mt-1 text-xl font-bold">
                  {formatCurrency(pendingTotal)}
                </div>
                <div className="text-xs opacity-80">{pending.length}건</div>
              </div>
              <Wallet className="h-8 w-8 opacity-90" />
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                이번 달 지출 ({now.getMonth() + 1}월)
              </div>
              <div className="text-sm font-bold">{formatCurrency(monthTotal)}</div>
            </div>
            {byCategory.size === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                지출 내역이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {Array.from(byCategory.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([catId, total]) => (
                    <li
                      key={catId}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        {catId === "__none__"
                          ? "(미지정)"
                          : (catMap.get(catId) ?? "-")}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(total)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 text-sm font-semibold">교사별 청구 (대기)</div>
            {userRows.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                대기중인 청구가 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {userRows.map((u) => (
                  <li
                    key={u.uid}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span>{u.name}</span>
                    <span className="font-medium">{formatCurrency(u.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <AdminLink href="/admin/payments" icon={ListChecks} label="송금 처리" />
          <AdminLink href="/admin/categories" icon={Tags} label="카테고리" />
          <AdminLink href="/admin/banks" icon={CreditCard} label="통장 관리" />
          <AdminLink href="/admin/users" icon={Users} label="사용자" />
        </div>

        <div className="pt-4">
          <div className="mb-2 px-1 text-sm font-semibold">다운로드</div>
          <DownloadCards
            isDev={isDev}
            categories={categories}
            months={monthOptions}
          />
        </div>
      </div>
    </AppShell>
  );
}

function AdminLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
