import * as XLSX from "xlsx";

/**
 * KB은행 거래내역 .xls(BIFF/OLE2) 파서.
 * Python `scripts/extract-bank-v2.py`(xlrd) 의 TS 포팅 — 동일 컬럼 인덱스.
 * 한글은 codepage 949(CP949)로 디코딩해야 깨지지 않음.
 */

export interface ParsedBankTxn {
  no: number | null;
  /** ISO timestamp with KST offset, e.g. "2026-06-01T13:20:01+09:00" */
  txnAt: string;
  /** YYYY-MM-DD (KST) */
  date: string;
  counterparty: string;
  withdraw: number;
  deposit: number;
  balance: number | null;
  accountNote: string;
  memo: string;
  method: string;
  branch: string;
  /** date|withdraw|deposit|balance|counterparty — 멱등 재업로드용 키 */
  dedupeKey: string;
}

export interface ParsedBankFile {
  meta: {
    accountNo: string | null;
    customer: string | null;
    queryPeriod: string | null;
    queryFrom: string | null;
    queryTo: string | null;
    totalBalance: number | null;
    withdrawTotal: number | null;
    depositTotal: number | null;
  };
  txns: ParsedBankTxn[];
}

function toInt(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

function parseMoneyMeta(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.split(":").slice(1).join(":").trim();
  const n = Number(m.replace(/[,\s원]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "2026.06.01 13:20:01" -> { date: "2026-06-01", txnAt: "2026-06-01T13:20:01+09:00" } */
function parseDateTime(raw: unknown): { date: string; txnAt: string } | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const date = `${y}-${mo}-${d}`;
  const time = hh ? `${hh}:${mm}:${ss}` : "00:00:00";
  return { date, txnAt: `${date}T${time}+09:00` };
}

export function parseBankXls(buf: Buffer | ArrayBuffer): ParsedBankFile {
  const wb = XLSX.read(buf, { type: "buffer", codepage: 949 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("빈 엑셀 파일입니다.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
  });

  // --- meta (rows 0-5: "키 : 값") ---
  const metaMap = new Map<string, string>();
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    for (const cell of rows[r] ?? []) {
      const v = String(cell ?? "").trim();
      const idx = v.indexOf(" : ");
      if (idx >= 0) metaMap.set(v.slice(0, idx).trim(), v.slice(idx + 3).trim());
    }
  }
  const period = metaMap.get("조회기간") ?? null; // "2026.01.01 ~ 2026.06.05"
  let queryFrom: string | null = null;
  let queryTo: string | null = null;
  if (period) {
    const pm = period.match(/(\d{4})\.(\d{2})\.(\d{2}).*?(\d{4})\.(\d{2})\.(\d{2})/);
    if (pm) {
      queryFrom = `${pm[1]}-${pm[2]}-${pm[3]}`;
      queryTo = `${pm[4]}-${pm[5]}-${pm[6]}`;
    }
  }

  // --- header at row 6, data from row 7 ---
  const txns: ParsedBankTxn[] = [];
  for (let r = 7; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const noCell = row[0];
    if (noCell === undefined || noCell === null || noCell === "") continue;
    const dt = parseDateTime(row[1]);
    if (!dt) continue;
    const withdraw = toInt(row[3]);
    const deposit = toInt(row[4]);
    const balance = row[5] === undefined || row[5] === "" ? null : toInt(row[5]);
    const counterparty = String(row[2] ?? "").trim();
    const dedupeKey = [dt.date, withdraw, deposit, balance ?? "", counterparty].join("|");
    txns.push({
      no: typeof noCell === "number" ? Math.round(noCell) : Number(noCell) || null,
      txnAt: dt.txnAt,
      date: dt.date,
      counterparty,
      withdraw,
      deposit,
      balance,
      accountNote: String(row[6] ?? "").trim(),
      memo: String(row[7] ?? "").trim(),
      method: String(row[8] ?? "").trim(),
      branch: String(row[9] ?? "").trim(),
      dedupeKey,
    });
  }

  return {
    meta: {
      accountNo: metaMap.get("계좌번호") ?? null,
      customer: metaMap.get("고객명") ?? null,
      queryPeriod: period,
      queryFrom,
      queryTo,
      totalBalance: parseMoneyMeta(metaMap.get("총잔액")),
      withdrawTotal: parseMoneyMeta(metaMap.get("출금합계")),
      depositTotal: parseMoneyMeta(metaMap.get("입금합계")),
    },
    txns,
  };
}
