import { Skeleton } from "@/components/ui/skeleton";

/** 결산 로딩 스켈레톤 — 분해 집계 계산 동안 골격을 즉시 표시. */
export default function SettlementLoading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-4 py-4">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}
