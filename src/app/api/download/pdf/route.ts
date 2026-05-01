import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  buildContentDisposition,
  buildPeriodLabel,
  downloadImageBuffer,
  getAdminContextOrNull,
  loadReceiptsAndImages,
  maskAccount,
  safeFileSeg,
  type DownloadFilters,
} from "@/lib/download-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

const FONT_REGULAR = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSansKR-Regular.ttf",
);
const FONT_BOLD = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSansKR-Bold.ttf",
);

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "이 기능은 로컬 개발 환경에서만 사용 가능합니다." },
      { status: 503 },
    );
  }

  const ctx = await getAdminContextOrNull();
  if (!ctx) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  let fontRegular: Buffer;
  let fontBold: Buffer;
  try {
    [fontRegular, fontBold] = await Promise.all([
      fs.readFile(FONT_REGULAR),
      fs.readFile(FONT_BOLD),
    ]);
  } catch {
    return NextResponse.json(
      {
        error:
          "한국어 폰트가 없습니다. public/fonts/NotoSansKR-Regular.ttf 와 NotoSansKR-Bold.ttf 를 추가한 뒤 다시 시도해주세요.",
      },
      { status: 500 },
    );
  }

  let filters: DownloadFilters;
  try {
    filters = (await req.json()) as DownloadFilters;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const {
    receipts,
    userMap,
    catMap,
    bankMap,
    orgName,
    imagesByReceipt,
    admin,
  } = await loadReceiptsAndImages(ctx.profile.org_id!, filters);

  // PDFKit setup
  const pdf = new PDFDocument({
    size: "A4",
    margin: 50,
    autoFirstPage: false,
    bufferPages: true,
  });
  pdf.registerFont("KR", fontRegular);
  pdf.registerFont("KR-Bold", fontBold);

  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const total = receipts.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  const periodLabel = buildPeriodLabel(filters.month);

  // ----------- Cover page -----------
  pdf.addPage();
  pdf
    .font("KR-Bold")
    .fontSize(24)
    .text(`${orgName} 영수증 보고서`, { align: "center" });
  pdf.moveDown(0.4);
  pdf.font("KR").fontSize(13).fillColor("#666").text(periodLabel, {
    align: "center",
  });
  pdf.fillColor("#000");
  pdf.moveDown(2);

  pdf.font("KR-Bold").fontSize(13).text("요약");
  pdf.moveDown(0.3);
  pdf.font("KR").fontSize(11);
  pdf.text(`총 영수증: ${receipts.length}건`);
  pdf.text(`총 합계: ${total.toLocaleString("ko-KR")}원`);
  pdf.moveDown(1);

  // category summary
  const byCategory = new Map<string, { count: number; total: number }>();
  for (const r of receipts) {
    const key = r.category_id
      ? (catMap.get(r.category_id) ?? "(미지정)")
      : "(미지정)";
    const cur = byCategory.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += r.total_amount ?? 0;
    byCategory.set(key, cur);
  }
  pdf.font("KR-Bold").fontSize(12).text("카테고리별 합계");
  pdf.moveDown(0.3);
  pdf.font("KR").fontSize(11);
  const sortedCats = Array.from(byCategory.entries()).sort(
    (a, b) => b[1].total - a[1].total,
  );
  for (const [name, { count, total: sum }] of sortedCats) {
    pdf.text(`  • ${name}: ${count}건 / ${sum.toLocaleString("ko-KR")}원`);
  }
  pdf.moveDown(1);

  // user summary
  const byUser = new Map<string, { count: number; total: number }>();
  for (const r of receipts) {
    const key = userMap.get(r.user_id) ?? "(이름없음)";
    const cur = byUser.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += r.total_amount ?? 0;
    byUser.set(key, cur);
  }
  pdf.font("KR-Bold").fontSize(12).text("청구자별 합계");
  pdf.moveDown(0.3);
  pdf.font("KR").fontSize(11);
  const sortedUsers = Array.from(byUser.entries()).sort(
    (a, b) => b[1].total - a[1].total,
  );
  for (const [name, { count, total: sum }] of sortedUsers) {
    pdf.text(`  • ${name}: ${count}건 / ${sum.toLocaleString("ko-KR")}원`);
  }

  pdf.moveDown(2);
  pdf
    .font("KR")
    .fontSize(9)
    .fillColor("#888")
    .text(`생성일시: ${new Date().toLocaleString("ko-KR")}`, {
      align: "right",
    });
  pdf.fillColor("#000");

  // ----------- Per-receipt pages -----------
  for (let i = 0; i < receipts.length; i += 1) {
    const r = receipts[i];
    const seq = String(i + 1).padStart(3, "0");
    const catName = r.category_id
      ? (catMap.get(r.category_id) ?? "(미지정)")
      : "(미지정)";

    pdf.addPage();
    pdf
      .font("KR-Bold")
      .fontSize(14)
      .text(`#${seq} │ ${catName} │ ${r.expense_date ?? "-"}`);
    pdf.moveDown(0.6);

    pdf.font("KR").fontSize(11);
    pdf.text(`가맹점: ${r.merchant ?? "-"}`);
    pdf.text(
      `금액: ₩${(r.total_amount ?? 0).toLocaleString("ko-KR")}`,
    );
    pdf.text(`청구자: ${userMap.get(r.user_id) ?? "-"}`);
    pdf.text(
      `환급계좌: ${r.refund_bank_name ?? "-"}  ${maskAccount(r.refund_account)}`,
    );
    pdf.text(`예금주: ${r.refund_holder ?? "-"}`);
    pdf.text(
      `입금상태: ${r.status === "paid" ? "송금완료" : "대기중"}`,
    );
    if (r.status === "paid") {
      if (r.paid_at) pdf.text(`입금일자: ${r.paid_at.slice(0, 10)}`);
      if (r.paid_from_bank_id) {
        pdf.text(`출금통장: ${bankMap.get(r.paid_from_bank_id) ?? "-"}`);
      }
    }
    if (r.description) {
      pdf.moveDown(0.3);
      pdf.text(`메모: ${r.description}`, {
        width: pdf.page.width - 100,
      });
    }
    pdf.moveDown(0.8);

    // images
    const imgs = imagesByReceipt.get(r.id) ?? [];
    for (let j = 0; j < imgs.length; j += 1) {
      const img = imgs[j];
      let buf: Buffer;
      try {
        const raw = await downloadImageBuffer(admin, img.storage_path);
        buf = await sharp(raw)
          .rotate()
          .resize({ width: 1500, withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
      } catch (e) {
        console.warn("[download/pdf] image skip:", img.storage_path, e);
        pdf
          .font("KR")
          .fontSize(10)
          .fillColor("red")
          .text(`(이미지 로드 실패: ${img.storage_path})`)
          .fillColor("#000");
        continue;
      }

      // First image tries to fit remaining space; subsequent on new pages.
      if (j === 0) {
        const remaining = pdf.page.height - pdf.y - 50;
        if (remaining < 220) pdf.addPage();
      } else {
        pdf.addPage();
      }
      const w = (pdf.page.width - 100) * 0.95; // ~80-90% width visually
      const h = pdf.page.height - pdf.y - 50;
      const x = (pdf.page.width - w) / 2;
      try {
        pdf.image(buf, x, pdf.y, { fit: [w, h] });
      } catch (e) {
        console.warn("[download/pdf] embed fail:", img.storage_path, e);
      }
    }
  }

  pdf.end();
  const buffer = await finished;

  const filename = `runners-finance-report-${safeFileSeg(orgName) || "org"}-${periodLabel}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
