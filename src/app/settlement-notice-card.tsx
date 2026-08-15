import Link from "next/link";
import { ChevronRight, Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export interface SettlementNotice {
  periodLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  incomeTotal: number;
  expenseTotal: number;
  publishedAt: string;
  expenseRows: Array<{ category: string; amount: number }>;
}

/** 관리자가 게시한 결산 요약 — 멤버 홈 최상단 공지 카드. */
export function SettlementNoticeCard({ notice }: { notice: SettlementNotice }) {
  const net = notice.incomeTotal - notice.expenseTotal;
  const detailHref =
    notice.dateFrom || notice.dateTo
      ? `/settlement?from=${notice.dateFrom ?? ""}&to=${notice.dateTo ?? ""}&label=${encodeURIComponent(notice.periodLabel)}`
      : "/settlement";
  const top = notice.expenseRows.slice(0, 4);

  return (
    <Link href={detailHref}>
      <Card className="border-primary/30 bg-primary/5 transition-transform active:scale-[0.99]">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Megaphone className="h-4 w-4" />
              결산 게시 · {notice.periodLabel}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {notice.publishedAt.slice(0, 10)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] text-muted-foreground">수입</div>
              <div className="text-sm font-bold text-emerald-700">
                {formatCurrency(notice.incomeTotal)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">지출</div>
              <div className="text-sm font-bold text-rose-700">
                {formatCurrency(notice.expenseTotal)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">잔액</div>
              <div
                className={`text-sm font-bold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}
              >
                {formatCurrency(net)}
              </div>
            </div>
          </div>

          {top.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-2">
              {top.map((row) => (
                <div
                  key={row.category}
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span className="truncate">{row.category}</span>
                  <span className="shrink-0 font-medium">{formatCurrency(row.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end text-xs text-primary">
            결산 자세히 보기 <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
