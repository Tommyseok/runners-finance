import { Suspense } from "react";
import { InAppBrowserWarning } from "./inapp-browser-warning";
import { LoginButton } from "./login-button";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = searchParams.next ?? "/";
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-6 py-10">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-lg">
          <span className="text-3xl font-bold">R</span>
        </div>
        <h1 className="text-2xl font-bold">Runners Finance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          교회 고등부 회계를 한 번에
        </p>
      </div>
      <InAppBrowserWarning />
      <Suspense fallback={null}>
        <LoginButton next={next} />
      </Suspense>
      <p className="mt-8 text-center text-xs text-muted-foreground">
        로그인하면 서비스 이용에 동의하는 것으로 간주됩니다.
      </p>
    </div>
  );
}
