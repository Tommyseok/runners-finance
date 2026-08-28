import ExcelJS from "exceljs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Receipt, ReceiptImage } from "@/lib/db-types";
import { getEnrichedLedger } from "@/lib/ledger";
import { classifyAccount } from "@/lib/settlement";
import { loadPdfFonts } from "@/lib/pdf-fonts";
import {
  CATEGORY_TO_DIMODE,
  DIMODE_ITEMS,
  DIMODE_SNAPSHOT_DATE,
  DIMODE_TEAM,
  type DimodeItem,
} from "@/lib/dimode";

/**
 * 디모데(교회 공식 재정시스템) 제출 패키지 — 세목(예산항목)별 폴더에
 * 정산 명세 엑셀 + 증빙 PDF(1MB 이하로 자동 분할)를 담아 ZIP으로 묶는다.
 *
 * 재원 분리 원칙 (2026-08-28 사용자 확정):
 * - 전도금 전표는 세목별 교회 배정액(전도금)만큼 '정확히' 구성한다.
 * - 배정 초과 지출은 자체수입 재원으로 별도 전표를 구성한다 (디모데에 자체수입 등록 후 지출).
 * - 경계에 걸리는 영수증은 금액을 나눠 양쪽에 산입하고 '(일부)'로 표기한다.
 * - 모든 행은 거래번호(MMDD-계좌-순번)·출금계좌로 실제 통장 출금과 대사된다.
 *   전도금 재원 채움은 교회통장(033) 출금 영수증부터 산입해 실제 자금 흐름과 맞춘다.
 *
 * 디모데 팀지출 전표의 첨부 제약(슬롯 20개, pdf/xlsx는 1MB 제한)에 맞춰:
 * - 재원 버킷마다 명세 엑셀 1개 + 증빙 PDF 최대 19개 = 슬롯 20개 이내
 * - 각 PDF는 1MB를 넘지 않도록 영수증(페이지) 단위로 잘라 담는다
 */

const MAX_PROOF_FILES = 19;
/** 디모데 비이미지 첨부 한도 1MB(1,048,576B) — 안전 마진을 둔 목표 상한 */
const PDF_SIZE_LIMIT = 1_000_000;
/** PDF 1개에 담을 압축 이미지 바이트 예산 (폰트 서브셋·구조 오버헤드 여유분 제외) */
const PDF_IMG_BUDGET = 720_000;
/** 증빙 이미지 다운로드 동시성 (람다 maxDuration 안에서 끝나도록) */
const DOWNLOAD_CONCURRENCY = 4;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** zip 파일명에 쓸 수 없는 문자 제거 (증빙번호가 계정명에서 오므로 방어) */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#]/g, "-").replace(/\s+/g, " ").trim();
}

/** 영수증 ↔ 실제 통장 출금 연결 정보 (bank_txn_link 기반) */
export interface ReceiptBankInfo {
  /** 거래번호(들) "MMDD-계좌-순번" — 원장 시트에서 원거래 역추적 */
  txnRefs: string;
  accountLabel: string;
  group: "church" | "self" | "other";
}

/**
 * 영수증 id → 통장 출금 정보 맵. bank_txn_link(분해 매칭)로 각 영수증이
 * 어느 계좌의 어느 거래에서 지급됐는지 구한다.
 */
