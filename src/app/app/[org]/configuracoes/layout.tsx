import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children, params }: LayoutProps<"/app/[org]/configuracoes">) {
  const { org } = await params;
  return (
    <>
      <PageHeader title="Configurações" description="Dados do escritório, segurança e registo de atividade." />
      <SettingsTabs base={`/app/${org}/configuracoes`} />
      <div className="mt-6">{children}</div>
    </>
  );
}
