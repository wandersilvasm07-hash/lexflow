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
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-end">
        {/* Motivo da marca: o bojo do P em meia-lua, sobre blocos de petróleo. */}
        <svg viewBox="0 0 448 448" className="absolute inset-x-0 top-0 w-full" aria-hidden="true">
          <rect x="224" y="0" width="224" height="168" fill="#203F50" />
          <rect x="224" y="168" width="224" height="96" fill="#1A3546" />
          <path d="M48 72h96a48 48 0 0 1 0 96H48z" fill="#D8BD83" />
          <rect x="48" y="72" width="24" height="168" fill="#FFFFFF" />
          <line x1="48" y1="296" x2="176" y2="296" stroke="#D8BD83" strokeWidth="1" />
        </svg>
        <p className="relative max-w-xs font-display text-xl leading-snug text-white">
          A primeira resposta chega em segundos. A análise jurídica continua a ser sua.
        </p>
        <p className="relative mt-4 max-w-xs text-sm leading-relaxed text-white/60">
          O assistente recolhe a informação inicial e entrega-lhe um resumo. Nunca promete
          resultados nem substitui o parecer do advogado.
        </p>
      </aside>
    </div>
  );
}