export async function buildBankInfoByReceiptId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, ReceiptBankInfo>> {
  const entriesPromise = getEnrichedLedger(supabase, orgId, "all");

  // PostgREST max-rows(1000) 잘림 방지 — settlement.ts와 동일하게 페이지 순회
  const links: Array<{ bank_transaction_id: string; receipt_id: string }> = [];
  const PAGE = 1000;
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    const { data, error } = await supabase
      .from("bank_txn_link")
      .select("bank_transaction_id, receipt_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIdx, fromIdx + PAGE - 1);
    if (error) {
      // 링크 없이는 재원 채움 순서·통장 대사가 모두 틀어진다 — 조용히 잘못된 제출물을 만들지 않는다.
      throw new Error(`bank_txn_link 조회 실패: ${error.message}`);
    }
    links.push(...((data ?? []) as Array<{ bank_transaction_id: string; receipt_id: string }>));
    if (!data || data.length < PAGE) break;
  }

  const entries = await entriesPromise;
  const txnById = new Map(entries.map((e) => [e.id, e]));

  // 영수증별로 연결 거래를 모두 모은 뒤 확정 — 다계좌 영수증은 교회통장 우선으로 분류하고 라벨에 전부 표기
  const txnsByReceipt = new Map<string, Array<{ txnRef: string; accountLabel: string }>>();
  for (const link of links) {
    const txn = txnById.get(link.bank_transaction_id);
    if (!txn) continue;
    const arr = txnsByReceipt.get(link.receipt_id) ?? [];
    if (!arr.some((t) => t.txnRef === txn.txnRef)) {
      arr.push({ txnRef: txn.txnRef, accountLabel: txn.accountLabel });
    }
    txnsByReceipt.set(link.receipt_id, arr);
  }

  const map = new Map<string, ReceiptBankInfo>();
  for (const [receiptId, txns] of txnsByReceipt) {
    const sorted = [...txns].sort((a, b) => (a.txnRef < b.txnRef ? -1 : 1));
    const groups = new Set(sorted.map((t) => classifyAccount(t.accountLabel)));
    const labels = Array.from(new Set(sorted.map((t) => t.accountLabel)));
    map.set(receiptId, {
      txnRefs: sorted.map((t) => t.txnRef).join(", "),
      accountLabel: labels.join(" + "),
      group: groups.has("church") ? "church" : groups.has("self") ? "self" : "other",
    });
  }
  return map;
}

export interface DimodePackageInput {
  receipts: Receipt[];
  catMap: Map<string, string>;
  userMap: Map<string, string>;
  imagesByReceipt: Map<string, ReceiptImage[]>;
  downloadImage: (storagePath: string) => Promise<Buffer>;
  refByReceiptId: Map<string, string>;
  bankInfoByReceiptId: Map<string, ReceiptBankInfo>;
  orgName: string;
  periodLabel: string;
}

interface PackReceipt {
  receipt: Receipt;
  ref: string;
  category: string;
  bank: ReceiptBankInfo | null;
}

interface ItemGroup {
  item: DimodeItem;
  members: PackReceipt[];
  total: number;
}

/** 재원 버킷의 한 행 — partial이면 영수증 금액 중 일부만 이 재원에 산입 */
interface BucketEntry {
  member: PackReceipt;
  amount: number;
  partial: boolean;
}

type FundKind = "jeondogeum" | "jache";

interface Bucket {
  kind: FundKind;
  label: string;
  entries: BucketEntry[];
  total: number;
}

/** "소그룹-12" → ["소그룹", 12] — 세목 안에서 앱 계정별 증빙번호 순 정렬용 */
function splitRef(ref: string): [string, number] {
  const i = ref.lastIndexOf("-");
  if (i < 0) return [ref, 0];
  const n = Number(ref.slice(i + 1));
  return [ref.slice(0, i), Number.isFinite(n) ? n : 0];
}

function byRefOrder(a: { member: PackReceipt }, b: { member: PackReceipt }): number {
  const [ga, na] = splitRef(a.member.ref);
  const [gb, nb] = splitRef(b.member.ref);
  if (ga !== gb) return ga < gb ? -1 : 1;
  return na - nb;
}

/**
 * 세목의 영수증을 전도금/자체수입 재원 버킷으로 나눈다.
 * - 전도금 버킷 합계 = min(전도금 배정액, 실지출) — 배정액을 정확히 채운다.
 * - 채움 순서는 교회통장(033) 출금분 → 자체통장(017) 출금분 (실제 자금 흐름과 정렬).
 * - 경계 영수증은 금액을 나눠 양쪽에 산입 (partial).
 */
