import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";
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
 * 정산 명세 엑셀 1개 + 증빙 이미지(영수증당 1장 합성)를 담아 ZIP으로 묶는다.
 *
 * 디모데 팀지출 전표의 첨부 제약(슬롯 20개, 이미지 무제한·pdf/xlsx 1MB)에 맞춰:
 * - 명세 엑셀 1개 + 이미지 최대 19개 = 슬롯 20개 이내
 * - 영수증이 19건을 넘으면 여러 영수증을 한 이미지에 세로로 묶는다 (라벨 띠로 구분)
 */

const MAX_IMAGE_FILES = 19;
const IMG_WIDTH = 1200;
const LABEL_HEIGHT = 56;
const RECEIPT_GAP = 28;
/** 개별 영수증 사진의 최대 세로 픽셀 (합성 높이 폭주 방지) */
const MAX_SINGLE_IMG_H = 3000;
/** 합성 jpg 1장의 최대 세로 픽셀 — JPEG 포맷 한계(65,535px)에 여유를 둔 값 */
const MAX_COMPOSITE_H = 60000;
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

/**
 * SVG 라벨의 한글이 서버(람다)에서 깨지지 않도록 번들된 NanumGothic을
 * fontconfig에 등록한다. sharp(librsvg)가 최초 렌더 전에 읽도록 env를 먼저 세팅.
 */
