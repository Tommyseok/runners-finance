"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Profile, Role } from "@/lib/db-types";

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  teacher: "교사",
};

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

interface PendingChange {
  user: UserRow;
  newRole: Role;
}

export function UsersClient({
  currentUserId,
  initial,
}: {
  currentUserId: string;
  initial: UserRow[];
}) {
  const [users, setUsers] = useState<UserRow[]>(initial);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function requestChange(u: UserRow, role: Role) {
    if (u.id === currentUserId) return; // 본인은 어차피 disabled
    if (u.role === role) return;
    setError(null);
    setPending({ user: u, newRole: role });
  }

  async function confirmChange() {
    if (!pending) return;
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("update_member_role", {
        target_user_id: pending.user.id,
        new_role: pending.newRole,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      const name = pending.user.name ?? "(이름 없음)";
      const newRole = pending.newRole;
      setUsers((prev) =>
        prev.map((x) =>
          x.id === pending.user.id ? { ...x, role: newRole } : x,
        ),
      );
      setToast(`${name}님이 ${ROLE_LABEL[newRole]}(으)로 변경되었습니다.`);
      setPending(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "권한 변경 실패";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {toast && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}

      <div className="text-sm font-semibold">멤버 ({users.length}명)</div>

      {users.map((u) => {
        const isSelf = u.id === currentUserId;
        return (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{u.name ?? "(이름 없음)"}</span>
                  {isSelf && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      나
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {u.email ?? ""}
                </div>
              </div>
              <Select
                value={u.role}
                onValueChange={(v) => requestChange(u, v as Role)}
                disabled={isSelf}
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
        );
      })}

      <Dialog
        open={!!pending}
        onOpenChange={(v) => {
          if (!v && !loading) {
            setPending(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>권한 변경</DialogTitle>
          </DialogHeader>
          {pending && (
            <p className="text-sm">
              <b>{pending.user.name ?? "이 사용자"}</b>님의 권한을{" "}
              <b>{ROLE_LABEL[pending.newRole]}</b>(으)로 변경하시겠습니까?
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              disabled={loading}
            >
              취소
            </Button>
            <Button onClick={confirmChange} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              변경하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