export function buildFundBuckets(item: DimodeItem, members: PackReceipt[]): Bucket[] {
  const groupRank = (m: PackReceipt): number =>
    m.bank?.group === "church" ? 0 : m.bank?.group === "self" ? 1 : 2;
  const fillOrder = [...members].sort((a, b) => {
    const ra = groupRank(a);
    const rb = groupRank(b);
    if (ra !== rb) return ra - rb;
    return byRefOrder({ member: a }, { member: b });
  });

  const jeondogeum: BucketEntry[] = [];
  const jache: BucketEntry[] = [];
  let remaining = item.fundAllocated;
  for (const m of fillOrder) {
    const amt = m.receipt.total_amount ?? 0;
    if (amt <= 0) {
      // 0원·환불(음수) 영수증도 명세에서 빠지면 안 된다 — 자체수입 쪽에 그대로 기재
      jache.push({ member: m, amount: amt, partial: false });
      continue;
    }
    if (remaining <= 0) {
      jache.push({ member: m, amount: amt, partial: false });
    } else if (amt <= remaining) {
      jeondogeum.push({ member: m, amount: amt, partial: false });
      remaining -= amt;
    } else {
      jeondogeum.push({ member: m, amount: remaining, partial: true });
      jache.push({ member: m, amount: amt - remaining, partial: true });
      remaining = 0;
    }
  }
  jeondogeum.sort(byRefOrder);
  jache.sort(byRefOrder);

  const buckets: Bucket[] = [];
  if (jeondogeum.length > 0) {
    buckets.push({
      kind: "jeondogeum",
      label: "전도금",
      entries: jeondogeum,
      total: jeondogeum.reduce((s, e) => s + e.amount, 0),
    });
  }
  if (jache.length > 0) {
    buckets.push({
      kind: "jache",
      label: "자체수입",
      entries: jache,
      total: jache.reduce((s, e) => s + e.amount, 0),
    });
  }
  return buckets;
}

interface ProofImage {
  buf: Buffer;
  w: number;
  h: number;
}

/**
 * PDF 삽입용 압축 — 1MB 예산 안에 여러 장을 담아야 하므로 공격적으로 줄인다.
 * 크기가 큰 이미지는 품질·해상도를 단계적으로 낮춰 장당 ~180KB 이하를 노린다.
 */
async function compressForPdf(buf: Buffer): Promise<ProofImage> {
  const attempts: Array<{ width: number; quality: number }> = [
    { width: 1000, quality: 72 },
    { width: 900, quality: 62 },
    { width: 780, quality: 52 },
  ];
  let out: Buffer | null = null;
  for (const a of attempts) {
    out = await sharp(buf)
      .rotate()
      .resize(a.width, 2600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: a.quality })
      .toBuffer();
    if (out.length <= 180_000) break;
  }
  const meta = await sharp(out!).metadata();
  return { buf: out!, w: meta.width ?? 1, h: meta.height ?? 1 };
}

interface ProofPage {
  header: string;
  image: ProofImage;
}

/** 증빙 PDF — 페이지마다 헤더(증빙번호·지출일·금액·거래처) + 영수증 이미지 1장 */
async function renderProofPdf(title: string, pages: ProofPage[]): Promise<Buffer> {
  const fonts = await loadPdfFonts();
  const MARGIN = 36;
  const PAGE_W = 595; // A4 portrait
  const PAGE_H = 842;
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: false });
  doc.registerFont("KR", fonts.regular);
  doc.registerFont("KR-Bold", fonts.bold);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (e: Error) => reject(e));
  });

  for (const page of pages) {
    doc.addPage();
    doc.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, 26).fill("#2F5496");
    doc
      .font("KR-Bold")
      .fontSize(10)
      .fillColor("#FFFFFF")
      .text(
        page.header.length > 72 ? `${page.header.slice(0, 71)}…` : page.header,
        MARGIN + 8,
        MARGIN + 7,
        { width: PAGE_W - MARGIN * 2 - 16, lineBreak: false },
      );
    // 출처 표기는 헤더 바 바로 아래 우측 — 하단 마진 밖에 그리면 자동 페이지 추가됨
    doc.font("KR").fontSize(7).fillColor("#999999").text(title, MARGIN, MARGIN + 28, {
      width: PAGE_W - MARGIN * 2,
      align: "right",
      lineBreak: false,
    });
    const areaY = MARGIN + 42;
    const areaW = PAGE_W - MARGIN * 2;
    const areaH = PAGE_H - MARGIN - areaY;
    const scale = Math.min(areaW / page.image.w, areaH / page.image.h);
    const drawW = page.image.w * scale;
    doc.image(page.image.buf, MARGIN + (areaW - drawW) / 2, areaY, { width: drawW });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/**
 * 버킷 증빙 PDF들을 zip 폴더에 생성한다 (1MB·슬롯 제한 준수).
 * 반환: 영수증별 첨부파일명 맵 + 생성 파일 수.
 */
