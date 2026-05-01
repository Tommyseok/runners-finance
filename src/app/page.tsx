import Link from "next/link";
import { Camera, Receipt, Wallet, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireMembership } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Organization, Receipt as ReceiptT } from "@/lib/db-types";
import { WelcomeBanner } from "./welcome-banner";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { welcome?: string };
}) {
  const { user, profile, supabase } = await requireMembership();

  const { data: orgRow } = await supabase
    .from("organization")
    .select("name")
    .eq("id", profile.org_id!)
    .maybeSingle();
  const orgName = (orgRow as Pick<Organization, "name"> | null)?.name ?? null;

  const { data: pendingRows } = await supabase
    .from("receipt")
    .select("total_amount")
    .eq("user_id", user.id)
    .eq("status", "pending");

  const pendingTotal = (pendingRows ?? []).reduce(
    (sum: number, r: { total_amount: number | null }) =>
      sum + (r.total_amount ?? 0),
    0,
  );
  const pendingCount = pendingRows?.length ?? 0;

  const { data: recentRows } = await supabase
    .from("receipt")
    .select("id, merchant, expense_date, total_amount, status, category_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const recent = (recentRows ?? []) as Pick<
    ReceiptT,
    "id" | "merchant" | "expense_date" | "total_amount" | "status" | "category_id"
  >[];

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      {searchParams.welcome === "1" && <WelcomeBanner orgName={orgName} />}
      <div className="px-4 pb-6 pt-6">
        <div className="mb-1 text-sm text-muted-foreground">
          안녕하세요, {profile.name ? `${profile.name}님` : "선생님"} 👋
        </div>
        <h1 className="text-2xl font-bold">{orgName ?? "Runners Finance"}</h1>
      </div>

      <div className="space-y-3 px-4">
        <Link href="/receipts/new">
          <Card className="bg-primary text-primary-foreground transition-transform active:scale-[0.99]">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs opacity-80">새 지출 등록</div>
                <div className="mt-1 text-lg font-semibold">영수증 촬영하기</div>
              </div>
              <Camera className="h-8 w-8 opacity-90" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/receipts?status=pending">
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs text-muted-foreground">내 환급 대기</div>
                <div className="mt-1 text-lg font-semibold">
                  {formatCurrency(pendingTotal)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {pendingCount}건
                </div>
              </div>
              <Wallet className="h-7 w-7 text-primary" />
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-4 pb-2">
              <div className="text-sm font-semibold">최근 영수증</div>
              <Link
                href="/receipts"
                className="flex items-center text-xs text-muted-foreground"
              >
                전체보기 <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
                <Receipt className="h-8 w-8 opacity-50" />
                <div className="text-sm">아직 등록한 영수증이 없습니다.</div>
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/receipts/${r.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {r.merchant ?? "(가맹점 미입력)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(r.expense_date)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">
                          {formatCurrency(r.total_amount)}
                        </div>
                        <Badge
                          variant={r.status === "paid" ? "success" : "warning"}
                          className="shrink-0"
                        >
                          {r.status === "paid" ? "입금완료" : "대기"}
                        </Badge>
                      </div>
                    </Link>
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
