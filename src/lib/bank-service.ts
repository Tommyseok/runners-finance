import { createAdminClient } from "@/lib/supabase/server";
import type {
  BankTransaction,
  BankTxnKind,
  IncomeCategory,
  Receipt,
} from "@/lib/db-types";
import { parseBankXls, type ParsedBankFile } from "@/lib/bank-parser";
import {
  reconcileBank,
  isWash,
  isTransfer,
  type ReconReceipt,
  type ReconTxn,
} from "@/lib/reconcile";

type Admin = ReturnType<typeof createAdminClient>;

export interface ImportSummary {
  batchId: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  withdrawTotal: number;
  depositTotal: number;
  closingBalance: number | null;
  matched: number;
  unmatched: number;
  incomeCreated: number;
}

/** 입금行의 수입 항목 추정 */
export function guessIncomeCategory(counterparty: string, memo: string): IncomeCategory {
  const s = `${counterparty} ${memo}`;
  if (/(헌금|십일조|감사|주일|선교|작정)/.test(s)) return "헌금";
  if (/(회비|수련회비|참가비)/.test(s)) return "회비";
  if (/전도금/.test(s)) return "전도금";
  if (/(지원|보조|지정)/.test(s)) return "지원금";
  if (/(이자|환급|잡수입)/.test(s)) return "잡수입";
  return "기타";
}

function classifyKind(t: {
  withdraw: number;
  deposit: number;
  counterparty: string;
  memo: string;
}): BankTxnKind {
  if (isWash(t)) return "wash";
  if (isTransfer(t)) return "transfer";
  if (t.deposit > 0) return "income";
  if (t.withdraw > 0) return "expense";
  return "unknown";
}

/** .xls 버퍼 → 파싱 → 저장(멱등) → 자동대사 → 수입 자동추출 */
export async function importBankFile(params: {
  orgId: string;
  bankAccountId: string;
  fileName: string;
  buffer: Buffer;
  importedBy: string;
}): Promise<ImportSummary> {
  const { orgId, bankAccountId, fileName, buffer, importedBy } = params;
  const admin = createAdminClient();
  const parsed: ParsedBankFile = parseBankXls(buffer);

  const withdrawTotal = parsed.txns.reduce((s, t) => s + t.withdraw, 0);
  const depositTotal = parsed.txns.reduce((s, t) => s + t.deposit, 0);
  const closingBalance = parsed.meta.totalBalance ?? parsed.txns[0]?.balance ?? null;
  const period = parsed.meta.queryFrom ? parsed.meta.queryFrom.slice(0, 7) : null;

  // 1. import batch
  const { data: batch, error: batchErr } = await admin
    .from("bank_import_batch")
    .insert({
      org_id: orgId,
      bank_account_id: bankAccountId,
      period,
      file_name: fileName,
      query_from: parsed.meta.queryFrom,
      query_to: parsed.meta.queryTo,
      closing_balance: closingBalance,
      withdraw_total: withdrawTotal,
      deposit_total: depositTotal,
      row_count: parsed.txns.length,
      imported_by: importedBy,
    })
    .select("id")
    .single();
  if (batchErr || !batch) throw new Error(`배치 생성 실패: ${batchErr?.message}`);

  // 2. upsert transactions (멱등: dedupe_key 중복 무시)
  const rows = parsed.txns.map((t) => ({
    org_id: orgId,
    bank_account_id: bankAccountId,
    import_batch_id: batch.id,
    txn_no: t.no,
    txn_at: t.txnAt,
    counterparty: t.counterparty || null,
    withdraw: t.withdraw,
    deposit: t.deposit,
    balance: t.balance,
    memo: t.memo || null,
    method: t.method || null,
    branch: t.branch || null,
    kind: classifyKind(t),
    dedupe_key: t.dedupeKey,
  }));

  const { data: upserted, error: upErr } = await admin
    .from("bank_transaction")
    .upsert(rows, {
      onConflict: "bank_account_id,dedupe_key",
      ignoreDuplicates: true,
    })
    .select("id");
  if (upErr) throw new Error(`거래 저장 실패: ${upErr.message}`);
  const inserted = upserted?.length ?? 0;

  // 3. 자동대사 + 4. 수입추출 (org 전체 기준 재실행)
  const { matched, unmatched } = await reconcileOrg(admin, orgId);
  const incomeCreated = await deriveIncome(admin, orgId);

  return {
    batchId: batch.id,
    rowCount: parsed.txns.length,
    inserted,
    duplicates: parsed.txns.length - inserted,
    withdrawTotal,
    depositTotal,
    closingBalance,
    matched,
    unmatched,
    incomeCreated,
  };
}

