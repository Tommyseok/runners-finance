"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileArchive, FileDown, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Preset {
  id: string;
  label: string;
  range: () => { from: string; to: string; label: string };
}

function buildPresets(): Preset[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthRange = (yy: number, mm: number) => ({
    from: fmt(new Date(yy, mm, 1)),
    to: fmt(new Date(yy, mm + 1, 0)),
    label: `${yy}년 ${mm + 1}월`,
  });
  const quarterRange = (q: number) => ({
    from: fmt(new Date(y, (q - 1) * 3, 1)),
    to: fmt(new Date(y, q * 3, 0)),
    label: `${y}년 ${q}분기`,
  });
  return [
    { id: "all", label: "전체기간", range: () => ({ from: "", to: "", label: "전체기간" }) },
    { id: "thisMonth", label: "이번 달", range: () => monthRange(y, m) },
    { id: "lastMonth", label: "지난 달", range: () => monthRange(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1) },
    { id: "q1", label: "1분기", range: () => quarterRange(1) },
    { id: "q2", label: "2분기", range: () => quarterRange(2) },
    { id: "q3", label: "3분기", range: () => quarterRange(3) },
    { id: "q4", label: "4분기", range: () => quarterRange(4) },
    {
      id: "thisYear",
      label: "올해 전체",
      range: () => ({ from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년 전체` }),
    },
  ];
}

export function SettlementClient({
  from,
  to,
  periodLabel,
  presetId,
  isAdmin,
  publication,
}: {
  from?: string;
  to?: string;
  periodLabel: string;
  presetId: string;
  isAdmin: boolean;
  publication: { periodLabel: string; publishedAt: string } | null;
}) {
  const router = useRouter();
  const presets = buildPresets();
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const [customOpen, setCustomOpen] = useState(presetId === "custom");
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [dimodeBusy, setDimodeBusy] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setCustomOpen(false);
    const { from: f, to: t, label } = p.range();
    if (!f && !t) {
      router.push("/settlement");
      return;
    }
    router.push(
      `/settlement?from=${f}&to=${t}&preset=${p.id}&label=${encodeURIComponent(label)}`,
    );
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    router.push(
      `/settlement?from=${customFrom}&to=${customTo}&preset=custom&label=${encodeURIComponent(`${customFrom} ~ ${customTo}`)}`,
    );
  }

  async function publish(action: "publish" | "unpublish") {
    if (
      action === "publish" &&
      !window.confirm(
        `"${periodLabel}" 결산을 교사(일반 회원)에게 게시할까요?\n게시하면 회원 초기화면에 결산 요약 공지가 표시됩니다.`,
      )
    ) {
      return;
    }
    setError(null);
    setPubBusy(true);
    try {
      const res = await fetch("/api/settlement/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, periodLabel, action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "게시 처리에 실패했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setPubBusy(false);
    }
  }

  async function download() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/download/settlement-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: "all", from, to, periodLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "결산 엑셀 생성에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `결산-${periodLabel}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdfZip() {
    setError(null);
    setZipBusy(true);
    try {
      const res = await fetch("/api/download/settlement-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, periodLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "증빙 PDF 생성에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `지출증빙일괄-${periodLabel}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setZipBusy(false);
    }
  }

  async function downloadDimodePackage() {
    setError(null);
    setDimodeBusy(true);
    try {
      const res = await fetch("/api/download/dimode-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, periodLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "디모데 제출 패키지 생성에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `디모데제출-${periodLabel}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setDimodeBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-2">
          <Label>기간 선택</Label>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-md border px-2 py-2 text-xs ${
                  !customOpen && presetId === p.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className={`rounded-md border px-2 py-2 text-xs ${
                customOpen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background"
              }`}
            >
              직접 지정
            </button>
          </div>
        </div>

        {customOpen && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="from" className="text-xs">시작일</Label>
                <Input id="from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to" className="text-xs">종료일</Label>
                <Input id="to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </div>
            <Button variant="secondary" size="sm" className="w-full" onClick={applyCustom}>
              적용
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {isAdmin && (
          <div className="space-y-2">
            <Button onClick={download} disabled={busy || zipBusy || dimodeBusy} className="w-full">
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> 결산 엑셀 생성 중…</>
              ) : (
                <><FileDown className="h-4 w-4" /> 결산 엑셀 다운로드 ({periodLabel})</>
              )}
            </Button>
            <Button
              onClick={downloadPdfZip}
              disabled={busy || zipBusy || dimodeBusy}
              variant="secondary"
              className="w-full"
            >
              {zipBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> 항목별 PDF 생성 중… (1~2분)</>
              ) : (
                <><FileArchive className="h-4 w-4" /> 증빙 PDF 일괄 다운로드 (ZIP)</>
              )}
            </Button>
            <Button
              onClick={downloadDimodePackage}
              disabled={busy || zipBusy || dimodeBusy}
              variant="secondary"
              className="w-full"
            >
              {dimodeBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> 디모데 제출 패키지 생성 중… (1~2분)</>
              ) : (
                <><FileArchive className="h-4 w-4" /> 디모데 제출 패키지 (세목별 명세+증빙 ZIP)</>
              )}
            </Button>
            <Button
              onClick={() => publish("publish")}
              disabled={pubBusy}
              variant="outline"
              className="w-full"
            >
              {pubBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> 게시 처리 중…</>
              ) : (
                <><Megaphone className="h-4 w-4" /> 결산완료 후 교사대상 게시 ({periodLabel})</>
              )}
            </Button>
            {publication && (
              <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <span>
                  게시됨: {publication.periodLabel} ·{" "}
                  {publication.publishedAt.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => publish("unpublish")}
                  disabled={pubBusy}
                  className="font-medium underline"
                >
                  게시 취소
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
