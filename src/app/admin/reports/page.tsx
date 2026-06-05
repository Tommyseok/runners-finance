import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { BudgetCategory } from "@/lib/db-types";
import { ReportClient } from "./report-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { profile, supabase } = await requireAdmin();
  const { data } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", profile.org_id!)
    .order("sort_order");
  const categories = (data ?? []) as BudgetCategory[];

  return (
    <AppShell isAdmin>
      <PageHeader title="지출 영수증 증빙 (PDF)" back />
      <div className="px-4 py-4">
        <ReportClient categories={categories} />
      </div>
    </AppShell>
  );
}
