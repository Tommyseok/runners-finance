"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  maskAccount,
} from "@/lib/utils";
import type { BankAccount, Receipt } from "@/lib/db-types";

interface Props {
  receipt: Receipt;
  userName: string;
  categoryName: string | null;
  imageUrls: string[];
  banks: BankAccount[];
  forceReveal?: boolean;
  paidFromBankLabel?: string | null;
  showStatusBadge?: boolean;
  onPaid?: () => void;
}

export function PaymentCard({
  receipt,
  userName,
  categoryName,
  imageUrls,
  banks,
  forceReveal = false,
  paidFromBankLabel = null,
  showStatusBadge = false,
  onPaid,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaid = receipt.status === "paid";

  async function copyAccount() {
    if (!receipt.refund_account) return;
    try {
      await navigator.clipboard.writeText(
        receipt.refund_account.replace(/\s/g, ""),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function markPaid() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      const { error: updErr } = await supabase
        .from("receipt")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          paid_by: user.id,
          paid_from_bank_id: bankId || null,
        })
        .eq("id", receipt.id);
      if (updErr) throw updErr;

      onPaid?.();
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "처리 실패";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <Card>
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="truncate">
                {userName} · {receipt.merchant ?? "-"}
              </span>
              {showStatusBadge && (
                <Badge
                  variant={isPaid ? "success" : "warning"}
                  className="shrink-0"
                >
                  {isPaid ? "송금완료" : "대기중"}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatDate(receipt.expense_date)}</span>
              {categoryName && (
                <>
                  <span>·</span>
                  <span>{categoryName}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">
              {formatCurrency(receipt.total_amount)}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </CardContent>
      </button>

      {open && (
        <div className="border-t p-4 pt-3 space-y-3">
          {imageUrls.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {imageUrls.map((url, idx) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={idx}
                  src={url}
                  alt=""
                  className="h-24 w-24 shrink-0 rounded-md border object-cover"
                />
              ))}
            </div>
          )}

          {receipt.description && (
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              {receipt.description}
            </div>
          )}

          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">환급 계좌</div>
            <div className="mt-1 text-sm">
              {receipt.refund_bank_name ?? "-"} ·{" "}
              {receipt.refund_holder ?? "-"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 text-sm font-mono">
                {forceReveal || showAccount || isPaid
                  ? (receipt.refund_account ?? "-")
                  : maskAccount(receipt.refund_account)}
              </code>
              {!forceReveal && !isPaid && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setShowAccount((s) => !s)}
                >
                  {showAccount ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={copyAccount}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {isPaid ? (
            <div className="rounded-md border bg-green-50/50 p-3 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">입금일</span>
                <span className="font-medium">
                  {formatDateTime(receipt.paid_at)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">출금 통장</span>
                <span className="font-medium">
                  {paidFromBankLabel ?? "-"}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">출금 통장</div>
                {banks.length === 0 ? (
                  <p className="text-xs text-destructive">
                    활성 통장이 없습니다. 통장 관리에서 추가해주세요.
                  </p>
                ) : (
                  <Select value={bankId} onValueChange={setBankId}>
                    <SelectTrigger>
                      <SelectValue placeholder="통장 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.bank_name} · {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                className="w-full"
                disabled={loading || banks.length === 0 || !bankId}
                onClick={markPaid}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                입금 완료로 표시
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
