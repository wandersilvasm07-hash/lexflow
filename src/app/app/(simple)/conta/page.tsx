import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PanelHeader } from "@/components/ui";
import { isPlatformAdmin, requireUser } from "@/lib/auth/dal";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "A minha conta" };

export default async function AccountPage() {
  const user = await requireUser("/app/conta");
  const platform = await isPlatformAdmin();
  return (
    <>
      <Link href="/app" className="text-sm text-muted hover:text-ink">
        Voltar ao escritório
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">A minha conta</h1>
      <div className="mt-6 space-y-6">
        <Panel>
          <PanelHeader title="Perfil" description={user.email} />
          <div className="p-5">
            <ProfileForm fullName={user.fullName ?? ""} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader
            title="Segurança"
            description="Palavra-passe e verificação em dois passos."
            actions={
              <Link href="/app/conta/seguranca" className="text-sm font-medium text-ink underline underline-offset-4">
                Gerir
              </Link>
            }
          />
        </Panel>
        {platform ? (
          <Panel>
            <PanelHeader
              title="Administração da plataforma"
              description="Planos, preços e limites."
              actions={
                <Link href="/app/conta/plataforma" className="text-sm font-medium text-ink underline underline-offset-4">
                  Gerir planos
                </Link>
              }
            />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
