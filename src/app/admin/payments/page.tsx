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

type StatusFilter = "pending" | "paid" | "all";

function parseStatus(v: string | string[] | undefined): StatusFilter {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "paid" || s === "all") return s;
  return "pending";
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = parseStatus(searchParams.status);
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  let query = supabase.from("receipt").select("*").eq("org_id", orgId);
  if (status === "pending") {
    query = query
      .eq("status", "pending")
      .order("expense_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
  } else if (status === "paid") {
    query = query
      .eq("status", "paid")
      .order("paid_at", { ascending: false, nullsFirst: false });
  } else {
    query = query
      .order("status", { ascending: true })
      .order("expense_date", { ascending: false, nullsFirst: false });
  }
  const { data: rRows } = await query;
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
  const allBanks = (bankRows ?? []) as BankAccount[];
  const activeBanks = allBanks.filter((b) => b.is_active);
  const bankLabelById = new Map(
    allBanks.map((b) => [b.id, `${b.bank_name} · ${b.label}`]),
  );

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

  const summaryLabel =
    status === "paid"
      ? "송금완료 합계"
      : status === "all"
        ? "전체 합계"
        : "대기 합계";

  const emptyText =
    status === "paid"
      ? "송금완료된 항목이 없습니다."
      : status === "all"
        ? "표시할 항목이 없습니다."
        : "송금할 항목이 없습니다.";

  return (
    <AppShell isAdmin>
      <PageHeader title="송금 처리" back />
      <div className="space-y-3 px-4 py-4">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">{summaryLabel}</span>
            <span className="text-lg font-bold">
              {formatCurrency(total)} ({receipts.length}건)
            </span>
          </CardContent>
        </Card>

        <PaymentsListClient
          status={status}
          banks={activeBanks}
          showStatusBadge={status === "all"}
          items={receipts.map<PaymentItem>((r) => ({
            receipt: r,
            userName: userMap.get(r.user_id) ?? "",
            categoryName: r.category_id
              ? (catMap.get(r.category_id) ?? null)
              : null,
            imageUrls: signedByReceipt.get(r.id) ?? [],
            paidFromBankLabel: r.paid_from_bank_id
              ? (bankLabelById.get(r.paid_from_bank_id) ?? null)
              : null,
          }))}
          emptyText={emptyText}
        />
      </div>
    </AppShell>
  );
}