async function emitBucketProofs(
  zip: JSZip,
  folderPath: string,
  bucket: Bucket,
  pagesByMember: Map<PackReceipt, ProofPage[]>,
  title: string,
): Promise<{ attached: Map<PackReceipt, string>; fileCount: number }> {
  const attached = new Map<PackReceipt, string>();
  let fileCount = 0;

  interface PdfPlan {
    pages: ProofPage[];
    members: PackReceipt[];
    firstRef: string;
    lastRef: string;
    bytes: number;
  }
  const plans: PdfPlan[] = [];
  let cur: PdfPlan | null = null;
  const flushPlan = () => {
    if (cur && cur.pages.length > 0) plans.push(cur);
    cur = null;
  };
  for (const e of bucket.entries) {
    const m = e.member;
    const pages = pagesByMember.get(m) ?? [];
    if (pages.length === 0) continue; // 이미지 없음/실패 → 명세에 '증빙없음'으로 남음
    const memberBytes = pages.reduce((s, p) => s + p.image.buf.length, 0);
    if (memberBytes > PDF_IMG_BUDGET) {
      // 대형 영수증: 페이지 단위 분할로 전용 PDF들 생성
      flushPlan();
      let seg: ProofPage[] = [];
      let segBytes = 0;
      for (const p of pages) {
        if (seg.length > 0 && segBytes + p.image.buf.length > PDF_IMG_BUDGET) {
          plans.push({ pages: seg, members: [m], firstRef: m.ref, lastRef: m.ref, bytes: segBytes });
          seg = [];
          segBytes = 0;
        }
        seg.push(p);
        segBytes += p.image.buf.length;
      }
      if (seg.length > 0) {
        plans.push({ pages: seg, members: [m], firstRef: m.ref, lastRef: m.ref, bytes: segBytes });
      }
      continue;
    }
    if (cur && cur.bytes + memberBytes > PDF_IMG_BUDGET) flushPlan();
    if (!cur) cur = { pages: [], members: [], firstRef: m.ref, lastRef: m.ref, bytes: 0 };
    cur.pages.push(...pages);
    cur.members.push(m);
    cur.lastRef = m.ref;
    cur.bytes += memberBytes;
  }
  flushPlan();

  // 렌더 — 1MB를 넘으면 반으로 갈라 재시도 (폰트·구조 오버헤드 방어)
  const renderQueue: PdfPlan[] = [...plans];
  let partSeq = 0;
  const usedNames = new Set<string>();
  while (renderQueue.length > 0) {
    const plan = renderQueue.shift()!;
    const buf = await renderProofPdf(title, plan.pages);
    if (buf.length > PDF_SIZE_LIMIT && plan.pages.length > 1) {
      const mid = Math.ceil(plan.pages.length / 2);
      const memberSet = (pgs: ProofPage[]) =>
        plan.members.filter((m) => (pagesByMember.get(m) ?? []).some((p) => pgs.includes(p)));
      const half = (pgs: ProofPage[]): PdfPlan => {
        const members = memberSet(pgs);
        return {
          pages: pgs,
          members,
          firstRef: members[0]?.ref ?? plan.firstRef,
          lastRef: members[members.length - 1]?.ref ?? plan.lastRef,
          bytes: 0,
        };
      };
      renderQueue.unshift(half(plan.pages.slice(0, mid)), half(plan.pages.slice(mid)));
      continue;
    }
    if (buf.length > PDF_SIZE_LIMIT) {
      console.warn(
        `dimode-package: ${plan.firstRef} 단일 페이지 PDF가 1MB 초과(${buf.length}B) — 그대로 포함, 필요시 수동 처리`,
      );
    }
    partSeq += 1;
    let name =
      plan.firstRef === plan.lastRef
        ? safeName(plan.firstRef)
        : safeName(`${plan.firstRef}~${plan.lastRef}`);
    if (usedNames.has(name)) name = `${name}_${partSeq}`;
    usedNames.add(name);
    const fileName = `${name}.pdf`;
    zip.file(`${folderPath}/${fileName}`, buf);
    for (const m of plan.members) {
      const prev = attached.get(m);
      attached.set(m, prev ? (prev.includes(fileName) ? prev : `${prev} / ${fileName}`) : fileName);
    }
    fileCount += 1;
  }

  if (fileCount > MAX_PROOF_FILES) {
    console.warn(
      `dimode-package: ${folderPath} 증빙 PDF ${fileCount}개 — 첨부 슬롯(${MAX_PROOF_FILES}) 초과, 전표를 나눠 제출 필요`,
    );
  }
  return { attached, fileCount };
}

