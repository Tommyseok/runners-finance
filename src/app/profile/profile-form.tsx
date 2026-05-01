"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

interface ProfileData {
  id: string;
  name: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
}

export function ProfileForm({ profile }: { profile: ProfileData }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name ?? "");
  const [bankName, setBankName] = useState(profile.bank_name ?? "");
  const [account, setAccount] = useState(profile.bank_account ?? "");
  const [holder, setHolder] = useState(profile.account_holder ?? "");
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("profile")
        .update({
          name: name.trim() || null,
          bank_name: bankName.trim() || null,
          bank_account: account.trim() || null,
          account_holder: holder.trim() || null,
        })
        .eq("id", profile.id);
      if (err) throw err;
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "저장 실패";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="p-name">이름</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-email">이메일</Label>
            <Input id="p-email" value={profile.email ?? ""} disabled />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-3 text-sm font-semibold">환급 받을 계좌</div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="p-bank">은행</Label>
                <Input
                  id="p-bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="국민은행"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-acct">계좌번호</Label>
                <Input
                  id="p-acct"
                  inputMode="numeric"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="000-0000-0000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-holder">예금주</Label>
                <Input
                  id="p-holder"
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {savedAt && !error && (
            <p className="text-sm text-green-600">저장되었습니다.</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            저장
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
