"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PaymentCard } from "./payment-card";
import type { BankAccount, Receipt } from "@/lib/db-types";

export interface PaymentItem {
  receipt: Receipt;
  userName: string;
  categoryName: string | null;
  imageUrls: string[];
  paidFromBankLabel: string | null;
}

type StatusFilter = "pending" | "paid" | "all";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "대기중" },
  { value: "paid", label: "송금완료" },
  { value: "all", label: "전체" },
];

function hrefForStatus(status: StatusFilter): string {
  if (status === "pending") return "/admin/payments";
  return `/admin/payments?status=${status}`;
}

export function PaymentsListClient({
  items,
  banks,
  status,
  showStatusBadge,
  emptyText,
}: {
  items: PaymentItem[];
  banks: BankAccount[];
  status: StatusFilter;
  showStatusBadge: boolean;
  emptyText: string;
}) {
  const [revealAll, setRevealAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <div className="flex gap-2 rounded-lg border bg-background p-1">
        {FILTERS.map((f) => {
          const active = f.value === status;
          return (
            <Link
              key={f.value}
              href={hrefForStatus(f.value)}
              prefetch={false}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {toast && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}

      {status !== "paid" && (
        <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3">
          <label
            htmlFor="reveal-all"
            className="flex flex-1 cursor-pointer items-center gap-2"
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">모든 계좌번호 표시</span>
            <span className="text-xs text-muted-foreground">
              (송금 처리 시 편의성)
            </span>
          </label>
          <Switch
            id="reveal-all"
            checked={revealAll}
            onCheckedChange={setRevealAll}
          />
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </CardContent>
        </Card>
      ) : (
        items.map((it) => (
          <PaymentCard
            key={it.receipt.id}
            receipt={it.receipt}
            userName={it.userName}
            categoryName={it.categoryName}
            imageUrls={it.imageUrls}
            banks={banks}
            forceReveal={revealAll}
            paidFromBankLabel={it.paidFromBankLabel}
            showStatusBadge={showStatusBadge}
            onPaid={() => setToast("송금 완료로 처리되었습니다")}
          />
        ))
      )}
    </>
  );
}
