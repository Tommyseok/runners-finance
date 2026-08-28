import ExcelJS from "exceljs";
import {
  addLedgerSheet,
  drawLedgerEntryRow,
  drawLedgerHeaderRow,
  HEADER_FILL,
} from "@/lib/ledger-excel";
import {
  buildIncomeDetail,
  type IncomeDetail,
  type SettlementCategoryRow,
  type SettlementData,
  type SettlementDetail,
} from "@/lib/settlement";
import {
  buildDimodeRecon,
  DIMODE_SNAPSHOT_DATE,
  DIMODE_TEAM,
} from "@/lib/dimode";

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

  addDimodeSheet(wb, data);

  addNoEvidenceSheet(wb, data.orgName, periodLabel, data.splitEntries);

  addIncomeSheet(wb, data.orgName, periodLabel, buildIncomeDetail(data.entries));

  for (const detail of details) {
    addDetailSheet(wb, data.orgName, detail);
  }

  return wb;
}

/** 증빙없음 시트 — 영수증 증빙이 없는 지출만 모아 붉은 탭으로 분리. */
function addNoEvidenceSheet(
  wb: ExcelJS.Workbook,
  orgName: string,
  periodLabel: string,
  splitEntries: SettlementData["splitEntries"],
): void {
  const rows = splitEntries.filter(
    (e) =>
      e.direction === "expense" &&
      e.kind === "expense" &&
      ((e.matchStatus === "matched" && e.hasImage === false) ||
        e.matchStatus === "unmatched"),
  );
  const total = rows.reduce((s, e) => s + e.withdraw, 0);

  const ws = wb.addWorksheet("증빙없음", {
    properties: { tabColor: { argb: "FFC00000" } },
  });

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${orgName} 증빙 없는 지출 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFC00000" } };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `건수 ${rows.length}건  |  합계 ${total.toLocaleString("ko-KR")}원   (노란색 = 영수증 기록 없음 · 연주황 = 기록·대사 완료, 사진만 없음)`;
  ws.getCell("A2").font = NOTE_FONT;

  drawLedgerHeaderRow(ws, 4, "누계");
  // 헤더를 붉은색으로 덮어쓰기
  for (let c = 1; c <= 12; c += 1) {
    ws.getRow(4).getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFC00000" },
    };
  }

  let r = 5;
  let cumulative = 0;
  for (const e of rows) {
    cumulative += e.withdraw;
    drawLedgerEntryRow(ws, r, e, cumulative);
    r += 1;
  }

  const totalRow = ws.getRow(r + 1);
  totalRow.getCell(3).value = "합계";
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(5).value = total;
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(5).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 12 } };
}

/**
 * 디모데대사 시트 — 교회 공식 재정시스템(디모데 웹복식재정)의 세목 기준으로
 * 예산 / 전도금 배정 / 앱 실지출(계좌별 병기) / 제출 전표를 나란히 대사한다.
 * 디모데 측 수치는 스냅샷(src/lib/dimode.ts)이며 시트에 기준일을 명시한다.
 */
