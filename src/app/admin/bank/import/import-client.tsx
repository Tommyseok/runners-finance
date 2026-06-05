"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { BankAccount } from "@/lib/db-types";

interface ImportSummary {
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

export function ImportClient({ accounts }: { accounts: BankAccount[] }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function upload() {
    setError(null);
    setSummary(null);
    if (!bankAccountId) {
      setError("계좌를 선택하세요.");
      return;
    }
    if (!file) {
      setError("통장 파일(.xls)을 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bankAccountId", bankAccountId);
      const res = await fetch("/api/bank/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "업로드에 실패했습니다.");
      } else {
        setSummary(json.summary as ImportSummary);
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
            <Label>계좌 선택</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="통장을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.bank_name} · {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bank-file">통장 거래내역 파일 (.xls)</Label>
            <input
              id="bank-file"
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">
              KB은행 인터넷뱅킹에서 월별 거래내역을 엑셀(.xls)로 받아 그대로
              올리세요. 같은 내역을 다시 올려도 중복으로 쌓이지 않습니다.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={upload} disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 처리 중…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> 업로드 + 자동 대사
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 className="h-5 w-5" /> 업로드 완료
            </div>
            <Row label="총 거래" value={`${summary.rowCount}건`} />
            <Row
              label="신규 저장"
              value={`${summary.inserted}건 (중복 ${summary.duplicates}건 제외)`}
            />
            <Row label="입금 합계" value={formatCurrency(summary.depositTotal)} />
            <Row label="출금 합계" value={formatCurrency(summary.withdrawTotal)} />
            <Row
              label="현재 잔액"
              value={
                summary.closingBalance === null
                  ? "-"
                  : formatCurrency(summary.closingBalance)
              }
            />
            <Row
              label="영수증 자동매칭"
              value={`매칭 ${summary.matched} / 미매칭 ${summary.unmatched}`}
            />
            <Row label="수입 자동등록" value={`${summary.incomeCreated}건`} />
          </CardContent>
        </Card>
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
