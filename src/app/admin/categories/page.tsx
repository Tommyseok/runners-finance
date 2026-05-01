import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { BudgetCategory } from "@/lib/db-types";
import { CategoriesClient } from "./categories-client";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const { profile, supabase } = await requireAdmin();
  const { data: rows } = await supabase
    .from("budget_category")
    .select("*")
    .eq("org_id", profile.org_id!)
    .order("sort_order");
  const categories = (rows ?? []) as BudgetCategory[];

  return (
    <AppShell isAdmin>
      <PageHeader title="카테고리 관리" back />
      <div className="px-4 py-4">
        <CategoriesClient orgId={profile.org_id!} initial={categories} />
      </div>
    </AppShell>
  );
}
