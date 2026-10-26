import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Panel, PanelHeader } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { OrgSecurityForm } from "../settings-forms";

export const metadata: Metadata = { title: "Segurança" };

export default async function OrgSecurityPage({ params }: PageProps<"/app/[org]/configuracoes/seguranca">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "settings.manage")) return <PermissionDenied />;
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="Acesso da equipa" />
        <div className="p-5">
          <OrgSecurityForm org={ctx.org.slug} requireMfa={ctx.org.require_mfa} />
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Proteção de dados" />
        <ul className="list-disc space-y-1.5 py-4 pr-5 pl-10 text-sm text-muted marker:text-line-strong">
          <li>Os dados de cada escritório estão isolados na base de dados; nenhum outro escritório os consegue ler.</li>
          <li>As conversas não são usadas para treinar modelos de IA.</li>
          <li>As ações importantes ficam no registo de atividade, que não pode ser alterado nem apagado.</li>
          <li>
            A sua própria verificação em dois passos configura-se em{" "}
            <Link href="/app/conta/seguranca" className="text-ink underline underline-offset-2">
              A minha conta
            </Link>
            .
          </li>
        </ul>
      </Panel>
    </div>
  );
}
