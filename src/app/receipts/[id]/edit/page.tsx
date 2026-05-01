import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireMembership } from "@/lib/auth";
import type { BudgetCategory, Receipt } from "@/lib/db-types";
import { EditReceiptForm } from "./edit-form";

export const dynamic = "force-dynamic";

export default async function EditReceiptPage({
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

  if (receipt.user_id !== user.id || receipt.status !== "pending") {
    redirect(`/receipts/${params.id}`);
  }

  const { data: cats } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", profile.org_id!)
    .eq("is_active", true)
    .order("sort_order");
  const categories = (cats ?? []) as BudgetCategory[];

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="영수증 수정" back />
      <div className="px-4 py-4">
        <EditReceiptForm receipt={receipt} categories={categories} />
      </div>
    </AppShell>
  );
}
