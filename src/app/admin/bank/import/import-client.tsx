"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import type { BankAccount } from "@/lib/db-types";

interface ImportSummary {
  accountLabel: string;
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

interface FileResult {
  fileName: string;
  summary?: ImportSummary;
  error?: string;
}

export function ImportClient({ accounts }: { accounts: BankAccount[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[] | null>(null);

  async function upload() {
    setError(null);
    setResults(null);
    if (files.length === 0) {
      setError("통장 파일(.xls)을 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/bank/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "업로드에 실패했습니다.");
      } else {
        setResults(json.results as FileResult[]);
        router.refresh();
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="bank-file">통장 거래내역 파일 (.xls) — 여러 개 선택 가능</Label>
            <input
              id="bank-file"
              type="file"
              multiple
              accept=".xls,.xlsx,application/vnd.ms-excel"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">
              017·033 파일을 한 번에 올리세요. <b>계좌는 파일 속 계좌번호로 자동
              인식</b>되어 잘못된 통장에 들어갈 걱정이 없습니다. 같은 내역을 다시
              올려도 중복으로 쌓이지 않습니다.
            </p>
            <p className="text-xs text-muted-foreground">
              등록 계좌: {accounts.map((a) => a.label).join(" · ")}
            </p>
          </div>

          {files.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {files.map((f) => (
                <li key={f.name}>📄 {f.name}</li>
              ))}
            </ul>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={upload} disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 처리 중…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> 업로드 + 자동 대사
                {files.length > 1 ? ` (${files.length}개 파일)` : ""}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results?.map((r) =>
        r.summary ? (
          <Card key={r.fileName} className="border-emerald-200 bg-emerald-50">
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-emerald-800">
                <CheckCircle2 className="h-5 w-5" /> {r.summary.accountLabel} 업로드 완료
              </div>
              <p className="break-all text-xs text-muted-foreground">{r.fileName}</p>
              <Row label="총 거래" value={`${r.summary.rowCount}건`} />
              <Row
                label="신규 저장"
                value={`${r.summary.inserted}건 (중복 ${r.summary.duplicates}건 제외)`}
              />
              <Row label="입금 합계" value={formatCurrency(r.summary.depositTotal)} />
              <Row label="출금 합계" value={formatCurrency(r.summary.withdrawTotal)} />
              <Row
                label="현재 잔액"
                value={
                  r.summary.closingBalance === null
                    ? "-"
                    : formatCurrency(r.summary.closingBalance)
                }
              />
              <Row
                label="영수증 자동매칭"
                value={`매칭 ${r.summary.matched} / 미매칭 ${r.summary.unmatched}`}
              />
              <Row label="수입 자동등록" value={`${r.summary.incomeCreated}건`} />
            </CardContent>
          </Card>
        ) : (
          <Card key={r.fileName} className="border-red-200 bg-red-50">
            <CardContent className="space-y-1 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-red-800">
                <XCircle className="h-5 w-5" /> 업로드 실패
              </div>
              <p className="break-all text-xs text-muted-foreground">{r.fileName}</p>
              <p className="text-red-700">{r.error}</p>
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
