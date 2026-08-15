import JSZip from "jszip";
import type { Receipt, ReceiptImage } from "@/lib/db-types";
import { renderExpenseReportPdf } from "@/lib/expense-report-pdf";
import { categorySheetName } from "@/lib/settlement";

export interface SettlementPdfZipInput {
  receipts: Receipt[];
  userMap: Map<string, string>;
  catMap: Map<string, string>;
  orgName: string;
  imagesByReceipt: Map<string, ReceiptImage[]>;
  downloadImage: (storagePath: string) => Promise<Buffer>;
  periodLabel: string;
  refByReceiptId?: Map<string, string>;
}

/**
 * 지출이 있는 모든 계정항목마다 지출증빙 PDF를 만들어 ZIP으로 묶는다.
 * 새 계정이 추가되면 PDF도 자동으로 늘어난다 — 증빙 누락 방지.
 */
export async function buildSettlementPdfZip(
  input: SettlementPdfZipInput,
): Promise<{ buffer: Buffer; fileCount: number }> {
  const {
    receipts, userMap, catMap, orgName, imagesByReceipt, downloadImage, periodLabel,
    refByReceiptId,
  } = input;

  const nameOf = (r: Receipt): string =>
    r.category_id ? (catMap.get(r.category_id) ?? "(미지정)") : "(미지정)";

  // 계정항목별 그룹 (금액 큰 순) — 계정 없는 영수증은 "미지정"으로 수집해 누락 방지
  const groupMap = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const key = nameOf(r);
    const arr = groupMap.get(key) ?? [];
    arr.push(r);
    groupMap.set(key, arr);
  }
  const groups = Array.from(groupMap.entries())
    .map(([category, members]) => ({
      sheetName: category === "(미지정)" ? "미지정" : categorySheetName(category),
      members,
      total: members.reduce((s, r) => s + (r.total_amount ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  const zip = new JSZip();
  let fileCount = 0;
  for (const g of groups) {
    if (g.members.length === 0) continue;
    const buffer = await renderExpenseReportPdf({
      receipts: g.members,
      userMap,
      catMap,
      orgName,
      imagesByReceipt,
      downloadImage,
      periodLabel: `${g.sheetName} · ${periodLabel}`,
      refByReceiptId,
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
