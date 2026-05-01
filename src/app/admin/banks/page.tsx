import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { BankAccount } from "@/lib/db-types";
import { BanksClient } from "./banks-client";

export const dynamic = "force-dynamic";

export default async function BanksPage() {
  const { profile, supabase } = await requireAdmin();
  const { data: rows } = await supabase
    .from("bank_account")
    .select("*")
    .eq("org_id", profile.org_id!)
    .order("label");
  const banks = (rows ?? []) as BankAccount[];

  return (
    <AppShell isAdmin>
      <PageHeader title="통장 관리" back />
      <div className="px-4 py-4">
        <BanksClient orgId={profile.org_id!} initial={banks} />
      </div>
    </AppShell>
  );
}