function addDimodeSheet(wb: ExcelJS.Workbook, data: SettlementData): void {
  const { rows, unmapped } = buildDimodeRecon(data.summary);
  const ws = wb.addWorksheet("디모데대사", {
    properties: { tabColor: { argb: "FF2F5496" } },
  });

  ws.mergeCells("A1:L1");
  ws.getCell("A1").value =
    `디모데(교회 재정시스템) 세목 대사 — ${DIMODE_TEAM.path} (${DIMODE_TEAM.code}), 회계년도 ${DIMODE_TEAM.year}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:L2");
  ws.getCell("A2").value =
    `디모데 측 수치(예산·전도금 배정·제출 전표)는 ${DIMODE_SNAPSHOT_DATE} 조회 스냅샷 · 전도금 = 교회→고등부 이체(033 입금), 초과 지출분은 자체수입(수련회비 등) 부담`;
  ws.getCell("A2").font = NOTE_FONT;

  const headers = [
    "세목코드",
    "과목",
    "세목",
    "예산",
    "전도금 배정",
    "앱 실지출(계)",
    "· 교회통장(033)",
    "· 자체통장(017)",
    "디모데 제출액",
    "미소명 배정액",
    "자체부담분",
    "매핑된 앱 계정 / 비고",
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.columns = [
    { width: 11 },
    { width: 11 },
    { width: 18 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 12 },
    { width: 12 },
    { width: 46 },
  ];

  let r = 5;
  for (const row of rows) {
    const x = ws.getRow(r);
    const noteParts = [row.mappedCategories.join(", ") || "(매핑된 계정 없음)"];
    if (row.rejected > 0) {
      noteParts.push(`반려 ${row.rejected.toLocaleString("ko-KR")}원 재제출 필요`);
    }
    if (row.submittedPending > 0) {
      noteParts.push("제출분 결재중");
    }
    const vals: Array<string | number> = [
      row.code,
      row.subject,
      row.name,
      row.budget,
      row.fundAllocated,
      row.appExpense,
      row.appExpenseChurch,
      row.appExpenseSelf,
      row.submitted,
      row.allocRemaining,
      row.selfBurden,
      noteParts.join(" · "),
    ];
    vals.forEach((v, i) => {
      const cell = x.getCell(i + 1);
      cell.value = v;
      if (i >= 3 && i <= 10) cell.numFmt = "#,##0";
      if (i <= 2) cell.alignment = { horizontal: "center" };
    });
    if (row.rejected > 0) {
      x.getCell(12).font = { color: { argb: "FFC00000" }, bold: true };
    }
    if (row.allocRemaining !== 0) {
      x.getCell(10).font = { color: { argb: "FFC00000" }, bold: true };
    }
    r += 1;
  }

  const sum = (f: (row: (typeof rows)[number]) => number) =>
    rows.reduce((s, row) => s + f(row), 0);
  const totalRow = ws.getRow(r);
  totalRow.getCell(3).value = "합계";
  const totals = [
    sum((x) => x.budget),
    sum((x) => x.fundAllocated),
    sum((x) => x.appExpense),
    sum((x) => x.appExpenseChurch),
    sum((x) => x.appExpenseSelf),
    sum((x) => x.submitted),
    sum((x) => x.allocRemaining),
    sum((x) => x.selfBurden),
  ];
  totals.forEach((v, i) => {
    const cell = totalRow.getCell(i + 4);
    cell.value = v;
    cell.numFmt = "#,##0";
  });
  for (let c = 3; c <= 11; c += 1) totalRow.getCell(c).font = { bold: true };
  r += 2;

  if (unmapped.length > 0) {
    const warn = ws.getRow(r);
    warn.getCell(1).value =
      `⚠ 디모데 세목 미매핑 계정 ${unmapped.length}건 — src/lib/dimode.ts의 CATEGORY_TO_DIMODE에 추가 필요: ` +
      unmapped
        .map((u) => `${u.category} ${u.expenseTotal.toLocaleString("ko-KR")}원`)
        .join(" / ");
    warn.getCell(1).font = { color: { argb: "FFC00000" }, bold: true };
    ws.mergeCells(`A${r}:L${r}`);
    r += 2;
  }

  const notes = [
    "· 전도금 배정 = 결재완료된 전도금신청으로 교회에서 받은 금액 (세목별 한도). 미소명 배정액 = 배정 − 제출(반려 제외).",
    "· 앱 실지출은 이 결산의 계정항목요약과 동일 기준(영수증 분해 집계)이며, 교회통장/자체통장 열은 실제 출금 계좌 기준 병기입니다.",
    "· 자체부담분 = 실지출이 전도금 배정을 초과한 금액 — 수련회비·후원금 등 자체수입으로 충당된 부분입니다.",
    "· 디모데 팀지출 전표는 세목(예산항목) 단위로 결재되므로, 제출·재제출 시 이 시트의 세목 행 단위로 증빙을 준비합니다.",
    "· 알려진 차이: 8/19 제출 전표(12번)는 제자훈련 도서비 781,900원을 심방비 세목(도서인쇄비)으로 제출 — 이 시트의 원칙 매핑(제자훈련→506070209)과 달라 심방비 제출액이 실지출보다 크고 제자훈련 제출액이 0으로 보입니다.",
  ];
  for (const n of notes) {
    ws.mergeCells(`A${r}:L${r}`);
    ws.getCell(`A${r}`).value = n;
    ws.getCell(`A${r}`).font = NOTE_FONT;
    r += 1;
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

/** 수입 시트 — 분류별 요약(주일헌금/여름·겨울수련회 후원금 분리) + 입금 상세. */
function addIncomeSheet(
  wb: ExcelJS.Workbook,
  orgName: string,
  periodLabel: string,
  income: IncomeDetail,
): void {
  const ws = wb.addWorksheet("수입");

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${orgName} 수입 현황 (${periodLabel})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `실수입 합계 ${income.total.toLocaleString("ko-KR")}원  |  ${income.entries.length}건   (비지출·이체 제외)`;
  ws.getCell("A2").font = NOTE_FONT;

  // 분류별 요약
  const sumHeaders = ["분류", "건수", "금액"];
  const sumHeaderRow = ws.getRow(4);
  sumHeaders.forEach((h, i) => {
    const cell = sumHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  let r = 5;
  for (const g of income.groups) {
    const row = ws.getRow(r);
    row.getCell(1).value = g.label;
    row.getCell(2).value = g.count;
    row.getCell(3).value = g.amount;
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).numFmt = "#,##0";
    r += 1;
  }
  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "합계";
  totalRow.getCell(2).value = income.entries.length;
  totalRow.getCell(3).value = income.total;
  totalRow.getCell(2).alignment = { horizontal: "center" };
  totalRow.getCell(3).numFmt = "#,##0";
  for (let c = 1; c <= 3; c += 1) totalRow.getCell(c).font = { bold: true };
  r += 1;
  ws.getRow(r).getCell(1).value =
    "* 후원금 분류: '헌금' 중 적요에 '주일'이 없는 입금 — 4~9월 입금은 여름수련회, 10~3월 입금은 겨울수련회 후원금 (추정 기준)";
  ws.getRow(r).getCell(1).font = NOTE_FONT;
  r += 2;

  // 입금 상세 (원장 형식, 계정항목 열 = 분류)
  ws.getRow(r).getCell(1).value = "입금 상세";
  ws.getRow(r).getCell(1).font = { bold: true };
  r += 1;
  const headerRowNo = r;
  drawLedgerHeaderRow(ws, headerRowNo, "누계");
  r += 1;
  let cumulative = 0;
  for (const e of income.entries) {
    cumulative += e.deposit;
    drawLedgerEntryRow(ws, r, e, cumulative, false);
    r += 1;
  }
  const detailTotal = ws.getRow(r + 1);
  detailTotal.getCell(3).value = "합계";
  detailTotal.getCell(3).font = { bold: true };
  detailTotal.getCell(4).value = income.total;
  detailTotal.getCell(4).numFmt = "#,##0";
  detailTotal.getCell(4).font = { bold: true };

  ws.autoFilter = {
    from: { row: headerRowNo, column: 1 },
    to: { row: headerRowNo, column: 12 },
  };
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
    ["③ 디모데대사(파란 탭) — 교회 공식 재정시스템(디모데) 세목 기준 대사: 예산 vs 전도금 배정 vs 실지출(계좌별) vs 제출 전표", false],
    ["④ 증빙없음(붉은 탭) — 영수증 증빙이 없는 지출만 모은 시트", false],
    ["⑤ 수입 — 분류별 수입 요약(주일헌금 / 여름·겨울수련회 후원금 / 수련회비 등)과 입금 상세", false],
    ["⑥ 계정항목별 상세 시트 — 지출이 있는 모든 계정항목마다 자동 생성 (새 계정이 추가되면 시트·증빙 PDF도 자동 추가)", false],
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
    ["■ 증빙번호", true],
    ["· '소그룹-3' = 계정항목별 순번 (지출일 오름차순으로 1부터). 지출영수증증빙 PDF의 No와 동일한 번호이므로", false],
    ["  원장·결산·PDF를 같은 번호로 교차 대조할 수 있습니다. 계정별 PDF 안에서 번호가 1부터 순서대로 이어집니다.", false],
    ["", false],
    ["■ 검증", true],
    ["· 계정항목요약 하단의 검증 블록에서 '요약 합계 − (비지출)'과 원장 합계의 차이가 0이면 정합합니다.", false],
    ["· (비지출) = 계좌 간 이체·오입금(환불) 등 실질 수입/지출이 아닌 거래", false],
    ["· 대사상태 '증빙없음' = 영수증 증빙이 없는 지출. 노란색 행 = 영수증 기록 자체가 없음(미매칭),", false],
    ["  연주황 행 = 영수증 기록·통장 대사는 완료됐으나 사진이 등록되지 않음 (증빙 PDF에 '영수증 없음'으로 표시)", false],
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
  r += 1;

  // 수입·지출 밸런스 (incomeLines가 설정된 시트만)
  if (detail.incomeLines && detail.incomeTotal !== undefined) {
    r += 1;
    ws.getRow(r).getCell(1).value = "수입·지출 밸런스";
    ws.getRow(r).getCell(1).font = { bold: true };
    r += 1;
    const balanceRows: Array<[string, number, boolean]> = [
      ...detail.incomeLines.map(
        (l): [string, number, boolean] => [l.label, l.amount, false],
      ),
      ["수입 합계", detail.incomeTotal, true],
      ["지출 합계", detail.expenseTotal, false],
      ["수지 (수입 − 지출)", detail.incomeTotal - detail.expenseTotal, true],
    ];
    for (const [label, value, bold] of balanceRows) {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      row.getCell(3).value = value;
      row.getCell(3).numFmt = "#,##0";
      if (bold) {
        row.getCell(1).font = { bold: true };
        row.getCell(3).font = { bold: true };
        row.getCell(3).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDEEAF6" },
        };
      }
      r += 1;
    }
    ws.getRow(r).getCell(1).value =
      "* 여름 = 4~9월 입금, 겨울 = 10~3월 입금 기준 분류 (추정 기준). 후원금 = '헌금' 중 적요에 '주일'이 없는 입금.";
    ws.getRow(r).getCell(1).font = NOTE_FONT;
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 12 } };
}
