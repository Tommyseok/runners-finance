import { Skeleton } from "@/components/ui/skeleton";

/**
 * 루트 로딩 스켈레톤 — 자체 loading.tsx가 없는 모든 경로의 폴백.
 * 특정 페이지 모양을 흉내내지 않는 범용 골격 (빈 화면 방지가 목적).
 */
export default function RootLoading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-4 py-4">
      <Skeleton className="h-8 w-32" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}