let fontconfigReady = false;
function ensureKoreanFont(): void {
  if (fontconfigReady) return;
  fontconfigReady = true;
  try {
    const fontDir = path.join(process.cwd(), "public", "fonts");
    const confDir = path.join(os.tmpdir(), "fontconfig");
    mkdirSync(confDir, { recursive: true });
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>${path.join(os.tmpdir(), "fonts-cache")}</cachedir>
</fontconfig>`;
    const confPath = path.join(confDir, "fonts.conf");
    writeFileSync(confPath, conf);
    if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = confPath;
    if (!process.env.FONTCONFIG_PATH) process.env.FONTCONFIG_PATH = confDir;
  } catch (e) {
    // 폰트 설정 실패 시에도 패키지 생성은 계속 (라벨 글꼴만 대체됨)
    console.warn(
      `dimode-package: fontconfig 설정 실패 — 라벨 한글이 대체 글꼴로 렌더링될 수 있음: ${e instanceof Error ? e.message : e}`,
    );
  }
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 합성 이미지 안에서 영수증을 구분하는 라벨 띠 (SVG → sharp 합성) */
function labelStrip(text: string): Buffer {
  const svg = `<svg width="${IMG_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#2F5496"/>
    <text x="16" y="${LABEL_HEIGHT / 2 + 8}" font-family="NanumGothic, Malgun Gothic, sans-serif"
      font-size="26" font-weight="bold" fill="#ffffff">${escapeXml(text)}</text>
  </svg>`;
  return Buffer.from(svg);
}

async function normalizeImage(buf: Buffer): Promise<{ buf: Buffer; h: number }> {
  const out = await sharp(buf)
    .rotate()
    .resize(IMG_WIDTH, MAX_SINGLE_IMG_H, { fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 82 })
    .toBuffer();
  const meta = await sharp(out).metadata();
  return { buf: out, h: meta.height ?? 0 };
}

/** 라벨 띠 + 영수증 이미지(들)를 세로로 이어 붙인 한 장의 jpg */
async function composeReceipts(
  parts: Array<{ label: string; images: Array<{ buf: Buffer; h: number }> }>,
): Promise<Buffer> {
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  let y = 0;
  for (const p of parts) {
    layers.push({ input: labelStrip(p.label), left: 0, top: y });
    y += LABEL_HEIGHT;
    for (const img of p.images) {
      layers.push({ input: img.buf, left: 0, top: y });
      y += img.h;
    }
    y += RECEIPT_GAP;
  }
  const height = Math.max(1, y - RECEIPT_GAP);
  return sharp({
    create: { width: IMG_WIDTH, height, channels: 3, background: "#ffffff" },
  })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toBuffer();
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
    `세목별 폴더에 명세 엑셀 1개 + 증빙 이미지(슬롯 20개 이내). 디모데 수치 기준일 ${DIMODE_SNAPSHOT_DATE} · 033/017 계좌 구분은 결산 엑셀의 '디모데대사' 시트 참조`;
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
  ensureKoreanFont();

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
    // 1) 이미지 다운로드+정규화 (동시 4, 실패한 장은 건너뛰고 계속 — 한 장 때문에 전체 실패 금지)
    const normalizedByMember = new Map<PackReceipt, Array<{ buf: Buffer; h: number }>>();
    await mapPool(withImages, DOWNLOAD_CONCURRENCY, async (m) => {
      const imgs = (imagesByReceipt.get(m.receipt.id) ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const normalized: Array<{ buf: Buffer; h: number }> = [];
      for (const im of imgs) {
        try {
          const raw = await downloadImage(im.storage_path);
          normalized.push(await normalizeImage(raw));
        } catch (e) {
          console.warn(
            `dimode-package: 증빙 이미지 처리 실패 — ${m.ref} ${im.storage_path}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      normalizedByMember.set(m, normalized);
    });

    // 2) 영수증 → 합성 단위(라벨+이미지). 단독으로 높이 한계를 넘는 영수증은 (계속)으로 분할.
    interface Unit {
      member: PackReceipt;
      label: string;
      /** 같은 영수증의 분할 순번 (1 = 첫 조각) */
      part: number;
      images: Array<{ buf: Buffer; h: number }>;
      height: number;
    }
    const units: Unit[] = [];
    for (const m of withImages) {
      const normalized = normalizedByMember.get(m) ?? [];
      if (normalized.length === 0) continue; // 전부 실패 → 명세에 '증빙없음'으로 남음
      const amount = (m.receipt.total_amount ?? 0).toLocaleString("ko-KR");
      const baseLabel = `${m.ref} · ${m.receipt.expense_date ?? ""} · ${amount}원 · ${m.receipt.merchant ?? ""}`;
      let seg: Array<{ buf: Buffer; h: number }> = [];
      let segH = LABEL_HEIGHT;
      let segNo = 0;
      const flush = () => {
        if (seg.length === 0) return;
        segNo += 1;
        units.push({
          member: m,
          label: segNo === 1 ? baseLabel : `${baseLabel} (계속 ${segNo})`,
          part: segNo,
          images: seg,
          height: segH + RECEIPT_GAP,
        });
        seg = [];
        segH = LABEL_HEIGHT;
      };
      for (const img of normalized) {
        if (seg.length > 0 && segH + img.h > MAX_COMPOSITE_H) flush();
        seg.push(img);
        segH += img.h;
      }
      flush();
    }

    // 3) 단위들을 파일로 패킹 — 슬롯 한도(19)를 지향하되 JPEG 높이 한계는 절대 넘지 않는다.
    const perFileTarget = Math.max(1, Math.ceil(units.length / MAX_IMAGE_FILES));
    const files: Unit[][] = [];
    let cur: Unit[] = [];
    let curH = 0;
    for (const u of units) {
      if (cur.length > 0 && (cur.length >= perFileTarget || curH + u.height > MAX_COMPOSITE_H)) {
        files.push(cur);
        cur = [];
        curH = 0;
      }
      cur.push(u);
      curH += u.height;
    }
    if (cur.length > 0) files.push(cur);

    for (const fileUnits of files) {
      const first = fileUnits[0];
      const last = fileUnits[fileUnits.length - 1];
      let name: string;
      if (fileUnits.length === 1) {
        const mmdd = (first.member.receipt.expense_date ?? "").slice(5).replace("-", "");
        const base = `${first.member.ref}_${mmdd}_${first.member.receipt.total_amount}`;
        name = safeName(first.part === 1 ? base : `${base}_계속${first.part}`) + ".jpg";
      } else {
        name = safeName(`${first.member.ref}~${last.member.ref}`) + ".jpg";
      }
      const jpg = await composeReceipts(
        fileUnits.map((u) => ({ label: u.label, images: u.images })),
      );
      zip.file(`${folder}/${name}`, jpg);
      for (const u of fileUnits) {
        const m = u.member;
        m.attachedFile = m.attachedFile
          ? (m.attachedFile.includes(name) ? m.attachedFile : `${m.attachedFile} / ${name}`)
          : name;
      }
      fileCount += 1;
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
