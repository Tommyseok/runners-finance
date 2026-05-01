import { BottomNav } from "@/components/bottom-nav";

interface AppShellProps {
  children: React.ReactNode;
  isAdmin: boolean;
  showNav?: boolean;
}

export function AppShell({ children, isAdmin, showNav = true }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-background">
      <main className={showNav ? "flex-1 pb-20" : "flex-1"}>{children}</main>
      {showNav && <BottomNav isAdmin={isAdmin} />}
    </div>
  );
}
