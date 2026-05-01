"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createOrganizationAction,
  joinOrganizationAction,
} from "./actions";

type Stage = "join" | "create";

export function OnboardingClient({
  profileName,
  email: _email,
}: {
  profileName: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("join");
  const [warnOpen, setWarnOpen] = useState(false);

  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [name, setName] = useState(profileName ?? "");

  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [holderTouched, setHolderTouched] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 예금주 자동 동기화 (사용자가 직접 수정하기 전까지 이름과 동일)
  useEffect(() => {
    if (!holderTouched) setAccountHolder(name);
  }, [name, holderTouched]);

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await joinOrganizationAction({
        inviteCode,
        userName: name,
        bankName,
        bankAccount,
        accountHolder,
      });
      if (!res.ok) {
        setError(res.error ?? "참여에 실패했습니다.");
        return;
      }
      router.replace("/?welcome=1");
      router.refresh();
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createOrganizationAction({
        orgName,
        userName: name,
        bankName,
        bankAccount,
        accountHolder,
      });
      if (!res.ok) {
        setError(res.error ?? "조직 생성에 실패했습니다.");
        return;
      }
      router.replace("/?welcome=1");
      router.refresh();
    });
  }

  const bankFields = (
    <div className="rounded-xl border bg-muted/40 p-4">
      <div className="mb-1 text-sm font-semibold">환급 받을 계좌</div>
      <p className="mb-3 text-xs text-muted-foreground">
        지금 입력해두면 영수증 등록 시 자동으로 채워집니다. (나중에 프로필에서
        변경 가능)
      </p>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="bank">은행</Label>
          <Input
            id="bank"
            placeholder="예: 국민은행"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acct">계좌번호</Label>
          <Input
            id="acct"
            inputMode="numeric"
            placeholder="000-0000-0000"
            value={bankAccount}
            onChange={(e) => setBankAccount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="holder">예금주</Label>
          <Input
            id="holder"
            placeholder="홍길동"
            value={accountHolder}
            onChange={(e) => {
              setHolderTouched(true);
              setAccountHolder(e.target.value);
            }}
          />
        </div>
      </div>
    </div>
  );

  if (stage === "create") {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold">새 조직 만들기</div>
            <div className="text-xs text-muted-foreground">
              관리자(admin)로 시작합니다.
            </div>
          </div>
        </div>
        <form className="space-y-4" onSubmit={handleCreate}>
          <div className="space-y-2">
            <Label htmlFor="orgName">조직 이름</Label>
            <Input
              id="orgName"
              placeholder="예: 내수동 고등부"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">내 이름</Label>
            <Input
              id="name"
              placeholder="홍길동"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          {bankFields}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setStage("join");
                setError(null);
              }}
              disabled={pending}
            >
              <ArrowLeft className="h-4 w-4" /> 돌아가기
            </Button>
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "만드는 중..." : "조직 만들기"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-5 text-sm text-muted-foreground">
        초대코드를 받으셨나요?
      </p>

      <form className="space-y-4" onSubmit={handleJoin}>
        <div className="space-y-2">
          <Label htmlFor="code">초대코드</Label>
          <Input
            id="code"
            placeholder="예: A2B3CD"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">내 이름</Label>
          <Input
            id="name"
            placeholder="홍길동"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {bankFields}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "참여 중..." : "참여하기"}
        </Button>
      </form>

      <div className="my-8 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>또는</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="text-center">
        <p className="mb-2 text-sm text-muted-foreground">
          새 조직을 시작하시겠습니까?
        </p>
        <button
          type="button"
          onClick={() => setWarnOpen(true)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          새 조직 만들기 <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={warnOpen} onOpenChange={setWarnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />새 조직을
              만드시겠습니까?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">새 조직을 만들면:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>본인이 관리자(admin)가 됩니다</li>
              <li>다른 사람들은 초대코드로만 합류 가능합니다</li>
              <li>데이터는 다른 조직과 완전히 분리됩니다</li>
              <li>만든 후엔 다른 조직으로 이동할 수 없습니다</li>
            </ul>
            <p className="rounded-md bg-muted/60 p-3 text-muted-foreground">
              이미 초대코드를 받으셨다면 위로 돌아가서 입력해주세요.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setWarnOpen(false)}>
              <ArrowLeft className="h-4 w-4" /> 돌아가기
            </Button>
            <Button
              onClick={() => {
                setWarnOpen(false);
                setStage("create");
                setError(null);
              }}
            >
              네, 새 조직을 만들겠습니다
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
