import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Panel, PanelHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { MfaManager } from "./mfa-manager";

export const metadata: Metadata = { title: "Segurança da conta" };

export default async function AccountSecurityPage({ searchParams }: PageProps<"/app/conta/seguranca">) {
  await requireUser("/app/conta/seguranca");
  const sp = await searchParams;
  const required = sp.mfa === "obrigatorio";
  const org = typeof sp.escritorio === "string" ? sp.escritorio : null;

  return (
    <>
      <Link href="/app/conta" className="text-sm text-muted hover:text-ink">
        A minha conta
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Segurança</h1>
      {required ? (
        <Alert tone="warn" className="mt-6" title="O seu escritório exige verificação em dois passos">
          Configure-a abaixo (ou introduza o código, se já a tiver) para continuar.
        </Alert>
      ) : null}
      <div className="mt-6 space-y-6">
        <Panel>
          <PanelHeader
            title="Verificação em dois passos"
            description="Além da palavra-passe, pede um código da aplicação de autenticação do telemóvel."
          />
          <div className="p-5">
            <MfaManager returnTo={org ? `/app/${org}` : null} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader
            title="Palavra-passe"
            actions={
              <Link href="/redefinir-palavra-passe" className="text-sm font-medium text-ink underline underline-offset-4">
                Alterar
              </Link>
            }
          />
        </Panel>
      </div>
    </>
  );
}