function buildBucketWorkbook(
  group: ItemGroup,
  bucket: Bucket,
  attached: Map<PackReceipt, string>,
  input: DimodePackageInput,
): ExcelJS.Workbook {
  const { item, total } = group;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("명세");
  ws.columns = [
    { width: 14 },
    { width: 19 },
    { width: 11 },
    { width: 24 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 9 },
    { width: 30 },
  ];

  const fundNote =
    bucket.kind === "jeondogeum"
      ? `재원: 전도금 — 배정 ${item.fundAllocated.toLocaleString("ko-KR")}원 중 ${bucket.total.toLocaleString("ko-KR")}원 산입 (전표 금액)`
      : `재원: 자체수입 — 전도금 배정 초과분 ${bucket.total.toLocaleString("ko-KR")}원 (디모데에 자체수입 등록 후 이 금액으로 팀지출 처리)`;

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value =
    `디모데 팀지출 증빙 명세 [${bucket.label}] — ${item.subject} > ${item.name} (${item.code})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `${DIMODE_TEAM.path} (${DIMODE_TEAM.code}) · ${input.orgName} · ${input.periodLabel}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };
  ws.mergeCells("A3:J3");
  ws.getCell("A3").value =
    `${fundNote} · 세목 실지출 ${total.toLocaleString("ko-KR")}원 · 디모데 수치 기준일 ${DIMODE_SNAPSHOT_DATE}`;
  ws.getCell("A3").font = { italic: true, color: { argb: "FF595959" } };
  ws.mergeCells("A4:J4");
  ws.getCell("A4").value =
    "거래번호(월일-계좌-당일순번)·출금계좌 열로 실제 통장 출금 내역과 대사됩니다. '(일부)' 행은 영수증 금액을 전도금/자체수입 재원으로 나눠 산입한 것입니다.";
  ws.getCell("A4").font = { italic: true, color: { argb: "FF595959" }, size: 9 };

  const headers = [
    "증빙번호",
    "앱 계정항목",
    "지출일",
    "거래처",
    "영수증 금액",
    "산입금액",
    "거래번호",
    "출금계좌",
    "지출인",
    "첨부파일",
  ];
  const headerRow = ws.getRow(6);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  let r = 7;
  for (const e of bucket.entries) {
    const m = e.member;
    const row = ws.getRow(r);
    const vals: Array<string | number> = [
      e.partial ? `${m.ref} (일부)` : m.ref,
      m.category,
      m.receipt.expense_date ?? "",
      m.receipt.merchant ?? "",
      m.receipt.total_amount,
      e.amount,
      m.bank?.txnRefs ?? "-",
      m.bank?.accountLabel ?? "-",
      input.userMap.get(m.receipt.user_id) ?? "",
      attached.get(m) ?? "증빙없음",
    ];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (i === 4 || i === 5) cell.numFmt = "#,##0";
      if (i === 0 || i === 2 || i === 6) cell.alignment = { horizontal: "center" };
    });
    if (e.partial) {
      row.getCell(1).font = { color: { argb: "FF2F5496" }, bold: true };
      row.getCell(6).font = { color: { argb: "FF2F5496" }, bold: true };
    }
    if (!attached.get(m)) {
      row.getCell(10).font = { color: { argb: "FFC00000" }, bold: true };
    }
    r += 1;
  }
  const totalRow = ws.getRow(r);
  totalRow.getCell(4).value = "합계";
  totalRow.getCell(5).value = bucket.entries.reduce((s, e) => s + (e.member.receipt.total_amount ?? 0), 0);
  totalRow.getCell(6).value = bucket.total;
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(6).numFmt = "#,##0";
  for (const c of [4, 5, 6]) totalRow.getCell(c).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 6 }];
  return wb;
}

interface ItemResult {
  group: ItemGroup;
  jeondogeumTotal: number;
  jacheTotal: number;
  proofFiles: number;
}

