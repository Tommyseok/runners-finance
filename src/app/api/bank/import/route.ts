import { NextResponse } from "next/server";
import { getAdminContextOrNull } from "@/lib/download-helpers";
import { importBankFile, type ImportSummary } from "@/lib/bank-service";

export const runtime = "nodejs";
export const maxDuration = 120;

interface FileResult {
  fileName: string;
  summary?: ImportSummary;
  error?: string;
}

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

  // 다중 파일("files") + 구버전 단일("file") 모두 허용
  const files = [...form.getAll("files"), ...form.getAll("file")].filter(
    (f): f is File => f instanceof File,
  );
  if (files.length === 0) {
    return NextResponse.json({ error: "통장 파일(.xls)을 첨부하세요." }, { status: 400 });
  }

  // 계좌는 각 파일의 계좌번호로 자동 인식 (순차 처리 — 대사는 각 import 후 org 전체 재실행이라 결과 동일)
  const results: FileResult[] = [];
  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const summary = await importBankFile({
        orgId: ctx.profile.org_id,
        fileName: file.name,
        buffer,
        importedBy: ctx.profile.id,
      });
      results.push({ fileName: file.name, summary });
    } catch (e) {
      const message = e instanceof Error ? e.message : "통장 처리 중 오류가 발생했습니다.";
      results.push({ fileName: file.name, error: message });
    }
  }

  const failed = results.filter((r) => r.error).length;
  return NextResponse.json({
    success: failed === 0,
    results,
  });
}
