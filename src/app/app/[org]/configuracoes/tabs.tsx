"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export function SettingsTabs({ base }: { base: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Escritório" },
    { href: `${base}/seguranca`, label: "Segurança" },
    { href: `${base}/auditoria`, label: "Registo de atividade" },
    { href: `${base}/dados`, label: "Dados e privacidade" },
  ];
  return (
    <nav aria-label="Secções" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
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
