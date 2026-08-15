import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  buildContentDisposition,
  getAdminContextOrNull,
  safeFileSeg,
} from "@/lib/download-helpers";
import {
  buildSettlementDetails,
  expenseCategoryOrder,
  getSettlementData,
} from "@/lib/settlement";
import { buildSettlementWorkbook } from "@/lib/settlement-excel";
import type { LedgerRange } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const orgId = ctx.profile.org_id;

  let month = "all";
  let range: LedgerRange | undefined;
  let periodLabel = "전체기간";
  try {
    const body = (await req.json()) as {
      month?: string;
      from?: string;
      to?: string;
      periodLabel?: string;
    };
    month = body.month ?? "all";
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof body.from === "string" && DATE_RE.test(body.from) ? body.from : undefined;
    const to = typeof body.to === "string" && DATE_RE.test(body.to) ? body.to : undefined;
    if (from || to) range = { from, to };
    periodLabel =
      body.periodLabel ??
      (range ? `${from ?? ""}~${to ?? ""}` : month === "all" ? "전체기간" : month);
  } catch {
    /* default all */
  }

  const admin = createAdminClient();
  const data = await getSettlementData(admin, orgId, month, range);
  const details = buildSettlementDetails(data.splitEntries, expenseCategoryOrder(data.summary));
  const wb = buildSettlementWorkbook(data, details, periodLabel);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `결산-${safeFileSeg(data.orgName) || "org"}-${safeFileSeg(periodLabel)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
