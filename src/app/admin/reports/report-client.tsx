"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BudgetCategory } from "@/lib/db-types";

type Status = "all" | "paid" | "pending";

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

export function ReportClient({ categories }: { categories: BudgetCategory[] }) {
  const presets = buildPresets();
  const [presetId, setPresetId] = useState<string>("thisMonth");
  const [customFrom, setCustomFrom] = useState(fmt(new Date()));
  const [customTo, setCustomTo] = useState(fmt(new Date()));
  const [status, setStatus] = useState<Status>("all");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resolveRange(): { from: string; to: string; label: string } {
    if (presetId === "custom") {
      return { from: customFrom, to: customTo, label: `${customFrom} ~ ${customTo}` };
    }
    const p = presets.find((x) => x.id === presetId);
    return p ? p.range() : presets[0].range();
  }

  async function download() {
    setError(null);
    setBusy(true);
    try {
      const { from, to, label } = resolveRange();
      const res = await fetch("/api/download/expense-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, status, category, month: "all", periodLabel: label }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "PDF 생성에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `지출영수증증빙-${label}.pdf`;
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

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label>기간 선택</Label>
            <div className="grid grid-cols-3 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={`rounded-md border px-2 py-2 text-xs ${
                    presetId === p.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPresetId("custom")}
                className={`rounded-md border px-2 py-2 text-xs ${
                  presetId === "custom"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background"
                }`}
              >
                직접 지정
              </button>
            </div>
          </div>

          {presetId === "custom" && (
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
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">지급 상태</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="paid">지급완료</SelectItem>
                  <SelectItem value="pending">미지급</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">계정항목</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={download} disabled={busy} className="w-full">
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> PDF 생성 중… (영수증 많으면 시간이 걸려요)</>
            ) : (
              <><FileDown className="h-4 w-4" /> PDF 다운로드</>
            )}
          </Button>
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        선택한 기간의 지출 내역이 표(순번·지출인·지출일자·청구일자·금액·계정항목·거래처)와
        영수증 이미지로 PDF에 담깁니다. 교회 제출용으로 그대로 인쇄·제출하세요.
      </p>
    </div>
  );
}
