import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <Link href="/" aria-label="Página inicial">
        <Logo />
      </Link>
      <h1 className="mt-10 text-xl font-semibold">Página não encontrada</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        O endereço não existe ou não tem acesso a ele. Se foi convidado para um escritório, use o link do convite.
      </p>
      <ButtonLink href="/app" className="mt-6">
        Ir para a aplicação
      </ButtonLink>
    </div>
  );
}
