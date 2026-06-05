import { NextResponse } from "next/server";
import { getAdminContextOrNull } from "@/lib/download-helpers";
import { importBankFile } from "@/lib/bank-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await getAdminContextOrNull();
  if (!ctx || !ctx.profile.org_id) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const file = form.get("file");
  const bankAccountId = String(form.get("bankAccountId") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "통장 파일(.xls)을 첨부하세요." }, { status: 400 });
  }
  if (!bankAccountId) {
    return NextResponse.json({ error: "계좌를 선택하세요." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await importBankFile({
      orgId: ctx.profile.org_id,
      bankAccountId,
      fileName: file.name,
      buffer,
      importedBy: ctx.profile.id,
    });
    return NextResponse.json({ success: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : "통장 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
