import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminContextOrNull } from "@/lib/download-helpers";
import { reconcileOrg, deriveIncome } from "@/lib/bank-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  try {
    const admin = createAdminClient();
    const { matched, unmatched } = await reconcileOrg(admin, ctx.profile.org_id);
    const incomeCreated = await deriveIncome(admin, ctx.profile.org_id);
    return NextResponse.json({ success: true, matched, unmatched, incomeCreated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "재대사 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
