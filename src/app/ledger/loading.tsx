import { Skeleton } from "@/components/ui/skeleton";

/** 원장 로딩 스켈레톤 — 전체 거래 조회 동안 골격을 즉시 표시. */
export default function LedgerLoading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-4 py-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
