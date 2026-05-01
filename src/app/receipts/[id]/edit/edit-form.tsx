"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { BudgetCategory, Receipt, ReceiptItem } from "@/lib/db-types";

export function EditReceiptForm({
  receipt,
  categories,
}: {
  receipt: Receipt;
  categories: BudgetCategory[];
}) {
  const router = useRouter();

  const [merchant, setMerchant] = useState(receipt.merchant ?? "");
  const [expenseDate, setExpenseDate] = useState(receipt.expense_date ?? "");
  const [totalAmount, setTotalAmount] = useState(String(receipt.total_amount));
  const [description, setDescription] = useState(receipt.description ?? "");
  const [items, setItems] = useState<ReceiptItem[]>(receipt.items ?? []);
  const [categoryId, setCategoryId] = useState(receipt.category_id ?? "");

  const [bankName, setBankName] = useState(receipt.refund_bank_name ?? "");
  const [account, setAccount] = useState(receipt.refund_account ?? "");
  const [holder, setHolder] = useState(receipt.refund_holder ?? "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<ReceiptItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!totalAmount || Number.isNaN(Number(totalAmount))) {
      setError("총금액을 숫자로 입력해주세요.");
      return;
    }
    if (!categoryId) {
      setError("카테고리를 선택해주세요.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updErr } = await supabase
        .from("receipt")
        .update({
          merchant: merchant || null,
          expense_date: expenseDate || null,
          total_amount: Number(totalAmount),
          description: description || null,
          items: items.length ? items : null,
          category_id: categoryId,
          refund_bank_name: bankName || null,
          refund_account: account || null,
          refund_holder: holder || null,
        })
        .eq("id", receipt.id);
      if (updErr) throw updErr;

      router.replace(`/receipts/${receipt.id}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "저장 실패";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="merchant">가맹점</Label>
        <Input
          id="merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="date">사용일</Label>
          <Input
            id="date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="total">총금액</Label>
          <Input
            id="total"
            type="number"
            inputMode="numeric"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>카테고리</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue placeholder="카테고리를 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>품목</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setItems((p) => [...p, { name: "", qty: 1, price: 0 }])}
          >
            <Plus className="h-4 w-4" /> 추가
          </Button>
        </div>
        {items.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              품목 정보 없음
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={it.name}
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  placeholder="품목명"
                  className="flex-1"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  value={it.qty ?? ""}
                  onChange={(e) =>
                    updateItem(idx, { qty: Number(e.target.value) })
                  }
                  className="w-16"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  value={it.price ?? ""}
                  onChange={(e) =>
                    updateItem(idx, { price: Number(e.target.value) })
                  }
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="desc">메모</Label>
        <Textarea
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="rounded-xl border bg-muted/40 p-4">
        <div className="mb-3 text-sm font-semibold">환급 받을 계좌</div>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="bank">은행</Label>
            <Input
              id="bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acct">계좌번호</Label>
            <Input
              id="acct"
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="holder">예금주</Label>
            <Input
              id="holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => router.back()}
          disabled={loading}
        >
          취소
        </Button>
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          저장
        </Button>
      </div>
    </form>
  );
}
