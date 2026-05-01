"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BudgetCategory } from "@/lib/db-types";

const ALL = "__all__";

interface Current {
  month: string;
  category: string;
  status: string;
}

export function ReceiptsFilters({
  categories,
  current,
}: {
  categories: BudgetCategory[];
  current: Current;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: keyof Current, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    router.replace(`/receipts?${next.toString()}`);
  }

  function reset() {
    router.replace("/receipts");
  }

  // build last 12 months
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ value, label: `${d.getFullYear()}년 ${d.getMonth() + 1}월` });
  }

  const hasFilter = !!(current.month || current.category || current.status);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={current.month || ALL}
          onValueChange={(v) => update("month", v)}
        >
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder="월별" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 기간</SelectItem>
            {months.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={current.category || ALL}
          onValueChange={(v) => update("category", v)}
        >
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder="카테고리" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 카테고리</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={current.status || ALL}
          onValueChange={(v) => update("status", v)}
        >
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체</SelectItem>
            <SelectItem value="pending">대기</SelectItem>
            <SelectItem value="paid">입금완료</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hasFilter && (
        <Button variant="ghost" size="sm" onClick={reset}>
          필터 초기화
        </Button>
      )}
    </div>
  );
}
