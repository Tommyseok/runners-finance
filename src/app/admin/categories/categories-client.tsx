"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import type { BudgetCategory } from "@/lib/db-types";

export function CategoriesClient({
  orgId,
  initial,
}: {
  orgId: string;
  initial: BudgetCategory[];
}) {
  const [items, setItems] = useState<BudgetCategory[]>(initial);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase
      .from("budget_category")
      .select("*")
      .eq("org_id", orgId)
      .order("sort_order");
    setItems((data ?? []) as BudgetCategory[]);
  }

  async function addCategory() {
    if (!newName.trim()) return;
    setError(null);
    const supabase = createClient();
    const maxOrder = items.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error: err } = await supabase.from("budget_category").insert({
      org_id: orgId,
      name: newName.trim(),
      sort_order: maxOrder + 10,
      is_active: true,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setNewName("");
    await refresh();
  }

  async function rename(cat: BudgetCategory, name: string) {
    if (!name.trim() || name.trim() === cat.name) return;
    const supabase = createClient();
    await supabase
      .from("budget_category")
      .update({ name: name.trim() })
      .eq("id", cat.id);
    await refresh();
  }

  async function toggleActive(cat: BudgetCategory) {
    const supabase = createClient();
    await supabase
      .from("budget_category")
      .update({ is_active: !cat.is_active })
      .eq("id", cat.id);
    await refresh();
  }

  async function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const a = items[idx];
    const b = items[target];
    const supabase = createClient();
    await Promise.all([
      supabase
        .from("budget_category")
        .update({ sort_order: b.sort_order })
        .eq("id", a.id),
      supabase
        .from("budget_category")
        .update({ sort_order: a.sort_order })
        .eq("id", b.id),
    ]);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-2 p-3">
          <Input
            placeholder="새 카테고리 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
          />
          <Button onClick={addCategory} size="icon">
            <Plus className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            카테고리가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((cat, idx) => (
            <Card key={cat.id}>
              <CardContent className="flex items-center gap-2 p-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <Input
                  defaultValue={cat.name}
                  className="flex-1"
                  onBlur={(e) => rename(cat, e.target.value)}
                />
                <Switch
                  checked={cat.is_active}
                  onCheckedChange={() => toggleActive(cat)}
                />
              </CardContent>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
