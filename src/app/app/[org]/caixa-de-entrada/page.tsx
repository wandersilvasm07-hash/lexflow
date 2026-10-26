import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.inbox };

export default async function Page({ params }: PageProps<"/app/[org]/caixa-de-entrada">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "conversations.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="inbox"
      summary="Todas as conversas num só sítio, com o resumo preparado pela IA."
      willDo={["Lista de conversas com estado, responsável e última mensagem","Assumir uma conversa: a IA para de responder automaticamente","Notas internas visíveis só para a equipa","Resumo factual, motivo de encaminhamento e fontes consultadas"]}
      requires={["WhatsApp ligado (módulo WhatsApp IA)"]}
    />
  );
}
