"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { BankAccount, Income, IncomeCategory } from "@/lib/db-types";

const CATEGORIES: IncomeCategory[] = [
  "헌금",
  "회비",
  "전도금",
  "지원금",
  "잡수입",
  "기타",
];

export function IncomeClient({
  orgId,
  initial,
  accounts,
}: {
  orgId: string;
  initial: Income[];
  accounts: BankAccount[];
}) {
  const [items, setItems] = useState<Income[]>(initial);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<IncomeCategory>("헌금");
  const [bankId, setBankId] = useState(accounts[0]?.id ?? "");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase
      .from("income")
      .select("*")
      .eq("org_id", orgId)
      .order("income_date", { ascending: false })
      .limit(200);
    setItems((data ?? []) as Income[]);
  }

  async function updateCategory(inc: Income, cat: IncomeCategory) {
    const supabase = createClient();
    await supabase.from("income").update({ category: cat }).eq("id", inc.id);
    setItems((prev) =>
      prev.map((i) => (i.id === inc.id ? { ...i, category: cat } : i)),
    );
  }

  async function addManual() {
    const amt = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("금액을 정확히 입력하세요.");
      return;
    }
    const supabase = createClient();

    // 중복 방지: 같은 금액의 입금이 통장(±5일)에 이미 있으면 경고.
    // 통장 입금은 업로드 시 자동으로 수입에 잡히므로 수동으로 또 넣으면 중복.
    const from = new Date(date);
    from.setDate(from.getDate() - 5);
    const to = new Date(date);
    to.setDate(to.getDate() + 5);
    const { data: dup } = await supabase
      .from("bank_transaction")
      .select("txn_at, counterparty")
      .eq("org_id", orgId)
      .eq("deposit", amt)
      .gte("txn_at", from.toISOString())
      .lte("txn_at", to.toISOString())
      .limit(1);
    if (dup && dup.length > 0) {
      const d = String(dup[0].txn_at).slice(0, 10);
      const ok = confirm(
        `같은 금액(${formatCurrency(amt)})의 입금이 통장에 이미 있습니다.\n` +
          `(${d} ${dup[0].counterparty ?? ""})\n\n` +
          `통장 입금은 업로드 시 수입에 자동 등록됩니다. 그래도 중복으로 추가할까요?`,
      );
      if (!ok) return;
    }

    const { error: err } = await supabase.from("income").insert({
      org_id: orgId,
      income_date: date,
      amount: amt,
      category,
      source: "manual",
      deposit_to_bank_id: bankId || null,
      memo: memo.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setOpen(false);
    setAmount("");
    setMemo("");
    await refresh();
  }

  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-3">
      <Card className="bg-emerald-600 text-white">
        <CardContent className="p-4">
          <div className="text-xs opacity-80">수입 합계 ({items.length}건)</div>
          <div className="mt-1 text-xl font-bold">{formatCurrency(total)}</div>
        </CardContent>
      </Card>

      <Button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        variant="outline"
        className="w-full"
      >
        <Plus className="h-4 w-4" /> 수입 직접 추가
      </Button>
      <p className="px-1 text-xs text-muted-foreground">
        통장에 찍힌 입금은 업로드 시 자동 등록됩니다(중복 추가 금지). 직접 추가는
        통장에 없는 수입(예: 미입금 현금 헌금)에만 사용하세요.
      </p>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            수입 내역이 없습니다. 통장을 업로드하면 입금내역이 자동 등록됩니다.
          </CardContent>
        </Card>
      ) : (
        items.map((inc) => (
          <Card key={inc.id}>
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {inc.memo ?? "(입금)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(inc.income_date)} ·{" "}
                  {inc.source === "bank" ? "통장자동" : "수동"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={inc.category}
                  onValueChange={(v) => updateCategory(inc, v as IncomeCategory)}
                >
                  <SelectTrigger className="h-8 w-[90px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm font-semibold text-emerald-700">
                  {formatCurrency(inc.amount)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>수입 직접 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="inc-date">날짜</Label>
              <Input
                id="inc-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inc-amount">금액</Label>
              <Input
                id="inc-amount"
                inputMode="numeric"
                placeholder="50000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>항목</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as IncomeCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {accounts.length > 0 && (
              <div className="space-y-2">
                <Label>입금 통장</Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="inc-memo">메모</Label>
              <Input
                id="inc-memo"
                placeholder="예: 5월 주일헌금"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={addManual}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
