"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PlusCircle, Receipt, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  isAdmin: boolean;
}

export function BottomNav({ isAdmin }: BottomNavProps) {
  const pathname = usePathname();

  const items = [
    { href: "/", label: "홈", icon: Home, match: (p: string) => p === "/" },
    {
      href: "/receipts/new",
      label: "등록",
      icon: PlusCircle,
      match: (p: string) => p === "/receipts/new",
    },
    {
      href: "/receipts",
      label: "내영수증",
      icon: Receipt,
      match: (p: string) => p === "/receipts" || p.startsWith("/receipts/"),
    },
    ...(isAdmin
      ? [
          {
            href: "/admin",
            label: "관리자",
            icon: Shield,
            match: (p: string) => p.startsWith("/admin"),
          },
        ]
      : []),
    {
      href: "/profile",
      label: "프로필",
      icon: User,
      match: (p: string) => p.startsWith("/profile"),
    },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t bg-background/95 backdrop-blur safe-bottom">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active =
            item.href === "/receipts/new"
              ? pathname === "/receipts/new"
              : item.match(pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-xs",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
