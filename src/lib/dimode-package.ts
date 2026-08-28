import ExcelJS from "exceljs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { loadPdfFonts } from "@/lib/pdf-fonts";
import type { Receipt, ReceiptImage } from "@/lib/db-types";
import {
  CATEGORY_TO_DIMODE,
  DIMODE_ITEMS,
  DIMODE_SNAPSHOT_DATE,
  DIMODE_TEAM,
  type DimodeItem,
} from "@/lib/dimode";

/**
 * 디모데(교회 공식 재정시스템) 제출 패키지 — 세목(예산항목)별 폴더에
 * 정산 명세 엑셀 1개 + 증빙 PDF(1MB 이하로 자동 분할)를 담아 ZIP으로 묶는다.
 *
 * 디모데 팀지출 전표의 첨부 제약(슬롯 20개, pdf/xlsx는 1MB 제한)에 맞춰:
 * - 명세 엑셀 1개 + 증빙 PDF 최대 19개 = 슬롯 20개 이내
 * - 각 PDF는 1MB를 넘지 않도록 영수증(페이지) 단위로 잘라 담는다
 * - PDF 페이지마다 증빙번호·지출일·금액·거래처 헤더 → 한 문서로 넘겨보며 심사 가능
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

export interface DimodePackageInput {
  receipts: Receipt[];
  catMap: Map<string, string>;
  userMap: Map<string, string>;
  imagesByReceipt: Map<string, ReceiptImage[]>;
  downloadImage: (storagePath: string) => Promise<Buffer>;
  refByReceiptId: Map<string, string>;
  orgName: string;
  periodLabel: string;
}

interface PackReceipt {
  receipt: Receipt;
  ref: string;
  category: string;
  attachedFile: string | null;
}

interface ItemGroup {
  item: DimodeItem;
  members: PackReceipt[];
  total: number;
}

/** "소그룹-12" → ["소그룹", 12] — 세목 안에서 앱 계정별 증빙번호 순 정렬용 */
function splitRef(ref: string): [string, number] {
  const i = ref.lastIndexOf("-");
  if (i < 0) return [ref, 0];
  const n = Number(ref.slice(i + 1));
  return [ref.slice(0, i), Number.isFinite(n) ? n : 0];
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
async function renderProofPdf(
  title: string,
  pages: ProofPage[],
): Promise<Buffer> {
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
      .text(page.header.length > 72 ? `${page.header.slice(0, 71)}…` : page.header, MARGIN + 8, MARGIN + 7, {
        width: PAGE_W - MARGIN * 2 - 16,
        lineBreak: false,
      });
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

function buildItemWorkbook(
  group: ItemGroup,
  input: DimodePackageInput,
): ExcelJS.Workbook {
  const { item, members, total } = group;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("명세");
  ws.columns = [
    { width: 14 },
    { width: 20 },
    { width: 11 },
    { width: 26 },
    { width: 12 },
    { width: 10 },
    { width: 34 },
    { width: 34 },
  ];

  ws.mergeCells("A1:H1");
  ws.getCell("A1").value =
    `디모데 팀지출 증빙 명세 — ${item.subject} > ${item.name} (${item.code})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:H2");
  ws.getCell("A2").value =
    `${DIMODE_TEAM.path} (${DIMODE_TEAM.code}) · ${input.orgName} · ${input.periodLabel}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };
  ws.mergeCells("A3:H3");
  ws.getCell("A3").value =
    `예산 ${item.budget.toLocaleString("ko-KR")}원 · 전도금 배정 ${item.fundAllocated.toLocaleString("ko-KR")}원 · 실지출 ${total.toLocaleString("ko-KR")}원` +
    (total > item.fundAllocated
      ? ` (배정 초과 ${(total - item.fundAllocated).toLocaleString("ko-KR")}원은 자체수입 부담)`
      : "") +
    ` · 디모데 수치 기준일 ${DIMODE_SNAPSHOT_DATE}`;
  ws.getCell("A3").font = { italic: true, color: { argb: "FF595959" } };

  const headers = ["증빙번호", "앱 계정항목", "지출일", "거래처", "금액(원)", "지출인", "내용", "첨부파일"];
  const headerRow = ws.getRow(5);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  let r = 6;
  for (const m of members) {
    const row = ws.getRow(r);
    const desc = (m.receipt.description ?? "").split("·")[0].trim();
    const vals: Array<string | number> = [
      m.ref,
      m.category,
      m.receipt.expense_date ?? "",
      m.receipt.merchant ?? "",
      m.receipt.total_amount,
      input.userMap.get(m.receipt.user_id) ?? "",
      desc,
      m.attachedFile ?? "증빙없음",
    ];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (i === 4) cell.numFmt = "#,##0";
      if (i === 0 || i === 2) cell.alignment = { horizontal: "center" };
    });
    if (!m.attachedFile) {
      row.getCell(8).font = { color: { argb: "FFC00000" }, bold: true };
    }
    r += 1;
  }
  const totalRow = ws.getRow(r);
  totalRow.getCell(4).value = "합계";
  totalRow.getCell(5).value = total;
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(5).font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 5 }];
  return wb;
}