function buildRootSummaryWorkbook(
  results: ItemResult[],
  unmappedCategories: Map<string, number>,
  input: DimodePackageInput,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("제출요약");
  ws.columns = [
    { width: 12 },
    { width: 12 },
    { width: 20 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 8 },
    { width: 11 },
  ];
  ws.mergeCells("A1:J1");
  ws.getCell("A1").value =
    `디모데 제출 패키지 요약 — ${DIMODE_TEAM.path} (${DIMODE_TEAM.code}), ${input.periodLabel}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:J2");
  ws.getCell("A2").value =
    `세목별 폴더: 전도금 전표는 배정액만큼 정확히 산입, 초과분은 자체수입 전표로 분리. 각 버킷 = 명세 엑셀 1 + 증빙 PDF(각 1MB 이하). 디모데 수치 기준일 ${DIMODE_SNAPSHOT_DATE}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  const headers = [
    "세목코드",
    "과목",
    "세목",
    "예산",
    "전도금 배정",
    "실지출",
    "전도금 산입",
    "자체수입 산입",
    "건수",
    "증빙파일 수",
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  let r = 5;
  for (const res of results) {
    const { group: g } = res;
    const row = ws.getRow(r);
    const vals: Array<string | number> = [
      g.item.code,
      g.item.subject,
      g.item.name,
      g.item.budget,
      g.item.fundAllocated,
      g.total,
      res.jeondogeumTotal,
      res.jacheTotal,
      g.members.length,
      res.proofFiles,
    ];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (i >= 3 && i <= 7) cell.numFmt = "#,##0";
      if (i <= 2 || i >= 8) cell.alignment = { horizontal: "center" };
    });
    if (res.jacheTotal > 0) {
      row.getCell(8).font = { color: { argb: "FF2F5496" }, bold: true };
    }
    r += 1;
  }
  const totalRow = ws.getRow(r);
  totalRow.getCell(3).value = "합계";
  const sums = [
    results.reduce((s, x) => s + x.group.item.budget, 0),
    results.reduce((s, x) => s + x.group.item.fundAllocated, 0),
    results.reduce((s, x) => s + x.group.total, 0),
    results.reduce((s, x) => s + x.jeondogeumTotal, 0),
    results.reduce((s, x) => s + x.jacheTotal, 0),
  ];
  sums.forEach((v, i) => {
    const cell = totalRow.getCell(i + 4);
    cell.value = v;
    cell.numFmt = "#,##0";
  });
  for (let c = 3; c <= 8; c += 1) totalRow.getCell(c).font = { bold: true };
  r += 2;

  const jacheSum = results.reduce((s, x) => s + x.jacheTotal, 0);
  if (jacheSum > 0) {
    ws.mergeCells(`A${r}:J${r}`);
    ws.getCell(`A${r}`).value =
      `※ 자체수입 산입 합계 ${jacheSum.toLocaleString("ko-KR")}원 — 디모데 [자체수입] 메뉴에 세목별로 등록한 뒤, 해당 재원으로 팀지출 전표(자체수입 라디오 선택)를 올립니다.`;
    ws.getCell(`A${r}`).font = { color: { argb: "FF2F5496" }, bold: true };
    r += 1;
  }
  if (unmappedCategories.size > 0) {
    r += 1;
    ws.mergeCells(`A${r}:J${r}`);
    ws.getCell(`A${r}`).value =
      "⚠ 디모데 세목 미매핑 지출 — src/lib/dimode.ts CATEGORY_TO_DIMODE에 추가 필요: " +
      Array.from(unmappedCategories.entries())
        .map(([c, amt]) => `${c} ${amt.toLocaleString("ko-KR")}원`)
        .join(" / ");
    ws.getCell(`A${r}`).font = { color: { argb: "FFC00000" }, bold: true };
  }
  return wb;
}

