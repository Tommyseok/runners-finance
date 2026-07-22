import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { Income } from "@/lib/db-types";
import { PayersClient } from "./payers-client";

export const dynamic = "force-dynamic";

export default async function IncomePayersPage() {
  const { profile, supabase } = await requireAdmin();
  const orgId = profile.org_id!;

  const { data } = await supabase
    .from("income")
    .select("*")
    .eq("org_id", orgId)
    .in("category", ["수련회비", "QT도서비"])
    .eq("excluded", false)
    .order("income_date", { ascending: true });

  return (
    <AppShell isAdmin>
      <PageHeader title="납부자 현황" back />
      <div className="px-4 py-4">
        <PayersClient initial={(data ?? []) as Income[]} />
      </div>
    </AppShell>
  );
}
