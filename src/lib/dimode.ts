import type { SettlementCategoryRow } from "@/lib/settlement";

/**
 * 디모데 웹복식재정(교회 공식 시스템) 연동 데이터.
 *
 * 예산·전도금 배정·제출 전표는 디모데 화면(팀별지출결산, 팀지출 목록, 전표 작성폼)에서
 * 읽어온 스냅샷이다. 디모데에는 API가 없어 자동 동기화가 불가하므로,
 * 값이 바뀌면 SNAPSHOT_DATE와 함께 아래 상수를 갱신한다 (browser-harness로 조회).
 */
export const DIMODE_TEAM = {
  code: "106070100",
  path: "교육국 > 고등부 > 고등부",
  year: 2026,
} as const;

export const DIMODE_SNAPSHOT_DATE = "2026-08-28";

export interface DimodeItem {
  /** 예산항목(세목) 코드, 예: 506070215 */
  code: string;
  /** 과목 (교육훈련비/교육운영비/교육지원비/교육행사비) */
  subject: string;
  /** 세목명 */
  name: string;
  /** 최종예산 (2026) */
  budget: number;
  /** 결재완료된 전도금신청으로 배정받은 금액 (전표 작성폼 '전도금' 필드) */
  fundAllocated: number;
}

export const DIMODE_ITEMS: readonly DimodeItem[] = [
  { code: "506070103", subject: "교육훈련비", name: "고등부 여름수련회", budget: 4_100_000, fundAllocated: 4_100_000 },
  { code: "506070106", subject: "교육훈련비", name: "고등부 겨울수련회", budget: 3_800_000, fundAllocated: 3_800_000 },
  { code: "506070112", subject: "교육훈련비", name: "성경공부 교재(정규)", budget: 1_000_000, fundAllocated: 1_000_000 },
  { code: "506070203", subject: "교육운영비", name: "소그룹운영비", budget: 2_500_000, fundAllocated: 2_500_000 },
  { code: "506070206", subject: "교육운영비", name: "전도축제", budget: 800_000, fundAllocated: 0 },
  { code: "506070209", subject: "교육운영비", name: "제자훈련", budget: 900_000, fundAllocated: 900_000 },
  { code: "506070212", subject: "교육운영비", name: "찬양팀지원비", budget: 600_000, fundAllocated: 600_000 },
  { code: "506070215", subject: "교육운영비", name: "심방비", budget: 3_000_000, fundAllocated: 3_000_000 },
  { code: "506070306", subject: "교육지원비", name: "교사 지원(MT 등)", budget: 1_100_000, fundAllocated: 1_100_000 },
  { code: "506070412", subject: "교육행사비", name: "전체 행사비", budget: 3_000_000, fundAllocated: 3_000_000 },
] as const;

/**
 * 앱 계정항목 → 디모데 세목 코드 (세목별 원칙 매핑, 2026-08-28 사용자 확정).
 * - 경조사는 디모데에 별도 세목이 없어 심방비(506070215)로 — 기제출 전표(8/19)와 동일한 관례.
 * - 소모품도 별도 세목이 없어 전체 행사비(506070412)로 — 간담회 다과·선물 등 행사성 지출.
 * - 여기 없는 새 계정은 디모데대사 시트의 '미매핑' 행으로 표시된다 (누락 방지).
 */
export const CATEGORY_TO_DIMODE: Readonly<Record<string, string>> = {
  "[훈련비] 여름수련회": "506070103",
  "[훈련비] 겨울수련회": "506070106",
  "[훈련비] 성경공부교재": "506070112",
  "[운영비] 소그룹": "506070203",
  "[운영비] 전도축제": "506070206",
  "[운영비] 제자훈련": "506070209",
  "[운영비] 찬양팀": "506070212",
  "[운영비] 심방비": "506070215",
  "[지원비] 경조사": "506070215",
  "[지원비] 교사지원": "506070306",
  "[행사비] 고등부행사 (체육대회 등)": "506070412",
  "[행사비] 학년모임": "506070412",
  "[기타잡비] 소모품": "506070412",
};

export type DimodeSlipStatus = "결재중" | "결재완료" | "반려";

export interface DimodeSlip {
  /** 신청일 YYYYMMDD (문서번호) */
  date: string;
  seq: number;
  itemCode: string;
  amount: number;
  status: DimodeSlipStatus;
  note: string;
}

