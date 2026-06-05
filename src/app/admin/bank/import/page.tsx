import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import type { BankAccount } from "@/lib/db-types";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function BankImportPage() {
  const { profile, supabase } = await requireAdmin();
  const { data } = await supabase
    .from("bank_account")
    .select("*")
    .eq("org_id", profile.org_id!)
    .eq("is_active", true)
    .order("label");
  const accounts = (data ?? []) as BankAccount[];

  return (
    <AppShell isAdmin>
      <PageHeader title="통장 내역 업로드" back />
      <div className="px-4 py-4">
        <ImportClient accounts={accounts} />
      </div>
    </AppShell>
  );
}
