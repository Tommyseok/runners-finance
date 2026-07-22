import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/server";
import {
  buildContentDisposition,
  getAdminContextOrNull,
  safeFileSeg,
} from "@/lib/download-helpers";
import type { Income } from "@/lib/db-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = ["수련회비", "QT도서비", "회비", "헌금"] as const;

function payerName(memo: string | null): string {
  if (!memo) return "(이름 없음)";
  return (
    memo
      .replace(/수련회비|수련회|회비|큐티책|큐티|QT|도서|고등부|고등/gi, "")
      .replace(/[0-9]학년|고[1-3]|[1-3]학년|[_\s·()]/g, "")
      .replace(/^[0-9]+|[0-9]+$/g, "")
      .trim() || memo
  );
}

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const orgId = ctx.profile.org_id;

  let category = "수련회비";
  try {
    const body = (await req.json()) as { category?: string };
    if (body.category && (ALLOWED as readonly string[]).includes(body.category)) {
      category = body.category;
    }
  } catch {
    /* default */
  }

  const admin = createAdminClient();
  const [{ data: rows }, orgRes] = await Promise.all([
    admin
      .from("income")
      .select("*")
      .eq("org_id", orgId)
      .eq("category", category)
      .eq("excluded", false)
      .order("income_date", { ascending: true }),
    admin.from("organization").select("name").eq("id", orgId).single(),
  ]);
  const items = (rows ?? []) as Income[];
  const orgName = (orgRes.data as { name: string } | null)?.name ?? "조직";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${category} 납부자`);

  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = `${orgName} ${category} 납부자 명단`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  const total = items.reduce((s, i) => s + i.amount, 0);
  ws.mergeCells("A2:E2");
  ws.getCell("A2").value = `총 ${items.length}명 · ${total.toLocaleString("ko-KR")}원 (집계 제외분 미포함)`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  const headers = ["번호", "납부자(추정)", "입금일", "금액", "입금 메모(원본)"];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 28 }];

  items.forEach((inc, i) => {
    const row = ws.getRow(5 + i);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = payerName(inc.memo);
    row.getCell(3).value = inc.income_date;
    row.getCell(4).value = inc.amount;
    row.getCell(5).value = inc.memo ?? "";
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).numFmt = "#,##0";
  });

  const totalRow = ws.getRow(5 + items.length + 1);
  totalRow.getCell(2).value = "합계";
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(4).value = total;
  totalRow.getCell(4).numFmt = "#,##0";
  totalRow.getCell(4).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 4 }];

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `${safeFileSeg(category)}_납부자-${safeFileSeg(orgName) || "org"}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
