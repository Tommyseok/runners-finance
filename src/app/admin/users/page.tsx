import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import type { Organization, Profile } from "@/lib/db-types";
import { UsersClient, InviteCodeBox } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { user, profile, supabase } = await requireAdmin();

  const { data: orgRow } = await supabase
    .from("organization")
    .select("*")
    .eq("id", profile.org_id!)
    .single();
  const org = orgRow as Organization | null;

  const { data: rows } = await supabase
    .from("profile")
    .select("id, name, email, role")
    .eq("org_id", profile.org_id!)
    .order("name");
  const users = (rows ?? []) as Pick<Profile, "id" | "name" | "email" | "role">[];

  return (
    <AppShell isAdmin>
      <PageHeader title="사용자 관리" back />
      <div className="space-y-4 px-4 py-4">
        {org && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">조직 이름</div>
              <div className="text-base font-semibold">{org.name}</div>
              <div className="mt-3 text-xs text-muted-foreground">초대코드</div>
              <InviteCodeBox code={org.invite_code} />
            </CardContent>
          </Card>
        )}

        <UsersClient currentUserId={user.id} initial={users} />
      </div>
    </AppShell>
  );
}
