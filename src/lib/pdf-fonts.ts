import path from "node:path";
import fs from "node:fs/promises";

/** PDF 생성용 한글 폰트(NanumGothic, OFL). repo에 포함되어 프로덕션에서도 동작. */
const FONT_REGULAR = path.join(process.cwd(), "public", "fonts", "NanumGothic-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public", "fonts", "NanumGothic-Bold.ttf");

export interface PdfFonts {
  regular: Buffer;
  bold: Buffer;
}

let cached: PdfFonts | null = null;

export async function loadPdfFonts(): Promise<PdfFonts> {
  if (cached) return cached;
  const [regular, bold] = await Promise.all([
    fs.readFile(FONT_REGULAR),
    fs.readFile(FONT_BOLD),
  ]);
  cached = { regular, bold };
  return cached;
}
