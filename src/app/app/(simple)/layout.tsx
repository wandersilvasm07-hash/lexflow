import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";

/** Layout simples para páginas fora de um escritório (escolha, criação, conta). */
export default function SimpleLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-line bg-surface px-5 sm:px-8">
        <Link href="/app" aria-label="Início">
          <Logo />
        </Link>
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-muted hover:text-ink">
            Sair
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-line/60" aria-busy="true" />}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