/** 디모데에 제출된 팀지출 전표 (스냅샷). 반려 건은 배정 차감에 포함하지 않는다. */
export const DIMODE_SLIPS: readonly DimodeSlip[] = [
  { date: "20260410", seq: 1, itemCode: "506070106", amount: 3_800_000, status: "반려", note: "겨울수련회 — 증빙 첨부 누락으로 반려, 재제출 필요" },
  { date: "20260819", seq: 6, itemCode: "506070103", amount: 4_100_000, status: "결재중", note: "여름수련회" },
  { date: "20260819", seq: 7, itemCode: "506070306", amount: 300_000, status: "결재중", note: "교사지원" },
  { date: "20260819", seq: 8, itemCode: "506070203", amount: 1_877_240, status: "결재중", note: "소그룹운영비" },
  { date: "20260819", seq: 9, itemCode: "506070212", amount: 600_000, status: "결재중", note: "찬양팀지원비" },
  { date: "20260819", seq: 10, itemCode: "506070412", amount: 2_681_355, status: "결재중", note: "학년모임·체육대회·간담회·선물 등" },
  { date: "20260819", seq: 11, itemCode: "506070306", amount: 300_000, status: "결재중", note: "교사회의·교사엠티" },
  { date: "20260819", seq: 12, itemCode: "506070215", amount: 412_500, status: "결재중", note: "심방비·경조사 (선교비)" },
  { date: "20260819", seq: 12, itemCode: "506070215", amount: 781_900, status: "결재중", note: "제자훈련 도서 (도서인쇄비)" },
] as const;

export interface DimodeReconRow {
  code: string;
  subject: string;
  name: string;
  budget: number;
  fundAllocated: number;
  /** 매핑된 앱 계정들의 실지출 합 */
  appExpense: number;
  appExpenseChurch: number;
  appExpenseSelf: number;
  /** 제출 전표 합 (반려 제외) */
  submitted: number;
  submittedPending: number;
  rejected: number;
  /** 배정액 - 제출액(반려 제외): 아직 전표로 소명하지 않은 전도금 */
  allocRemaining: number;
  /** 실지출 - 전도금 배정: 양수면 자체수입 부담분 */
  selfBurden: number;
  mappedCategories: string[];
}

/**
 * 디모데 세목 기준 대사 행 생성 — 앱 결산 요약(summary)을 세목으로 묶어
 * 예산 vs 전도금 배정 vs 앱 실지출 vs 제출 전표를 나란히 놓는다.
 * 매핑에 없는 계정은 별도로 반환해 시트에서 '미매핑'으로 경고한다.
 */
export function buildDimodeRecon(summary: SettlementCategoryRow[]): {
  rows: DimodeReconRow[];
  unmapped: SettlementCategoryRow[];
} {
  // "(비지출)"은 이체·환불(wash)이라 대사 대상이 아니지만, "(영수증 미매칭)" 등
  // 실지출이 담긴 구조 행은 매핑 불가 지출이므로 미매핑 경고로 노출한다 (조용한 누락 방지).
  const expenseRows = summary.filter(
    (r) => r.expenseTotal > 0 && !r.category.startsWith("("),
  );
  const structuralExpense = summary.filter(
    (r) =>
      r.expenseTotal > 0 &&
      r.category.startsWith("(") &&
      r.category !== "(비지출)",
  );
  const unmapped = [
    ...expenseRows.filter((r) => !CATEGORY_TO_DIMODE[r.category]),
    ...structuralExpense,
  ];

  const rows = DIMODE_ITEMS.map((item) => {
    const cats = expenseRows.filter(
      (r) => CATEGORY_TO_DIMODE[r.category] === item.code,
    );
    const appExpense = cats.reduce((s, r) => s + r.expenseTotal, 0);
    const appExpenseChurch = cats.reduce((s, r) => s + r.expenseChurch, 0);
    const appExpenseSelf = cats.reduce((s, r) => s + r.expenseSelf, 0);
    const slips = DIMODE_SLIPS.filter((s) => s.itemCode === item.code);
    const submitted = slips
      .filter((s) => s.status !== "반려")
      .reduce((s, x) => s + x.amount, 0);
    const submittedPending = slips
      .filter((s) => s.status === "결재중")
      .reduce((s, x) => s + x.amount, 0);
    const rejected = slips
      .filter((s) => s.status === "반려")
      .reduce((s, x) => s + x.amount, 0);
    return {
      code: item.code,
      subject: item.subject,
      name: item.name,
      budget: item.budget,
      fundAllocated: item.fundAllocated,
      appExpense,
      appExpenseChurch,
      appExpenseSelf,
      submitted,
      submittedPending,
      rejected,
      allocRemaining: item.fundAllocated - submitted,
      selfBurden: Math.max(0, appExpense - item.fundAllocated),
      mappedCategories: cats.map((r) => r.category),
    };
  });

  return { rows, unmapped };
}
