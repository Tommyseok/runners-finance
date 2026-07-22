"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Income } from "@/lib/db-types";

type Tab = "수련회비" | "QT도서비";

/** memo에서 납부자 이름 추정 (학년표기·항목단어 제거) */
function payerName(memo: string | null): string {
  if (!memo) return "(이름 없음)";
  return (
    memo
      .replace(/수련회비|수련회|회비|큐티책|큐티|QT|도서|고등부|고등/gi, "")
      .replace(/[0-9]학년|고[1-3]|[1-3]학년|[_\s·()]/g, "")
      .replace(/^[0-9]+|[0-9]+$/g, "")
      .trim() || memo
  );
}

export function PayersClient({ initial }: { initial: Income[] }) {
  const [tab, setTab] = useState<Tab>("수련회비");
  const [downloading, setDownloading] = useState(false);

  const items = useMemo(
    () => initial.filter((i) => i.category === tab),
    [initial, tab],
  );
  const total = items.reduce((s, i) => s + i.amount, 0);

  async function downloadExcel() {
    setDownloading(true);
    try {
      const res = await fetch("/api/download/income-payers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: tab }),
      });
      if (!res.ok) {
        alert("다운로드 실패");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tab}_납부자.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["수련회비", "QT도서비"] as Tab[]).map((t) => (
          <Button
            key={t}
            variant={tab === t ? "default" : "outline"}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      <Card className="bg-emerald-600 text-white">
        <CardContent className="p-4">
          <div className="text-xs opacity-80">{tab} 납부</div>
          <div className="mt-1 text-xl font-bold">
            {items.length}명 · {formatCurrency(total)}
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full"
        onClick={downloadExcel}
        disabled={downloading || items.length === 0}
      >
        <Download className="h-4 w-4" />
        {downloading ? "생성 중…" : "엑셀 다운로드"}
      </Button>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {tab} 납부 내역이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {items.map((inc, i) => (
                <li
                  key={inc.id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="mr-2 text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="font-medium">{payerName(inc.memo)}</span>
                    <div className="ml-6 text-xs text-muted-foreground">
                      {formatDate(inc.income_date)} · {inc.memo}
                    </div>
                  </div>
                  <span className="shrink-0 font-semibold text-emerald-700">
                    {formatCurrency(inc.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
