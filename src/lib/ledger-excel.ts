import type ExcelJS from "exceljs";
import type { EnrichedLedgerEntry } from "@/lib/ledger";

export const LEDGER_HEADERS = [
  "거래일", "계좌", "구분", "입금", "출금", "잔액",
  "거래처", "계정항목", "내용·지출인", "영수증No", "대사상태", "거래번호",
] as const;

export const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2F5496" },
};

export const UNMATCHED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF2CC" },
};

/** "[훈련비] 여름수련회" → "여름수련회" (표기용 짧은 카테고리명) */
export function shortCategoryLabel(category: string): string {
  return category.replace(/^\[[^\]]*\]\s*/, "");
}

/** 영수증 번호 표기: "167-여름수련회". 카테고리가 없거나 구조 항목("(비지출)" 등)이면 번호만. */
export function formatReceiptRef(receiptNo: number | null, category: string): string {
  if (receiptNo == null) return "";
  const short = shortCategoryLabel(category);
  return short && !short.startsWith("(") ? `${receiptNo}-${short}` : String(receiptNo);
}

export function ledgerStatusLabel(e: EnrichedLedgerEntry): string {
  return e.kind === "wash"
    ? "잘못입금"
    : e.kind === "transfer"
      ? "내부이체"
      : e.direction === "income"
        ? "수입"
        : e.matchStatus === "matched"
          ? "영수증매칭"
          : "영수증없음";
}

/** 4행 헤더(11칸)를 FF2F5496 스타일로 그린다. col6Label로 잔액↔누계 전환. */
export function drawLedgerHeaderRow(
  ws: ExcelJS.Worksheet,
  rowNo: number,
  col6Label = "잔액",
): void {
  const headers = LEDGER_HEADERS.map((h, i) => (i === 5 ? col6Label : h));
  const headerRow = ws.getRow(rowNo);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.columns = [
    { width: 12 }, { width: 12 }, { width: 7 }, { width: 12 }, { width: 12 },
    { width: 13 }, { width: 18 }, { width: 18 }, { width: 26 }, { width: 16 }, { width: 12 },
    { width: 13 },
  ];
}

/**
 * 원장 데이터 행 1줄. col6에는 balance 또는 누계 등 호출부가 정한 값.
 * highlightUnmatched=true면 영수증 미매칭 지출 행을 노란색으로 강조.
 */
export function drawLedgerEntryRow(
  ws: ExcelJS.Worksheet,
  rowNo: number,
  e: EnrichedLedgerEntry,
  col6Value: number | null,
  highlightUnmatched = true,
): void {
  const content = e.content + (e.payer ? ` · ${e.payer}` : "");
  const row = ws.getRow(rowNo);
  row.getCell(1).value = e.txnDate;
  row.getCell(2).value = e.accountLabel;
  row.getCell(3).value = e.direction === "income" ? "입금" : "출금";
  row.getCell(4).value = e.deposit > 0 ? e.deposit : null;
  row.getCell(5).value = e.withdraw > 0 ? e.withdraw : null;
  row.getCell(6).value = col6Value;
  row.getCell(7).value = e.counterparty ?? "";
  row.getCell(8).value = e.category;
  row.getCell(9).value = content;
  row.getCell(10).value = formatReceiptRef(e.receiptNo, e.category);
  row.getCell(11).value = ledgerStatusLabel(e);
  row.getCell(12).value = e.txnRef;
  for (const c of [4, 5, 6]) row.getCell(c).numFmt = "#,##0";
  row.getCell(3).alignment = { horizontal: "center" };
  row.getCell(10).alignment = { horizontal: "center" };
  row.getCell(11).alignment = { horizontal: "center" };
  row.getCell(12).alignment = { horizontal: "center" };
  if (highlightUnmatched && e.matchStatus === "unmatched" && e.kind === "expense") {
    for (let c = 1; c <= 12; c += 1) row.getCell(c).fill = UNMATCHED_FILL;
  }
}

export interface LedgerSheetOptions {
  sheetName: string;
  orgName: string;
  periodLabel: string;
  entries: EnrichedLedgerEntry[];
  totalBalance: number;
}

/**
 * 입출금 원장 시트 전체(제목·요약·헤더·데이터·합계·틀고정·자동필터)를 추가.
 * 기존 ledger-excel 다운로드와 결산 엑셀의 1번 시트가 공유한다.
 */
export function addLedgerSheet(
  wb: ExcelJS.Workbook,
  opts: LedgerSheetOptions,
): { incomeTotal: number; expenseTotal: number } {
  const { sheetName, orgName, periodLabel, entries, totalBalance } = opts;
  const ws = wb.addWorksheet(sheetName);

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${orgName} 입출금 원장 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  const incomeTotal = entries
    .filter((e) => e.kind !== "wash" && e.kind !== "transfer" && e.direction === "income")
    .reduce((s, e) => s + e.deposit, 0);
  const expenseTotal = entries
    .filter((e) => e.kind !== "wash" && e.kind !== "transfer" && e.direction === "expense")
    .reduce((s, e) => s + e.withdraw, 0);
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value = `수입 ${incomeTotal.toLocaleString("ko-KR")}원  |  지출 ${expenseTotal.toLocaleString("ko-KR")}원  |  현재잔액 ${totalBalance.toLocaleString("ko-KR")}원`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  drawLedgerHeaderRow(ws, 4);

  let r = 5;
  for (const e of entries) {
    drawLedgerEntryRow(ws, r, e, e.balance);
    r += 1;
  }

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
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 12 } };

  return { incomeTotal, expenseTotal };
}
