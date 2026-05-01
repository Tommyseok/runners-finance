"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export function WelcomeBanner({ orgName }: { orgName: string | null }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setHidden(true), 3200);
    const cleanupTimer = setTimeout(
      () => router.replace("/", { scroll: false }),
      3700,
    );
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(cleanupTimer);
    };
  }, [router]);

  return (
    <div
      className={`mx-4 mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 transition-opacity duration-500 ${
        hidden ? "opacity-0" : "opacity-100"
      }`}
      role="status"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span>
        {orgName ? `${orgName}에 가입되었습니다` : "조직에 가입되었습니다"} ✓
      </span>
    </div>
  );
}