/** org 전체 은행거래 ↔ 영수증 자동대사. locked=true 행은 보존. */
export async function reconcileOrg(
  admin: Admin,
  orgId: string,
): Promise<{ matched: number; unmatched: number }> {
  const [{ data: txnsRaw }, { data: receiptsRaw }] = await Promise.all([
    admin
      .from("bank_transaction")
      .select("*")
      .eq("org_id", orgId)
      .order("txn_at", { ascending: true }),
    admin
      .from("receipt")
      .select("id, expense_date, total_amount, user_id")
      .eq("org_id", orgId),
  ]);
  const txns = (txnsRaw ?? []) as BankTransaction[];
  const receiptRows = (receiptsRaw ?? []) as Pick<
    Receipt,
    "id" | "expense_date" | "total_amount" | "user_id"
  >[];

  // user_id → name
  const userIds = Array.from(new Set(receiptRows.map((r) => r.user_id)));
  const { data: profs } = userIds.length
    ? await admin.from("profile").select("id, name").in("id", userIds)
    : { data: [] as { id: string; name: string | null }[] };
  const nameById = new Map((profs ?? []).map((p) => [p.id, p.name]));

  const receipts: ReconReceipt[] = receiptRows.map((r) => ({
    id: r.id,
    expenseDate: r.expense_date,
    amount: r.total_amount,
    userName: nameById.get(r.user_id) ?? null,
  }));

  const reconTxns: ReconTxn[] = txns.map((t, i) => ({
    index: i,
    date: (t.txn_at ?? "").slice(0, 10),
    withdraw: t.withdraw,
    deposit: t.deposit,
    counterparty: t.counterparty ?? "",
    memo: t.memo ?? "",
    method: t.method ?? "",
  }));

  const results = reconcileBank(reconTxns, receipts);

  let matched = 0;
  let unmatched = 0;
  const updates: Array<Promise<unknown>> = [];
  for (const res of results) {
    const txn = txns[res.index];
    if (txn.locked) continue; // 수동수정 보존
    const primary = res.matchedReceiptIds[0] ?? null;
    if (res.kind === "expense") {
      if (res.matchStatus === "matched") matched++;
      else unmatched++;
    }
    // 변경 있을 때만 update
    if (
      txn.kind !== res.kind ||
      txn.match_status !== res.matchStatus ||
      txn.matched_receipt_id !== primary
    ) {
      updates.push(
        (async () => {
          await admin
            .from("bank_transaction")
            .update({
              kind: res.kind,
              match_status: res.matchStatus,
              matched_receipt_id: primary,
            })
            .eq("id", txn.id);
        })(),
      );
    }
  }
  await Promise.all(updates);
  return { matched, unmatched };
}

/** 입금行(kind=income) → income 자동생성. bank_transaction_id로 멱등. */
export async function deriveIncome(admin: Admin, orgId: string): Promise<number> {
  const { data: txnsRaw } = await admin
    .from("bank_transaction")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "income")
    .gt("deposit", 0);
  const txns = (txnsRaw ?? []) as BankTransaction[];
  if (!txns.length) return 0;

  // 이미 income 연결된 bank_transaction_id 제외
  const { data: existing } = await admin
    .from("income")
    .select("bank_transaction_id")
    .eq("org_id", orgId)
    .not("bank_transaction_id", "is", null);
  const linked = new Set(
    (existing ?? []).map((e: { bank_transaction_id: string | null }) => e.bank_transaction_id),
  );

  const toInsert = txns
    .filter((t) => !linked.has(t.id))
    .map((t) => ({
      org_id: orgId,
      income_date: (t.txn_at ?? "").slice(0, 10),
      amount: t.deposit,
      category: guessIncomeCategory(t.counterparty ?? "", t.memo ?? ""),
      source: "bank" as const,
      deposit_to_bank_id: t.bank_account_id,
      bank_transaction_id: t.id,
      memo: t.counterparty ?? null,
    }));
  if (!toInsert.length) return 0;

  const { error } = await admin.from("income").insert(toInsert);
  if (error) throw new Error(`수입 생성 실패: ${error.message}`);

  // bank_transaction.matched_income_id 역연결
  await Promise.all(
    toInsert.map((inc) =>
      admin
        .from("bank_transaction")
        .update({ match_status: "matched" })
        .eq("id", inc.bank_transaction_id),
    ),
  );
  return toInsert.length;
}
