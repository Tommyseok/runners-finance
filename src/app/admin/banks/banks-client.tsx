"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import type { BankAccount } from "@/lib/db-types";

export function BanksClient({
  orgId,
  initial,
}: {
  orgId: string;
  initial: BankAccount[];
}) {
  const [items, setItems] = useState<BankAccount[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [label, setLabel] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase
      .from("bank_account")
      .select("*")
      .eq("org_id", orgId)
      .order("label");
    setItems((data ?? []) as BankAccount[]);
  }

  function openNew() {
    setEditing(null);
    setLabel("");
    setBankName("");
    setAccountNo("");
    setError(null);
    setOpen(true);
  }

  function openEdit(b: BankAccount) {
    setEditing(b);
    setLabel(b.label);
    setBankName(b.bank_name);
    setAccountNo(b.account_no);
    setError(null);
    setOpen(true);
  }

  async function save() {
    if (!label.trim() || !bankName.trim() || !accountNo.trim()) {
      setError("모든 항목을 입력해주세요.");
      return;
    }
    const supabase = createClient();
    if (editing) {
      const { error: err } = await supabase
        .from("bank_account")
        .update({
          label: label.trim(),
          bank_name: bankName.trim(),
          account_no: accountNo.trim(),
        })
        .eq("id", editing.id);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from("bank_account").insert({
        org_id: orgId,
        label: label.trim(),
        bank_name: bankName.trim(),
        account_no: accountNo.trim(),
        is_active: true,
      });
      if (err) {
        setError(err.message);
        return;
      }
    }
    setOpen(false);
    await refresh();
  }

  async function toggleActive(b: BankAccount) {
    const supabase = createClient();
    await supabase
      .from("bank_account")
      .update({ is_active: !b.is_active })
      .eq("id", b.id);
    await refresh();
  }

  async function remove(b: BankAccount) {
    if (!confirm(`'${b.label}' 통장을 삭제할까요?`)) return;
    const supabase = createClient();
    await supabase.from("bank_account").delete().eq("id", b.id);
    await refresh();
  }

  return (
    <div className="space-y-3">
      <Button onClick={openNew} className="w-full" variant="outline">
        <Plus className="h-4 w-4" /> 통장 추가
      </Button>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            등록된 통장이 없습니다.
          </CardContent>
        </Card>
      ) : (
        items.map((b) => (
          <Card key={b.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(b)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-semibold">{b.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.bank_name} · {b.account_no}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={b.is_active}
                    onCheckedChange={() => toggleActive(b)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(b)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "통장 수정" : "통장 추가"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="b-label">표시 이름</Label>
              <Input
                id="b-label"
                placeholder="예: 운영비 통장"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-bank">은행</Label>
              <Input
                id="b-bank"
                placeholder="국민은행"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-acct">계좌번호</Label>
              <Input
                id="b-acct"
                inputMode="numeric"
                value={accountNo}
                onChange={(e) => setAccountNo(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={save}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
