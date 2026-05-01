import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth";
import type { Organization } from "@/lib/db-types";
import { ProfileForm } from "./profile-form";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { profile, supabase } = await requireMembership();

  const { data: orgRow } = await supabase
    .from("organization")
    .select("name")
    .eq("id", profile.org_id!)
    .single();
  const org = orgRow as Pick<Organization, "name"> | null;

  return (
    <AppShell isAdmin={profile.role === "admin"}>
      <PageHeader title="프로필" />
      <div className="space-y-4 px-4 py-4">
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-xs text-muted-foreground">소속 조직</div>
            <div className="text-base font-semibold">{org?.name ?? "-"}</div>
            <div className="mt-2 text-xs text-muted-foreground">권한</div>
            <div className="text-sm">
              {profile.role === "admin" ? "관리자 (회계담당)" : "교사"}
            </div>
          </CardContent>
        </Card>

        <ProfileForm
          profile={{
            id: profile.id,
            name: profile.name,
            email: profile.email,
            bank_name: profile.bank_name,
            bank_account: profile.bank_account,
            account_holder: profile.account_holder,
          }}
        />

        <LogoutButton />
      </div>
    </AppShell>
  );
}
