"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PaymentCard } from "./payment-card";
import type { BankAccount, Receipt } from "@/lib/db-types";

export interface PaymentItem {
  receipt: Receipt;
  userName: string;
  categoryName: string | null;
  imageUrls: string[];
}

export function PaymentsListClient({
  items,
  banks,
}: {
  items: PaymentItem[];
  banks: BankAccount[];
}) {
  const [revealAll, setRevealAll] = useState(false);

  return (
    <>
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

      {items.map((it) => (
        <PaymentCard
          key={it.receipt.id}
          receipt={it.receipt}
          userName={it.userName}
          categoryName={it.categoryName}
          imageUrls={it.imageUrls}
          banks={banks}
          forceReveal={revealAll}
        />
      ))}
    </>
  );
}
