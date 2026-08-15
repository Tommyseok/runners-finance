import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminContextOrNull } from "@/lib/download-helpers";
import { buildIncomeDetail, getSettlementData } from "@/lib/settlement";
import type { LedgerRange } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const orgId = ctx.profile.org_id;

  let from: string | undefined;
  let to: string | undefined;
  let periodLabel = "전체기간";
  let action: "publish" | "unpublish" = "publish";
  try {
    const body = (await req.json()) as {
      from?: string;
      to?: string;
      periodLabel?: string;
      action?: "publish" | "unpublish";
    };
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    from = typeof body.from === "string" && DATE_RE.test(body.from) ? body.from : undefined;
    to = typeof body.to === "string" && DATE_RE.test(body.to) ? body.to : undefined;
    periodLabel = body.periodLabel ?? (from || to ? `${from ?? ""}~${to ?? ""}` : "전체기간");
    if (body.action === "unpublish") action = "unpublish";
  } catch {
    /* default */
  }

  const admin = createAdminClient();

  if (action === "unpublish") {
    const { error } = await admin
      .from("settlement_publication")
      .update({ is_active: false })
      .eq("org_id", orgId)
      .eq("is_active", true);
    if (error) {
      return NextResponse.json({ error: "게시 취소에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const range: LedgerRange | undefined = from || to ? { from, to } : undefined;
  const data = await getSettlementData(admin, orgId, "all", range);
  const income = buildIncomeDetail(data.entries);
  const expenseRows = data.summary
    .filter(
      (r) =>
        r.expenseTotal > 0 &&
        r.category !== "(비지출)" &&
        r.category !== "(미분류 잔액)",
    )
    .map((r) => ({ category: r.category, amount: r.expenseTotal }))
    .sort((a, b) => b.amount - a.amount);

  const { error: deactivateErr } = await admin
    .from("settlement_publication")
    .update({ is_active: false })
    .eq("org_id", orgId)
    .eq("is_active", true);
  if (deactivateErr) {
    return NextResponse.json(
      { error: "게시 준비 중 오류가 발생했습니다. 마이그레이션(0006) 적용 여부를 확인하세요." },
      { status: 500 },
    );
  }

  const { error: insertErr } = await admin.from("settlement_publication").insert({
    org_id: orgId,
    period_label: periodLabel,
    date_from: from ?? null,
    date_to: to ?? null,
    income_total: data.ledgerIncomeTotal,
    expense_total: data.ledgerExpenseTotal,
    summary: { incomeGroups: income.groups, expenseRows },
    published_by: ctx.profile.id,
  });
  if (insertErr) {
    return NextResponse.json({ error: "게시 저장에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
