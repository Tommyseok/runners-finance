import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/server";
import {
  buildContentDisposition,
  getAdminContextOrNull,
  safeFileSeg,
} from "@/lib/download-helpers";
import { getBankBalances, getEnrichedLedger } from "@/lib/ledger";

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
  const ws = wb.addWorksheet("입출금원장");

  const periodLabel = month === "all" ? "전체기간" : month;
  // 제목 + 요약
  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${orgName} 입출금 원장 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  const totalBalance = balances.reduce((s, b) => s + (b.balance ?? 0), 0);
  const incomeTotal = entries
    .filter((e) => e.kind !== "wash" && e.kind !== "transfer" && e.direction === "income")
    .reduce((s, e) => s + e.deposit, 0);
  const expenseTotal = entries
    .filter((e) => e.kind !== "wash" && e.kind !== "transfer" && e.direction === "expense")
    .reduce((s, e) => s + e.withdraw, 0);
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value = `수입 ${incomeTotal.toLocaleString("ko-KR")}원  |  지출 ${expenseTotal.toLocaleString("ko-KR")}원  |  현재잔액 ${totalBalance.toLocaleString("ko-KR")}원`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  // 헤더 (row 4)
  const headers = [
    "거래일", "계좌", "구분", "입금", "출금", "잔액",
    "거래처", "계정항목", "내용·지출인", "영수증No", "대사상태",
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.columns = [
    { width: 12 }, { width: 12 }, { width: 7 }, { width: 12 }, { width: 12 },
    { width: 13 }, { width: 18 }, { width: 18 }, { width: 26 }, { width: 10 }, { width: 12 },
  ];

  let r = 5;
  for (const e of entries) {
    const statusLabel =
      e.kind === "wash"
        ? "잘못입금"
        : e.kind === "transfer"
          ? "내부이체"
          : e.direction === "income"
            ? "수입"
            : e.matchStatus === "matched"
              ? "영수증매칭"
              : "영수증없음";
    const content = e.content + (e.payer ? ` · ${e.payer}` : "");
    const row = ws.getRow(r);
    row.getCell(1).value = e.txnDate;
    row.getCell(2).value = e.accountLabel;
    row.getCell(3).value = e.direction === "income" ? "입금" : "출금";
    row.getCell(4).value = e.deposit > 0 ? e.deposit : null;
    row.getCell(5).value = e.withdraw > 0 ? e.withdraw : null;
    row.getCell(6).value = e.balance;
    row.getCell(7).value = e.counterparty ?? "";
    row.getCell(8).value = e.category;
    row.getCell(9).value = content;
    row.getCell(10).value = e.receiptNo ?? "";
    row.getCell(11).value = statusLabel;
    for (const c of [4, 5, 6]) row.getCell(c).numFmt = "#,##0";
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(10).alignment = { horizontal: "center" };
    row.getCell(11).alignment = { horizontal: "center" };
    if (e.matchStatus === "unmatched" && e.kind === "expense") {
      for (let c = 1; c <= 11; c += 1) {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      }
    }
    r += 1;
  }

  // 합계 행
  const totalRow = ws.getRow(r + 1);
  totalRow.getCell(3).value = "합계";
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(4).value = incomeTotal;
  totalRow.getCell(5).value = expenseTotal;
  totalRow.getCell(4).numFmt = "#,##0";
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(5).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 11 } };

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
