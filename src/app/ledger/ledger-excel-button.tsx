"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LedgerExcelButton({ month }: { month: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/download/ledger-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "엑셀 생성에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `입출금원장-${month === "all" ? "전체" : month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={download} disabled={busy} variant="outline" className="w-full">
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> 엑셀 생성 중…
        </>
      ) : (
        <>
          <FileSpreadsheet className="h-4 w-4" /> 입출금 원장 엑셀 다운로드
        </>
      )}
    </Button>
  );
}
