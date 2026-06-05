import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { Receipt, ReceiptImage } from "@/lib/db-types";
import { loadPdfFonts } from "@/lib/pdf-fonts";
import { formatCurrency } from "@/lib/utils";

export interface ExpenseReportData {
  receipts: Receipt[];
  userMap: Map<string, string>;
  catMap: Map<string, string>;
  orgName: string;
  imagesByReceipt: Map<string, ReceiptImage[]>;
  /** storage_path → 원본 이미지 버퍼 */
  downloadImage: (storagePath: string) => Promise<Buffer>;
  periodLabel: string;
}

// 가로 A4(842pt) - 좌우 margin 30 = 가용폭 782pt.
// 텍스트 칸은 좁게(줄바꿈 허용), 영수증 칸은 최대한 넓게(영수증 3장 나란히).
const MARGIN = 30;
const USABLE_W = 842 - MARGIN * 2; // 782
const TEXT_COLS = [
  { key: "no", label: "순번", w: 20, align: "center" as const, fs: 8 },
  { key: "user", label: "지출인", w: 40, align: "center" as const, fs: 8 },
  { key: "edate", label: "지출일자", w: 46, align: "center" as const, fs: 7.5 },
  { key: "cdate", label: "청구일자", w: 46, align: "center" as const, fs: 7.5 },
  { key: "amount", label: "지출금액", w: 56, align: "right" as const, fs: 8 },
  { key: "category", label: "계정항목", w: 70, align: "left" as const, fs: 7.5 },
  { key: "merchant", label: "거래처", w: 80, align: "left" as const, fs: 7.5 },
];
const TEXT_W = TEXT_COLS.reduce((s, c) => s + c.w, 0);
const IMAGE_W = USABLE_W - TEXT_W; // 영수증 칸 (≈ 424pt)
const COLS = [
  ...TEXT_COLS,
  { key: "image", label: "영수증", w: IMAGE_W, align: "center" as const, fs: 8 },
];
const TABLE_W = USABLE_W;
const ROW_H = 200; // 영수증을 크게

export async function renderExpenseReportPdf(data: ExpenseReportData): Promise<Buffer> {
  const { receipts, userMap, catMap, orgName, imagesByReceipt, downloadImage, periodLabel } = data;
  const fonts = await loadPdfFonts();

  const pdf = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: MARGIN,
    autoFirstPage: false,
    bufferPages: true,
  });
  pdf.registerFont("KR", fonts.regular);
  pdf.registerFont("KR-Bold", fonts.bold);

  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const total = receipts.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  const startX = MARGIN;
  const tableRight = startX + TABLE_W;

  pdf.addPage();
  drawTitle(pdf, orgName, periodLabel, receipts.length, total);
  let y = pdf.y + 6;
  y = drawHeaderRow(pdf, startX, y);

  for (let i = 0; i < receipts.length; i += 1) {
    const r = receipts[i];
    if (y + ROW_H > pdf.page.height - MARGIN - 16) {
      pdf.addPage();
      y = MARGIN;
      y = drawHeaderRow(pdf, startX, y);
    }

    const catName = r.category_id ? (catMap.get(r.category_id) ?? "(미지정)") : "(미지정)";
    const cells: Record<string, string> = {
      no: String(i + 1),
      user: userMap.get(r.user_id) ?? "-",
      edate: r.expense_date ?? "-",
      cdate: r.created_at ? r.created_at.slice(0, 10) : "-",
      amount: formatCurrency(r.total_amount),
      category: catName,
      merchant: r.merchant ?? "-",
      image: "",
    };

    let x = startX;
    for (const col of COLS) {
      pdf.rect(x, y, col.w, ROW_H).strokeColor("#cccccc").lineWidth(0.5).stroke();
      if (col.key !== "image") {
        // 좁은 칸 — 줄바꿈 허용(ellipsis 없음), 세로 가운데 정렬 흉내(상단 패딩)
        pdf
          .font(col.key === "amount" ? "KR-Bold" : "KR")
          .fontSize(col.fs)
          .fillColor("#000")
          .text(cells[col.key], x + 2, y + 5, {
            width: col.w - 4,
            height: ROW_H - 10,
            align: col.align,
          });
      }
      x += col.w;
    }

    // 영수증 이미지 — 여러 장이면 나란히(칸을 장수로 분할). 고해상도 임베드.
    const imgCol = COLS[COLS.length - 1];
    const imgX = tableRight - imgCol.w;
    const imgs = imagesByReceipt.get(r.id) ?? [];
    if (imgs.length > 0) {
      const n = imgs.length;
      const cellW = (imgCol.w - 6) / n;
      for (let k = 0; k < n; k += 1) {
        try {
          const raw = await downloadImage(imgs[k].storage_path);
          const buf = await sharp(raw)
            .rotate()
            .resize({ width: 600, height: 900, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 78 })
            .toBuffer();
          pdf.image(buf, imgX + 3 + k * cellW, y + 4, {
            fit: [cellW - 3, ROW_H - 8],
            align: "center",
            valign: "center",
          });
        } catch {
          /* 한 장 실패해도 나머지는 계속 */
        }
      }
    } else {
      pdf
        .font("KR")
        .fontSize(8)
        .fillColor("#bbb")
        .text("영수증 없음", imgX + 5, y + ROW_H / 2 - 4, {
          width: imgCol.w - 10,
          align: "center",
        });
    }
    pdf.fillColor("#000");
    y += ROW_H;
  }

  const range = pdf.bufferedPageRange();
  for (let p = 0; p < range.count; p += 1) {
    pdf.switchToPage(range.start + p);
    pdf
      .font("KR")
      .fontSize(8)
      .fillColor("#888")
      .text(
        `${orgName} 지출 영수증 증빙 · ${periodLabel} · ${p + 1}/${range.count}`,
        MARGIN,
        pdf.page.height - MARGIN + 2,
        { width: TABLE_W, align: "center" },
      );
  }

  pdf.end();
  return done;
}

function drawTitle(
  pdf: PDFKit.PDFDocument,
  orgName: string,
  period: string,
  count: number,
  total: number,
) {
  pdf
    .font("KR-Bold")
    .fontSize(18)
    .fillColor("#000")
    .text(`${orgName} 지출 영수증 증빙`, MARGIN, MARGIN, { align: "left" });
  pdf
    .font("KR")
    .fontSize(11)
    .fillColor("#444")
    .text(
      `기간: ${period}    |    총 ${count}건    |    합계 ${formatCurrency(total)}`,
      MARGIN,
      pdf.y + 2,
    );
  pdf.fillColor("#000");
  pdf.moveDown(0.4);
}

function drawHeaderRow(pdf: PDFKit.PDFDocument, startX: number, y: number): number {
  const H = 18;
  let x = startX;
  for (const col of COLS) {
    pdf.rect(x, y, col.w, H).fillColor("#2f5496").fill();
    pdf
      .font("KR-Bold")
      .fontSize(8)
      .fillColor("#ffffff")
      .text(col.label, x + 1, y + 5, { width: col.w - 2, align: "center" });
    x += col.w;
  }
  pdf.fillColor("#000");
  return y + H;
}
