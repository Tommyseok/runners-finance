"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReconcileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bank/reconcile", { method: "POST" });
      const json = await res.json();
      if (!res.ok) setMsg(json.error ?? "재대사 실패");
      else {
        setMsg(`매칭 ${json.matched} / 미매칭 ${json.unmatched} · 수입 ${json.incomeCreated}건`);
        router.refresh();
      }
    } catch {
      setMsg("네트워크 오류");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={run} disabled={busy} variant="outline" className="w-full">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> 재대사 중…
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" /> 영수증 재대사
          </>
        )}
      </Button>
      {msg && <p className="text-center text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
