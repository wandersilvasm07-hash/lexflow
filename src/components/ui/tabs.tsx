"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./index";

/** Separadores de secção ligados a rotas (marca o ativo pelo caminho). */
export function RouteTabs({ tabs, label }: { tabs: { href: string; label: string; exact?: boolean }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
