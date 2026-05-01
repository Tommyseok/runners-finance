"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BudgetCategory } from "@/lib/db-types";

type Mode = "zip" | "pdf";
type StatusFilter = "all" | "paid" | "pending";

interface MonthOption {
  value: string;
  label: string;
}

interface Props {
  isDev: boolean;
  categories: BudgetCategory[];
  months: MonthOption[];
}

export function DownloadCards({ isDev, categories, months }: Props) {
  const [open, setOpen] = useState<Mode | null>(null);
  const [month, setMonth] = useState<string>(months[0]?.value ?? "all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!isDev) {
    return (
      <Card className="opacity-80">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <div className="text-sm font-semibold">영수증 다운로드</div>
            <p className="text-xs text-muted-foreground">
              이 기능은 로컬 개발 환경에서만 사용 가능합니다.
              <br />
              회계 담당자가 본인 컴퓨터에서 다운로드 후 사용하세요.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  function openModal(mode: Mode) {
    setOpen(mode);
    setError(null);
    setDone(null);
  }

  async function handleDownload() {
    if (!open) return;
    setError(null);
    setDone(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/download/${open}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, status, category }),
      });
      if (!res.ok) {
        let msg = `다운로드 실패 (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const fname =
        parseFilename(cd) ??
        (open === "zip" ? "receipts.zip" : "report.pdf");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone("다운로드 완료");
      setTimeout(() => {
        setOpen(null);
        setDone(null);
      }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "다운로드 실패";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => openModal("zip")}
          className="text-left"
        >
          <Card className="h-full transition-colors hover:bg-accent/40">
            <CardContent className="flex h-full flex-col items-start gap-2 p-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div className="text-sm font-medium">📦 ZIP 다운로드</div>
              <div className="text-xs text-muted-foreground">
                Excel + 사진
              </div>
            </CardContent>
          </Card>
        </button>
        <button
          type="button"
          onClick={() => openModal("pdf")}
          className="text-left"
        >
          <Card className="h-full transition-colors hover:bg-accent/40">
            <CardContent className="flex h-full flex-col items-start gap-2 p-4">
              <FileText className="h-5 w-5 text-primary" />
              <div className="text-sm font-medium">📄 PDF 보고서</div>
              <div className="text-xs text-muted-foreground">
                표지 + 영수증별 페이지
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      <Dialog
        open={!!open}
        onOpenChange={(v) => {
          if (!v && !loading) setOpen(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === "zip" ? "ZIP 다운로드" : "PDF 보고서"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>기간</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>입금 상태</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: "all", label: "전체" },
                    { v: "paid", label: "송금완료" },
                    { v: "pending", label: "대기중" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => setStatus(s.v)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      status === s.v
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-input hover:bg-accent",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>카테고리</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading && (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                잠시 기다려주세요... 영수증을 처리하고 있습니다 (10~60초 소요).
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            {done && (
              <p className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {done}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(null)}
              disabled={loading}
            >
              취소
            </Button>
            <Button onClick={handleDownload} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {loading ? "준비 중..." : "다운로드"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function parseFilename(cd: string): string | null {
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through
    }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) return plain[1];
  return null;
}
