"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  back?: boolean;
  right?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, back, right, className }: PageHeaderProps) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-3 backdrop-blur safe-top",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {back && (
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
            aria-label="뒤로"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
