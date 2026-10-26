import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="w-fit" aria-label="Página inicial">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children}
        </div>
      </main>
      <aside className="hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-end">
        <p className="max-w-xs text-lg leading-snug text-white/90">
          A primeira resposta chega em segundos. A análise jurídica continua a ser sua.
        </p>
        <p className="mt-4 max-w-xs text-sm text-white/60">
          O assistente recolhe a informação inicial e entrega-lhe um resumo. Nunca promete
          resultados nem substitui o parecer do advogado.
        </p>
      </aside>
    </div>
  );
}
