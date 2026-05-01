import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const { profile } = await requireUser();
  if (profile?.org_id) redirect("/");

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] px-5 pb-12 pt-12">
      <h1 className="text-2xl font-bold">환영합니다 👋</h1>
      <div className="mt-8">
        <OnboardingClient
          profileName={profile?.name ?? null}
          email={profile?.email ?? null}
        />
      </div>
    </div>
  );
}
