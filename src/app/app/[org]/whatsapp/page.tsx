import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.whatsapp };

export default async function Page({ params }: PageProps<"/app/[org]/whatsapp">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "whatsapp.manage")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="whatsapp"
      summary="Ligue o número do escritório e configure o assistente de atendimento."
      willDo={["Ligar o WhatsApp Business através da integração oficial da Meta","Configurar o assistente: horário, tom, serviços e mensagens de boas-vindas","Pausar e reativar o assistente a qualquer momento","Ambiente de simulação claramente identificado enquanto não houver credenciais"]}
      requires={["Conta Meta Business verificada","Número de telefone dedicado ao WhatsApp Business Platform","App Meta com permissões de WhatsApp aprovadas"]}
    />
  );
}
