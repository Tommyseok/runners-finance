import { NextResponse } from "next/server";
import {
  buildContentDisposition,
  downloadImageBuffer,
  getAdminContextOrNull,
  loadReceiptsAndImages,
  safeFileSeg,
} from "@/lib/download-helpers";
import { buildSettlementPdfZip } from "@/lib/settlement-pdfs";
import { buildReceiptRefMap } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const orgId = ctx.profile.org_id;

  let from: string | undefined;
  let to: string | undefined;
  let periodLabel = "전체기간";
  try {
    const body = (await req.json()) as { from?: string; to?: string; periodLabel?: string };
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    from = typeof body.from === "string" && DATE_RE.test(body.from) ? body.from : undefined;
    to = typeof body.to === "string" && DATE_RE.test(body.to) ? body.to : undefined;
    periodLabel = body.periodLabel ?? (from || to ? `${from ?? ""}~${to ?? ""}` : "전체기간");
  } catch {
    /* default all */
  }

  const { receipts, userMap, catMap, orgName, imagesByReceipt, admin } =
    await loadReceiptsAndImages(orgId, {
      month: "all",
      status: "all",
      category: "all",
      from,
      to,
    });
  if (receipts.length === 0) {
    return NextResponse.json({ error: "해당 기간에 영수증이 없습니다." }, { status: 404 });
  }

  const refByReceiptId = await buildReceiptRefMap(admin, orgId);
  const { buffer, fileCount } = await buildSettlementPdfZip({
    receipts,
    userMap,
    catMap,
    orgName,
    imagesByReceipt,
    downloadImage: (p) => downloadImageBuffer(admin, p),
    periodLabel,
    refByReceiptId,
  });
  if (fileCount === 0) {
    return NextResponse.json({ error: "생성할 PDF가 없습니다." }, { status: 404 });
  }

  const filename = `지출증빙일괄-${safeFileSeg(orgName) || "org"}-${safeFileSeg(periodLabel)}.zip`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": buildContentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
