import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireMembership } from "@/lib/auth";
import type { BudgetCategory } from "@/lib/db-types";
import { NewReceiptForm } from "./new-receipt-form";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  const { profile, supabase } = await requireMembership();

  const { data: cats } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", profile.org_id!)
    .eq("is_active", true)
    .order("sort_order");

  const categories = (cats ?? []) as BudgetCategory[];

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="영수증 등록" back />
      <div className="px-4 py-4">
        <NewReceiptForm
          categories={categories}
          defaults={{
            refund_bank_name: profile.bank_name,
            refund_account: profile.bank_account,
            refund_holder: profile.account_holder ?? profile.name,
          }}
        />
      </div>
    </AppShell>
  );
}
