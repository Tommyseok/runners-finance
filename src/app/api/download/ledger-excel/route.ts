import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/server";
import {
  buildContentDisposition,
  getAdminContextOrNull,
  safeFileSeg,
} from "@/lib/download-helpers";
import { getBankBalances, getEnrichedLedger } from "@/lib/ledger";
import { addLedgerSheet } from "@/lib/ledger-excel";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const orgId = ctx.profile.org_id;

  let month = "all";
  try {
    const body = (await req.json()) as { month?: string };
    month = body.month ?? "all";
  } catch {
    /* default all */
  }

  const admin = createAdminClient();
  const [entries, balances, orgRes] = await Promise.all([
    getEnrichedLedger(admin, orgId, month),
    getBankBalances(admin, orgId),
    admin.from("organization").select("name").eq("id", orgId).single(),
  ]);
  const orgName = (orgRes.data as { name: string } | null)?.name ?? "조직";

  const wb = new ExcelJS.Workbook();
  const periodLabel = month === "all" ? "전체기간" : month;
  const totalBalance = balances.reduce((s, b) => s + (b.balance ?? 0), 0);
  addLedgerSheet(wb, {
    sheetName: "입출금원장",
    orgName,
    periodLabel,
    entries,
    totalBalance,
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `입출금원장-${safeFileSeg(orgName) || "org"}-${safeFileSeg(periodLabel)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
