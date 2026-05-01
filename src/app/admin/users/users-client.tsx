"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
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
import type { Profile, Role } from "@/lib/db-types";

export function InviteCodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="flex-1 rounded bg-muted px-3 py-2 text-lg font-mono tracking-widest">
        {code}
      </code>
      <Button variant="outline" size="icon" onClick={copy}>
        {copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

type UserRow = Pick<Profile, "id" | "name" | "email" | "role">;

export function UsersClient({
  currentUserId,
  initial,
}: {
  currentUserId: string;
  initial: UserRow[];
}) {
  const [users, setUsers] = useState<UserRow[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(u: UserRow, role: Role) {
    setError(null);
    if (u.id === currentUserId && role !== "admin") {
      setError("본인의 관리자 권한은 변경할 수 없습니다.");
      return;
    }
    const supabase = createClient();
    const { error: err } = await supabase
      .from("profile")
      .update({ role })
      .eq("id", u.id);
    if (err) {
      setError(err.message);
      return;
    }
    setUsers((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, role } : x)),
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">멤버 ({users.length}명)</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {users.map((u) => (
        <Card key={u.id}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {u.name ?? "(이름 없음)"}
                {u.id === currentUserId && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (나)
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {u.email ?? ""}
              </div>
            </div>
            <Select
              value={u.role}
              onValueChange={(v) => changeRole(u, v as Role)}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teacher">교사</SelectItem>
                <SelectItem value="admin">관리자</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
