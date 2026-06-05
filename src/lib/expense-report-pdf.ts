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

// 가로 A4 표 컬럼 (합 ≈ 782)
const COLS = [
  { key: "no", label: "순번", w: 34, align: "center" as const },
  { key: "user", label: "지출인", w: 64, align: "center" as const },
  { key: "edate", label: "지출일자", w: 74, align: "center" as const },
  { key: "cdate", label: "청구일자", w: 74, align: "center" as const },
  { key: "amount", label: "지출금액", w: 86, align: "right" as const },
  { key: "category", label: "계정항목", w: 116, align: "left" as const },
  { key: "merchant", label: "거래처", w: 140, align: "left" as const },
  { key: "image", label: "영수증", w: 160, align: "center" as const },
];
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0);
const ROW_H = 150;
const MARGIN = 30;

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
        pdf
          .font(col.key === "amount" ? "KR-Bold" : "KR")
          .fontSize(col.key === "merchant" || col.key === "category" ? 8.5 : 9)
          .fillColor("#000")
          .text(cells[col.key], x + 4, y + 6, {
            width: col.w - 8,
            height: ROW_H - 12,
            align: col.align,
            ellipsis: true,
          });
      }
      x += col.w;
    }

    const imgCol = COLS[COLS.length - 1];
    const imgX = tableRight - imgCol.w;
    const imgs = imagesByReceipt.get(r.id) ?? [];
    if (imgs.length > 0) {
      try {
        const raw = await downloadImage(imgs[0].storage_path);
        const buf = await sharp(raw)
          .rotate()
          .resize({ width: 700, height: 900, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        pdf.image(buf, imgX + 5, y + 5, {
          fit: [imgCol.w - 10, ROW_H - 10],
          align: "center",
          valign: "center",
        });
      } catch {
        pdf
          .font("KR")
          .fontSize(8)
          .fillColor("#999")
          .text("(이미지 로드실패)", imgX + 5, y + ROW_H / 2 - 4, {
            width: imgCol.w - 10,
            align: "center",
          });
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
  const H = 20;
  let x = startX;
  for (const col of COLS) {
    pdf.rect(x, y, col.w, H).fillColor("#2f5496").fill();
    pdf
      .font("KR-Bold")
      .fontSize(9)
      .fillColor("#ffffff")
      .text(col.label, x + 2, y + 5, { width: col.w - 4, align: "center" });
    x += col.w;
  }
  pdf.fillColor("#000");
  return y + H;
}
