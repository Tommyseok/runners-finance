import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import type {
  BankAccount,
  BudgetCategory,
  Profile,
  Receipt,
  ReceiptImage,
} from "@/lib/db-types";
import { PaymentsListClient, type PaymentItem } from "./payments-list-client";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  const { data: rRows } = await supabase
    .from("receipt")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("expense_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const receipts = (rRows ?? []) as Receipt[];

  const userIds = Array.from(new Set(receipts.map((r) => r.user_id)));
  const catIds = Array.from(
    new Set(receipts.map((r) => r.category_id).filter(Boolean) as string[]),
  );
  const receiptIds = receipts.map((r) => r.id);

  const [{ data: usersRows }, { data: catRows }, { data: imgRows }, { data: bankRows }] =
    await Promise.all([
      userIds.length
        ? supabase.from("profile").select("id, name").in("id", userIds)
        : Promise.resolve({ data: [] }),
      catIds.length
        ? supabase
            .from("budget_category")
            .select("id, name")
            .in("id", catIds)
        : Promise.resolve({ data: [] }),
      receiptIds.length
        ? supabase
            .from("receipt_image")
            .select("*")
            .in("receipt_id", receiptIds)
            .order("sort_order")
        : Promise.resolve({ data: [] }),
      supabase
        .from("bank_account")
        .select("*")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("label"),
    ]);

  const userMap = new Map(
    ((usersRows as Pick<Profile, "id" | "name">[] | null) ?? []).map((u) => [
      u.id,
      u.name ?? "(이름 없음)",
    ]),
  );
  const catMap = new Map(
    ((catRows as Pick<BudgetCategory, "id" | "name">[] | null) ?? []).map(
      (c) => [c.id, c.name],
    ),
  );
  const banks = (bankRows ?? []) as BankAccount[];

  const images = (imgRows ?? []) as ReceiptImage[];
  const imagesByReceipt = new Map<string, ReceiptImage[]>();
  for (const img of images) {
    const arr = imagesByReceipt.get(img.receipt_id) ?? [];
    arr.push(img);
    imagesByReceipt.set(img.receipt_id, arr);
  }

  const signedByReceipt = new Map<string, string[]>();
  for (const [rid, imgs] of imagesByReceipt.entries()) {
    const urls = await Promise.all(
      imgs.map(async (img) => {
        const { data } = await supabase.storage
          .from("receipts")
          .createSignedUrl(img.storage_path, 3600);
        return data?.signedUrl ?? "";
      }),
    );
    signedByReceipt.set(rid, urls.filter(Boolean));
  }

  const total = receipts.reduce((s, r) => s + (r.total_amount ?? 0), 0);

  return (
    <AppShell isAdmin>
      <PageHeader title="송금 처리" back />
      <div className="space-y-3 px-4 py-4">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">대기 합계</span>
            <span className="text-lg font-bold">
              {formatCurrency(total)} ({receipts.length}건)
            </span>
          </CardContent>
        </Card>

        {receipts.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              송금할 항목이 없습니다.
            </CardContent>
          </Card>
        ) : (
          <PaymentsListClient
            banks={banks}
            items={receipts.map<PaymentItem>((r) => ({
              receipt: r,
              userName: userMap.get(r.user_id) ?? "",
              categoryName: r.category_id
                ? (catMap.get(r.category_id) ?? null)
                : null,
              imageUrls: signedByReceipt.get(r.id) ?? [],
            }))}
          />
        )}
      </div>
    </AppShell>
  );
}
