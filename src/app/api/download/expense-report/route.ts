import { NextResponse } from "next/server";
import {
  buildContentDisposition,
  downloadImageBuffer,
  getAdminContextOrNull,
  loadReceiptsAndImages,
  safeFileSeg,
  type DownloadFilters,
} from "@/lib/download-helpers";
import { renderExpenseReportPdf } from "@/lib/expense-report-pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ReportRequest extends DownloadFilters {
  periodLabel?: string;
}

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  let body: ReportRequest;
  try {
    body = (await req.json()) as ReportRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { receipts, userMap, catMap, orgName, imagesByReceipt, admin } =
    await loadReceiptsAndImages(ctx.profile.org_id, body);

  if (receipts.length === 0) {
    return NextResponse.json(
      { error: "선택한 기간에 지출 내역이 없습니다." },
      { status: 404 },
    );
  }

  try {
    const buffer = await renderExpenseReportPdf({
      receipts,
      userMap,
      catMap,
      orgName,
      imagesByReceipt,
      downloadImage: (p) => downloadImageBuffer(admin, p),
      periodLabel: body.periodLabel?.trim() || "전체기간",
    });
    const filename = `지출영수증증빙-${safeFileSeg(orgName) || "org"}-${safeFileSeg(body.periodLabel ?? "전체")}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": buildContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PDF 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
