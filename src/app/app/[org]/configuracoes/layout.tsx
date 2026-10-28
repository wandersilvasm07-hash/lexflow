import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children, params }: LayoutProps<"/app/[org]/configuracoes">) {
  const { org } = await params;
  return (
    <>
      <PageHeader title="Configurações" description="Dados do escritório, segurança, registo de atividade e privacidade." />
      <SettingsTabs base={`/app/${org}/configuracoes`} />
      <div className="mt-6">{children}</div>
    </>
  );
}
