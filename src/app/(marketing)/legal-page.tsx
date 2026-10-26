import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex h-16 max-w-3xl items-center px-5 sm:px-8">
        <Link href="/" aria-label="Página inicial">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <Alert tone="warn" className="mt-6">
          Rascunho por rever. Este texto tem de ser revisto e aprovado juridicamente antes do lançamento.
        </Alert>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text">
          {children}
        </div>
      </main>
    </div>
  );
}
