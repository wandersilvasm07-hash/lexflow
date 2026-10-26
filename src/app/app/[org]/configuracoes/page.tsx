import type { Metadata } from "next";
import { Panel, PanelHeader } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { OrgProfileForm } from "./settings-forms";

export const metadata: Metadata = { title: "Configurações" };

export default async function OrgSettingsPage({ params }: PageProps<"/app/[org]/configuracoes">) {
  const ctx = await getOrgContext((await params).org);
  return (
    <Panel>
      <PanelHeader title="Perfil do escritório" description="Usado em documentos, faturação e no assistente de atendimento." />
      <div className="p-5">
        <OrgProfileForm org={ctx.org} canEdit={can(ctx, "org.update")} />
      </div>
    </Panel>
  );
}
