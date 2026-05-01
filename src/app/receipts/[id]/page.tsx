import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireMembership } from "@/lib/auth";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type {
  BankAccount,
  BudgetCategory,
  Profile,
  Receipt,
  ReceiptImage,
} from "@/lib/db-types";
import { ReceiptImageGallery } from "./image-gallery";
import { ReceiptActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { user, profile, supabase } = await requireMembership();

  const { data: receiptRow } = await supabase
    .from("receipt")
    .select("*")
    .eq("id", params.id)
    .single();
  const receipt = receiptRow as Receipt | null;
  if (!receipt) notFound();

  const { data: imgRows } = await supabase
    .from("receipt_image")
    .select("*")
    .eq("receipt_id", receipt.id)
    .order("sort_order");
  const images = (imgRows ?? []) as ReceiptImage[];

  const signed = await Promise.all(
    images.map(async (img) => {
      const { data } = await supabase.storage
        .from("receipts")
        .createSignedUrl(img.storage_path, 3600);
      return { id: img.id, url: data?.signedUrl ?? "" };
    }),
  );

  let categoryName: string | null = null;
  if (receipt.category_id) {
    const { data: cat } = await supabase
      .from("budget_category")
      .select("name")
      .eq("id", receipt.category_id)
      .maybeSingle();
    categoryName = (cat as Pick<BudgetCategory, "name"> | null)?.name ?? null;
  }

  let payerName: string | null = null;
  let bankLabel: string | null = null;
  if (receipt.status === "paid") {
    if (receipt.paid_by) {
      const { data: payer } = await supabase
        .from("profile")
        .select("name")
        .eq("id", receipt.paid_by)
        .maybeSingle();
      payerName = (payer as Pick<Profile, "name"> | null)?.name ?? null;
    }
    if (receipt.paid_from_bank_id) {
      const { data: bank } = await supabase
        .from("bank_account")
        .select("label, bank_name")
        .eq("id", receipt.paid_from_bank_id)
        .maybeSingle();
      const b = bank as Pick<BankAccount, "label" | "bank_name"> | null;
      bankLabel = b ? `${b.bank_name} · ${b.label}` : null;
    }
  }

  const isOwner = receipt.user_id === user.id;
  const editable = isOwner && receipt.status === "pending";

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="영수증 상세" back />
      <div className="space-y-4 px-4 py-4">
        {signed.length > 0 && (
          <ReceiptImageGallery images={signed.filter((s) => s.url)} />
        )}

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">가맹점</div>
                <div className="text-base font-semibold">
                  {receipt.merchant ?? "-"}
                </div>
              </div>
              <Badge variant={receipt.status === "paid" ? "success" : "warning"}>
                {receipt.status === "paid" ? "입금완료" : "대기"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <Field label="사용일" value={formatDate(receipt.expense_date)} />
              <Field
                label="금액"
                value={formatCurrency(receipt.total_amount)}
                strong
              />
              <Field label="카테고리" value={categoryName ?? "-"} />
            </div>
            {receipt.description && (
              <div className="border-t pt-3">
                <div className="text-xs text-muted-foreground">메모</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">
                  {receipt.description}
                </div>
              </div>
            )}
            {Array.isArray(receipt.items) && receipt.items.length > 0 && (
              <div className="border-t pt-3">
                <div className="mb-2 text-xs text-muted-foreground">품목</div>
                <ul className="space-y-1 text-sm">
                  {receipt.items.map((it, idx) => (
                    <li key={idx} className="flex justify-between">
                      <span>{it.name}</span>
                      <span className="text-muted-foreground">
                        {it.qty ?? 1} × {formatCurrency(it.price ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold">환급 계좌</div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <Field label="은행" value={receipt.refund_bank_name ?? "-"} />
              <Field label="예금주" value={receipt.refund_holder ?? "-"} />
            </div>
            <Field label="계좌번호" value={receipt.refund_account ?? "-"} />
          </CardContent>
        </Card>

        {receipt.status === "paid" && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-sm font-semibold">입금 정보</div>
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <Field label="처리자" value={payerName ?? "-"} />
                <Field label="입금일시" value={formatDateTime(receipt.paid_at)} />
              </div>
              <Field label="출금 통장" value={bankLabel ?? "-"} />
            </CardContent>
          </Card>
        )}

        {editable && <ReceiptActions receiptId={receipt.id} />}
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? "text-base font-bold" : "text-sm"}>{value}</div>
    </div>
  );
}
