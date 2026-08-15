import JSZip from "jszip";
import type { Receipt, ReceiptImage } from "@/lib/db-types";
import { renderExpenseReportPdf } from "@/lib/expense-report-pdf";
import { SETTLEMENT_DETAIL_SHEETS } from "@/lib/settlement";

export interface SettlementPdfZipInput {
  receipts: Receipt[];
  userMap: Map<string, string>;
  catMap: Map<string, string>;
  orgName: string;
  imagesByReceipt: Map<string, ReceiptImage[]>;
  downloadImage: (storagePath: string) => Promise<Buffer>;
  periodLabel: string;
}

const ETC_SHEET = "기타항목";

/**
 * 결산 상세 시트 구성과 동일하게 계정항목별 지출증빙 PDF를 만들어 ZIP으로 묶는다.
 * 고정 시트에 없는 계정(제자훈련·소모품 등)은 "기타항목" PDF로 모아 누락을 방지.
 */
export async function buildSettlementPdfZip(
  input: SettlementPdfZipInput,
): Promise<{ buffer: Buffer; fileCount: number }> {
  const { receipts, userMap, catMap, orgName, imagesByReceipt, downloadImage, periodLabel } =
    input;

  const nameOf = (r: Receipt): string =>
    r.category_id ? (catMap.get(r.category_id) ?? "(미지정)") : "(미지정)";

  const covered = new Set<string>();
  const groups: Array<{ sheetName: string; receipts: Receipt[] }> = [];
  for (const def of SETTLEMENT_DETAIL_SHEETS) {
    const members = receipts.filter((r) =>
      (def.categories as readonly string[]).includes(nameOf(r)),
    );
    for (const r of members) covered.add(r.id);
    groups.push({ sheetName: def.sheetName, receipts: members });
  }
  const etc = receipts.filter((r) => !covered.has(r.id));
  groups.push({ sheetName: ETC_SHEET, receipts: etc });

  const zip = new JSZip();
  let fileCount = 0;
  for (const g of groups) {
    if (g.receipts.length === 0) continue;
    const buffer = await renderExpenseReportPdf({
      receipts: g.receipts,
      userMap,
      catMap,
      orgName,
      imagesByReceipt,
      downloadImage,
      periodLabel: `${g.sheetName} · ${periodLabel}`,
    });
    zip.file(`지출증빙-${g.sheetName}-${periodLabel}.pdf`, buffer);
    fileCount += 1;
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE", // PDF는 이미 압축돼 있어 재압축 이득이 없다
  });
  return { buffer: buffer as Buffer, fileCount };
}
