import ExcelJS from "exceljs";
import {
  addLedgerSheet,
  drawLedgerEntryRow,
  drawLedgerHeaderRow,
  HEADER_FILL,
} from "@/lib/ledger-excel";
import type {
  SettlementCategoryRow,
  SettlementData,
  SettlementDetail,
} from "@/lib/settlement";

const NOTE_FONT = { italic: true, color: { argb: "FF595959" } };

/** 결산 워크북(안내 + 입출금원장_전체 + 계정항목요약 + 고정 상세 시트) 생성. */
export function buildSettlementWorkbook(
  data: SettlementData,
  details: SettlementDetail[],
  periodLabel: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  addGuideSheet(wb, data.orgName, periodLabel);

  addLedgerSheet(wb, {
    sheetName: "입출금원장_전체",
    orgName: data.orgName,
    periodLabel,
    entries: data.entries,
    totalBalance: data.totalBalance,
  });

  addSummarySheet(wb, data, periodLabel);

  for (const detail of details) {
    addDetailSheet(wb, data.orgName, detail);
  }

  return wb;
}

/** 맨 앞 안내 시트 — 결산 자료를 처음 보는 사람을 위한 읽는 방법. */
function addGuideSheet(wb: ExcelJS.Workbook, orgName: string, periodLabel: string): void {
  const ws = wb.addWorksheet("안내");
  ws.columns = [{ width: 4 }, { width: 110 }];

  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = `${orgName} 결산 자료 안내 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 16 };

  const lines: Array<[string, boolean]> = [
    ["", false],
    ["■ 문서 구성", true],
    ["① 입출금원장_전체 — 통장 입출금 사실 그대로 (출금 1건 = 1행)", false],
    ["② 계정항목요약 — 계정항목별 수입·지출 합계와 검증", false],
    ["③ 항목별 상세 시트 — 여름수련회·겨울수련회·소그룹운영비 등 주요 지출 항목의 세부 내역", false],
    ["", false],
    ["■ 회계 처리 기준 (중요)", true],
    ["· 원장 시트는 통장 기준입니다. 여러 영수증을 묶어 한 번에 송금한 출금은 원장에 1행으로 표시되고,", false],
    ["  계정항목·영수증No는 대표 영수증 1건의 것만 보입니다.", false],
    ["· 계정항목요약·상세 시트는 영수증 기준입니다. 묶음 출금은 구성 영수증별로 분리되어", false],
    ["  각 영수증의 계정항목으로 집계됩니다. 따라서 상세 시트에는 한 출금이 여러 행으로 나뉘어 나올 수 있습니다.", false],
    ["", false],
    ["■ 추적 방법 — 거래번호", true],
    ["· 모든 행의 '거래번호'는 통장 거래 고유번호입니다. 형식: 월일-계좌-당일순번 (예: 0803-033-2 = 8/3 교회통장 2번째 거래)", false],
    ["· 상세 시트의 분리된 행에서 거래번호를 확인한 뒤 원장 시트에서 같은 거래번호를 찾으면", false],
    ["  그 출금의 전체 금액과 함께 지급된 다른 항목들을 확인할 수 있습니다.", false],
    ["· 같은 거래번호가 여러 행에 보이면 = 한 번의 송금을 영수증별로 나눠 표시한 것입니다.", false],
    ["", false],
    ["■ 영수증 번호", true],
    ["· '167-여름수련회' = 영수증 고유번호-계정항목. 지출영수증증빙 PDF의 No와 동일한 번호이므로", false],
    ["  원장·결산·PDF를 같은 번호로 교차 대조할 수 있습니다.", false],
    ["", false],
    ["■ 검증", true],
    ["· 계정항목요약 하단의 검증 블록에서 '요약 합계 − (비지출)'과 원장 합계의 차이가 0이면 정합합니다.", false],
    ["· (비지출) = 계좌 간 이체·오입금(환불) 등 실질 수입/지출이 아닌 거래", false],
    ["· (영수증 미매칭) = 영수증 없이 통장에서 나간 지출 (수수료 등)", false],
  ];
  lines.forEach(([text, bold], i) => {
    const cell = ws.getCell(`A${i + 2}`);
    ws.mergeCells(`A${i + 2}:B${i + 2}`);
    cell.value = text;
    cell.font = bold
      ? { bold: true, size: 11, color: { argb: "FF2F5496" } }
      : { size: 10 };
  });
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  data: SettlementData,
  periodLabel: string,
): void {
  const ws = wb.addWorksheet("계정항목요약");
  const t = data.summaryTotals;

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${data.orgName} 계정항목별 수입·지출 요약 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `총 수입 ${t.incomeTotal.toLocaleString("ko-KR")}원  |  총 지출 ${t.expenseTotal.toLocaleString("ko-KR")}원  |  순액 ${t.net.toLocaleString("ko-KR")}원   (자체 017 · 교회 033 구분)`;
  ws.getCell("A2").font = NOTE_FONT;

  const headers = [
    "계정항목", "건수", "수입 · 자체(017)", "수입 · 교회(033)", "수입 계",
    "지출 · 자체(017)", "지출 · 교회(033)", "지출 계", "순액", "지출 비중",
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.columns = [
    { width: 28 }, { width: 7 }, { width: 15 }, { width: 15 }, { width: 14 },
    { width: 15 }, { width: 15 }, { width: 14 }, { width: 14 }, { width: 10 },
  ];

  let r = 5;
  const writeRow = (row: SettlementCategoryRow, bold = false) => {
    const excelRow = ws.getRow(r);
    const values = [
      row.category, row.count, row.incomeSelf, row.incomeChurch, row.incomeTotal,
      row.expenseSelf, row.expenseChurch, row.expenseTotal, row.net, row.expenseShare,
    ];
    values.forEach((v, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = v;
      if (i >= 2 && i <= 8) cell.numFmt = "#,##0";
      if (i === 9) cell.numFmt = "0.0%";
      if (bold) cell.font = { bold: true };
    });
    excelRow.getCell(2).alignment = { horizontal: "center" };
    r += 1;
  };
  for (const row of data.summary) writeRow(row);
  writeRow(t, true);

  // 검증 블록
  const nonCash = data.summary.find((s) => s.category === "(비지출)");
  const checkIncome = t.incomeTotal - (nonCash?.incomeTotal ?? 0);
  const checkExpense = t.expenseTotal - (nonCash?.expenseTotal ?? 0);
  r += 1;
  ws.getRow(r).getCell(1).value = "검증";
  ws.getRow(r).getCell(1).font = { bold: true };
  r += 1;
  const check1 = ws.getRow(r);
  check1.getCell(1).value = "원장 합계행 (수입/지출)";
  check1.getCell(5).value = data.ledgerIncomeTotal;
  check1.getCell(8).value = data.ledgerExpenseTotal;
  r += 1;
  const check2 = ws.getRow(r);
  check2.getCell(1).value = "요약 합계 − (비지출) 차이";
  check2.getCell(5).value = checkIncome - data.ledgerIncomeTotal;
  check2.getCell(8).value = checkExpense - data.ledgerExpenseTotal;
  for (const row of [check1, check2]) {
    row.getCell(5).numFmt = "#,##0";
    row.getCell(8).numFmt = "#,##0";
  }
  r += 1;
  ws.getRow(r).getCell(1).value =
    "* (비지출) = 계좌 간 이체·오입금 환불 등 실질 수입/지출 아님 → 원장 헤더 합계에서 제외됨";
  ws.getRow(r).getCell(1).font = NOTE_FONT;
  r += 1;
  ws.getRow(r).getCell(1).value = "* 자체 통장 = 신한 017, 교회 통장 = 국민 033";
  ws.getRow(r).getCell(1).font = NOTE_FONT;
  r += 1;
  ws.getRow(r).getCell(1).value =
    "* 여러 영수증을 묶어 정산한 출금은 구성 영수증의 계정항목으로 분리 집계 (건수 = 분리 후 기준)";
  ws.getRow(r).getCell(1).font = NOTE_FONT;

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

function addDetailSheet(
  wb: ExcelJS.Workbook,
  orgName: string,
  detail: SettlementDetail,
): void {
  const ws = wb.addWorksheet(detail.sheetName);

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${orgName} 지출현황 - ${detail.sheetName}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `계정항목: ${detail.categories.join(" + ")}  |  건수 ${detail.count}건  |  지출 합계 ${detail.expenseTotal.toLocaleString("ko-KR")}원`;
  ws.getCell("A2").font = NOTE_FONT;

  drawLedgerHeaderRow(ws, 4, "누계");

  let r = 5;
  let cumulative = 0;
  for (const e of detail.entries) {
    cumulative += e.withdraw;
    drawLedgerEntryRow(ws, r, e, cumulative, false);
    r += 1;
  }

  // 빈 행 하나 뒤 합계 — 자동필터 범위에 합계가 끌려들어가지 않도록 원장 시트와 동일 배치
  const totalRow = ws.getRow(r + 1);
  totalRow.getCell(3).value = "합계";
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(5).value = detail.expenseTotal;
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(5).font = { bold: true };
  r += 3;

  // 계좌별 지출 구분
  ws.getRow(r).getCell(1).value = "계좌별 지출 구분";
  ws.getRow(r).getCell(1).font = { bold: true };
  r += 1;
  const miniHeaders = ["계좌", "건수", "지출 금액", "비중"];
  const miniHeaderRow = ws.getRow(r);
  miniHeaders.forEach((h, i) => {
    const cell = miniHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  r += 1;
  for (const acc of detail.byAccount) {
    const row = ws.getRow(r);
    row.getCell(1).value = acc.accountLabel;
    row.getCell(2).value = acc.count;
    row.getCell(3).value = acc.amount;
    row.getCell(4).value = acc.share;
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).numFmt = "#,##0";
    row.getCell(4).numFmt = "0.0%";
    r += 1;
  }
  const miniTotal = ws.getRow(r);
  miniTotal.getCell(1).value = "합계";
  miniTotal.getCell(2).value = detail.count;
  miniTotal.getCell(3).value = detail.expenseTotal;
  miniTotal.getCell(4).value = detail.expenseTotal > 0 ? 1 : 0;
  miniTotal.getCell(2).alignment = { horizontal: "center" };
  miniTotal.getCell(3).numFmt = "#,##0";
  miniTotal.getCell(4).numFmt = "0.0%";
  for (let c = 1; c <= 4; c += 1) miniTotal.getCell(c).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 12 } };
}