function buildRootSummaryWorkbook(
  groups: ItemGroup[],
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
    { width: 8 },
    { width: 12 },
  ];
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value =
    `디모데 제출 패키지 요약 — ${DIMODE_TEAM.path} (${DIMODE_TEAM.code}), ${input.periodLabel}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:H2");
  ws.getCell("A2").value =
    `세목별 폴더에 명세 엑셀 1개 + 증빙 PDF(각 1MB 이하, 슬롯 20개 이내). 디모데 수치 기준일 ${DIMODE_SNAPSHOT_DATE} · 033/017 계좌 구분은 결산 엑셀의 '디모데대사' 시트 참조`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  const headers = ["세목코드", "과목", "세목", "예산", "전도금 배정", "실지출", "건수", "증빙파일 수"];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  let r = 5;
  for (const g of groups) {
    const row = ws.getRow(r);
    const vals: Array<string | number> = [
      g.item.code,
      g.item.subject,
      g.item.name,
      g.item.budget,
      g.item.fundAllocated,
      g.total,
      g.members.length,
      new Set(g.members.map((m) => m.attachedFile).filter(Boolean)).size,
    ];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (i >= 3 && i <= 5) cell.numFmt = "#,##0";
      if (i <= 2 || i >= 6) cell.alignment = { horizontal: "center" };
    });
    r += 1;
  }
  if (unmappedCategories.size > 0) {
    r += 1;
    ws.mergeCells(`A${r}:H${r}`);
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
  const { receipts, catMap, imagesByReceipt, downloadImage, refByReceiptId } = input;

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
      attachedFile: null,
    });
    byItem.set(code, arr);
  }

  const groups: ItemGroup[] = DIMODE_ITEMS.filter((item) => byItem.has(item.code)).map(
    (item) => {
      const members = (byItem.get(item.code) ?? []).sort((a, b) => {
        const [ga, na] = splitRef(a.ref);
        const [gb, nb] = splitRef(b.ref);
        if (ga !== gb) return ga < gb ? -1 : 1;
        return na - nb;
      });
      return {
        item,
        members,
        total: members.reduce((s, m) => s + (m.receipt.total_amount ?? 0), 0),
      };
    },
  );

  const zip = new JSZip();
  let fileCount = 0;

  for (const g of groups) {
    const folder = itemFolderName(g.item);

    // 이미지가 있는 영수증만 파일 분배 대상
    const withImages = g.members.filter(
      (m) => (imagesByReceipt.get(m.receipt.id) ?? []).length > 0,
    );
    // 1) 이미지 다운로드+압축 (동시 4, 실패한 장은 건너뛰고 계속 — 한 장 때문에 전체 실패 금지)
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

    // 2) 페이지 바이트 예산으로 PDF 파일 구성 — 영수증 경계에서만 자르되,
    //    한 영수증이 예산을 단독 초과하면 페이지 단위로 나눈다.
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
    for (const m of withImages) {
      const pages = pagesByMember.get(m) ?? [];
      if (pages.length === 0) continue; // 전부 실패 → 명세에 '증빙없음'으로 남음
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
      if (!cur) {
        cur = { pages: [], members: [], firstRef: m.ref, lastRef: m.ref, bytes: 0 };
      }
      cur.pages.push(...pages);
      cur.members.push(m);
      cur.lastRef = m.ref;
      cur.bytes += memberBytes;
    }
    flushPlan();

    // 3) PDF 렌더 — 1MB를 넘으면 반으로 갈라 재시도 (폰트·구조 오버헤드 방어)
    const title = `${DIMODE_TEAM.path} · ${g.item.subject} > ${g.item.name} (${g.item.code})`;
    const renderQueue: PdfPlan[] = [...plans];
    let partSeq = 0;
    let emittedProofs = 0;
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
      zip.file(`${folder}/${fileName}`, buf);
      for (const m of plan.members) {
        m.attachedFile = m.attachedFile
          ? (m.attachedFile.includes(fileName) ? m.attachedFile : `${m.attachedFile} / ${fileName}`)
          : fileName;
      }
      fileCount += 1;
      emittedProofs += 1;
    }

    if (emittedProofs > MAX_PROOF_FILES) {
      console.warn(
        `dimode-package: ${g.item.name} 증빙 PDF ${emittedProofs}개 — 첨부 슬롯(${MAX_PROOF_FILES}) 초과, 전표를 나눠 제출 필요`,
      );
    }

    const wb = buildItemWorkbook(g, input);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    zip.file(`${folder}/00_명세_${safeName(g.item.name)}.xlsx`, xlsx);
    fileCount += 1;
  }

  const rootWb = buildRootSummaryWorkbook(groups, unmappedCategories, input);
  zip.file("00_제출요약.xlsx", Buffer.from(await rootWb.xlsx.writeBuffer()));
  fileCount += 1;

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { buffer, itemCount: groups.length, fileCount };
}
