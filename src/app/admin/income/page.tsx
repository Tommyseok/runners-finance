import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { BankAccount, Income } from "@/lib/db-types";
import { IncomeClient } from "./income-client";

export const dynamic = "force-dynamic";

export default async function AdminIncomePage() {
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  const [{ data: incomeRaw }, { data: bankRaw }] = await Promise.all([
    supabase
      .from("income")
      .select("*")
      .eq("org_id", orgId)
      .order("income_date", { ascending: false })
      .limit(200),
    supabase
      .from("bank_account")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("label"),
  ]);

  const income = (incomeRaw ?? []) as Income[];
  const accounts = (bankRaw ?? []) as BankAccount[];

  return (
    <AppShell isAdmin>
      <PageHeader title="수입 관리" back />
      <div className="px-4 py-4">
        <IncomeClient orgId={orgId} initial={income} accounts={accounts} />
      </div>
    </AppShell>
  );
}
