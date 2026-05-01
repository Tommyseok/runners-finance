import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/db-types";

export async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profile")
    .select("*")
    .eq("id", user.id)
    .single();

  return { user, profile: data as Profile | null, supabase };
}

export async function requireMembership() {
  const { user, profile, supabase } = await requireUser();
  if (!profile || !profile.org_id) redirect("/onboarding");
  return { user, profile, supabase };
}

export async function requireAdmin() {
  const { user, profile, supabase } = await requireMembership();
  if (profile.role !== "admin") redirect("/");
  return { user, profile, supabase };
}