/** 세목 폴더 이름: "506070215_심방비" (파일시스템 금지문자 제거) */
function itemFolderName(item: DimodeItem): string {
  const safe = item.name.replace(/[\\/?*[\]:"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${item.code}_${safe}`;
}

export async function buildDimodePackageZip(
  input: DimodePackageInput,
): Promise<{ buffer: Buffer; itemCount: number; fileCount: number }> {
  const {
    receipts,
    catMap,
    imagesByReceipt,
    downloadImage,
    refByReceiptId,
    bankInfoByReceiptId,
  } = input;

  const catName = (r: Receipt): string =>
    r.category_id ? (catMap.get(r.category_id) ?? "(미지정)") : "(미지정)";

  // 세목별 그룹핑 — paid 영수증만, 매핑 없는 계정은 경고로 수집
  const byItem = new Map<string, PackReceipt[]>();
  const unmappedCategories = new Map<string, number>();
  for (const r of receipts) {
    if (r.status !== "paid") continue;
    const category = catName(r);
    const code = CATEGORY_TO_DIMODE[category];
    if (!code) {
      unmappedCategories.set(
        category,
        (unmappedCategories.get(category) ?? 0) + (r.total_amount ?? 0),
      );
      continue;
    }
    const arr = byItem.get(code) ?? [];
    arr.push({
      receipt: r,
      ref: refByReceiptId.get(r.id) ?? `#${r.receipt_no ?? "?"}`,
      category,
      bank: bankInfoByReceiptId.get(r.id) ?? null,
    });
    byItem.set(code, arr);
  }

  const groups: ItemGroup[] = DIMODE_ITEMS.filter((item) => byItem.has(item.code)).map(
    (item) => {
      const members = (byItem.get(item.code) ?? []).sort((a, b) =>
        byRefOrder({ member: a }, { member: b }),
      );
      return {
        item,
        members,
        total: members.reduce((s, m) => s + (m.receipt.total_amount ?? 0), 0),
      };
    },
  );

  const zip = new JSZip();
  let fileCount = 0;
  const results: ItemResult[] = [];

  for (const g of groups) {
    const folder = itemFolderName(g.item);
    const buckets = buildFundBuckets(g.item, g.members);

    // 이미지 다운로드+압축은 세목당 1회 — 경계 영수증은 양쪽 버킷에서 재사용
    const withImages = g.members.filter(
      (m) => (imagesByReceipt.get(m.receipt.id) ?? []).length > 0,
    );
    const pagesByMember = new Map<PackReceipt, ProofPage[]>();
    await mapPool(withImages, DOWNLOAD_CONCURRENCY, async (m) => {
      const imgs = (imagesByReceipt.get(m.receipt.id) ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const amount = (m.receipt.total_amount ?? 0).toLocaleString("ko-KR");
      const baseHeader = `${m.ref} · ${m.receipt.expense_date ?? ""} · ${amount}원 · ${m.receipt.merchant ?? ""}`;
      const pages: ProofPage[] = [];
      for (const im of imgs) {
        try {
          const raw = await downloadImage(im.storage_path);
          pages.push({ header: baseHeader, image: await compressForPdf(raw) });
        } catch (e) {
          console.warn(
            `dimode-package: 증빙 이미지 처리 실패 — ${m.ref} ${im.storage_path}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      pages.forEach((p, i) => {
        if (pages.length > 1) p.header = `${baseHeader} (${i + 1}/${pages.length})`;
      });
      pagesByMember.set(m, pages);
    });

    const multiBucket = buckets.length > 1;
    let proofFiles = 0;
    let jeondogeumTotal = 0;
    let jacheTotal = 0;
    for (const bucket of buckets) {
      const bucketPath = multiBucket
        ? `${folder}/${bucket.kind === "jeondogeum" ? "1_전도금" : "2_자체수입"}`
        : folder;
      const title = `${DIMODE_TEAM.path} · ${g.item.subject} > ${g.item.name} (${g.item.code}) · 재원 ${bucket.label}`;
      const { attached, fileCount: emitted } = await emitBucketProofs(
        zip,
        bucketPath,
        bucket,
        pagesByMember,
        title,
      );
      const wb = buildBucketWorkbook(g, bucket, attached, input);
      const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
      zip.file(`${bucketPath}/00_명세_${safeName(g.item.name)}_${bucket.label}.xlsx`, xlsx);
      fileCount += emitted + 1;
      proofFiles += emitted;
      if (bucket.kind === "jeondogeum") jeondogeumTotal = bucket.total;
      else jacheTotal = bucket.total;
    }
    results.push({ group: g, jeondogeumTotal, jacheTotal, proofFiles });
  }

  const rootWb = buildRootSummaryWorkbook(results, unmappedCategories, input);
  zip.file("00_제출요약.xlsx", Buffer.from(await rootWb.xlsx.writeBuffer()));
  fileCount += 1;

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { buffer, itemCount: groups.length, fileCount };
}
