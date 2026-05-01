import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";
import {
  buildContentDisposition,
  buildPeriodLabel,
  downloadImageBuffer,
  getAdminContextOrNull,
  loadReceiptsAndImages,
  safeFileSeg,
  type DownloadFilters,
} from "@/lib/download-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "이 기능은 로컬 개발 환경에서만 사용 가능합니다." },
      { status: 503 },
    );
  }

  const ctx = await getAdminContextOrNull();
  if (!ctx) {
    return NextResponse.json(
      { error: "권한이 없습니다." },
      { status: 401 },
    );
  }

  let filters: DownloadFilters;
  try {
    filters = (await req.json()) as DownloadFilters;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { receipts, userMap, catMap, orgName, imagesByReceipt, admin } =
    await loadReceiptsAndImages(ctx.profile.org_id!, filters);

  // ---- Build Excel ----
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("영수증");
  sheet.columns = [
    { header: "번호", key: "no", width: 6 },
    { header: "날짜", key: "date", width: 12 },
    { header: "카테고리", key: "category", width: 16 },
    { header: "가맹점", key: "merchant", width: 24 },
    { header: "금액", key: "amount", width: 12 },
    { header: "청구자", key: "user", width: 12 },
    { header: "환급은행", key: "bank", width: 12 },
    { header: "환급계좌", key: "account", width: 22 },
    { header: "예금주", key: "holder", width: 10 },
    { header: "입금상태", key: "status", width: 10 },
    { header: "입금일", key: "paid", width: 12 },
    { header: "메모", key: "memo", width: 32 },
    { header: "영수증 사진", key: "image", width: 32 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5C8AE" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  receipts.forEach((r, i) => {
    sheet.addRow({
      no: i + 1,
      date: r.expense_date ?? "",
      category: r.category_id
        ? (catMap.get(r.category_id) ?? "(미지정)")
        : "(미지정)",
      merchant: r.merchant ?? "",
      amount: r.total_amount ?? 0,
      user: userMap.get(r.user_id) ?? "",
      bank: r.refund_bank_name ?? "",
      account: r.refund_account ?? "",
      holder: r.refund_holder ?? "",
      status: r.status === "paid" ? "송금완료" : "대기중",
      paid: r.paid_at ? r.paid_at.slice(0, 10) : "",
      memo: r.description ?? "",
    });
  });
  sheet.getColumn("amount").numFmt = "#,##0";
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // ---- Embed first image of each receipt into the cell ----
  const ROW_HEIGHT = 100; // points (~133px)
  const IMG_DISPLAY_W = 200; // px
  const IMG_DISPLAY_H_MAX = 130; // px
  const IMAGE_COL_INDEX = 13; // 1-indexed (A=1 ... M=13)

  // Cache of original buffers so we don't re-download for the images/ folder.
  const originalCache = new Map<string, Buffer>();

  // Set uniform data-row heights and middle-align contents
  for (let i = 0; i < receipts.length; i += 1) {
    const row = sheet.getRow(i + 2); // header is row 1
    row.height = ROW_HEIGHT;
    row.alignment = { vertical: "middle", wrapText: true };
  }

  for (let i = 0; i < receipts.length; i += 1) {
    const imgs = imagesByReceipt.get(receipts[i].id) ?? [];
    if (imgs.length === 0) continue;
    const first = imgs[0];

    let raw: Buffer;
    try {
      raw = await downloadImageBuffer(admin, first.storage_path);
      originalCache.set(first.storage_path, raw);
    } catch (e) {
      console.warn("[download/zip] embed download fail:", first.storage_path, e);
      continue;
    }

    let resizedBuf: Buffer;
    let info: sharp.OutputInfo;
    try {
      const out = await sharp(raw)
        .rotate()
        .resize({ width: 400, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      resizedBuf = Buffer.from(out.data);
      info = out.info;
    } catch (e) {
      console.warn("[download/zip] embed resize fail:", first.storage_path, e);
      continue;
    }

    // Compute display dimensions preserving aspect ratio
    const aspect = info.height / info.width;
    let displayW = IMG_DISPLAY_W;
    let displayH = displayW * aspect;
    if (displayH > IMG_DISPLAY_H_MAX) {
      displayH = IMG_DISPLAY_H_MAX;
      displayW = displayH / aspect;
    }

    try {
      const imageId = workbook.addImage({
        buffer: resizedBuf as unknown as ExcelJS.Buffer,
        extension: "jpeg",
      });
      sheet.addImage(imageId, {
        // 0-indexed in addImage. Header row is index 0; data row i is at i+1.
        tl: { col: IMAGE_COL_INDEX - 1 + 0.05, row: i + 1 + 0.05 },
        ext: { width: displayW, height: displayH },
        editAs: "oneCell",
      });
    } catch (e) {
      console.warn("[download/zip] addImage fail:", first.storage_path, e);
    }
  }

  const xlsxArrayBuffer = await workbook.xlsx.writeBuffer();
  const xlsxBuffer = Buffer.from(xlsxArrayBuffer as ArrayBuffer);

  // ---- Build ZIP ----
  const zip = new JSZip();
  zip.file("receipts.xlsx", xlsxBuffer);

  for (let i = 0; i < receipts.length; i += 1) {
    const r = receipts[i];
    const imgs = imagesByReceipt.get(r.id) ?? [];
    if (imgs.length === 0) continue;

    const seq = String(i + 1).padStart(3, "0");
    const cat = safeFileSeg(
      r.category_id ? catMap.get(r.category_id) : "미지정",
    ) || "미지정";
    const dt = r.expense_date ?? "no-date";
    const merchant = safeFileSeg(r.merchant) || "no-merchant";
    const amount = r.total_amount ?? 0;

    for (let j = 0; j < imgs.length; j += 1) {
      const img = imgs[j];
      const ext =
        (img.storage_path.split(".").pop() ?? "jpg").toLowerCase().slice(0, 5);
      const suffix =
        imgs.length > 1 ? `_${String(j + 1).padStart(2, "0")}` : "";
      const fname = `${seq}_${cat}_${dt}_${merchant}_${amount}원${suffix}.${ext}`;
      try {
        const cached = originalCache.get(img.storage_path);
        const buf = cached ?? (await downloadImageBuffer(admin, img.storage_path));
        zip.file(`images/${fname}`, buf);
      } catch (e) {
        console.warn("[download/zip] image skip:", img.storage_path, e);
      }
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const period = buildPeriodLabel(filters.month);
  const filename = `runners-finance-${safeFileSeg(orgName) || "org"}-${period}.zip`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
