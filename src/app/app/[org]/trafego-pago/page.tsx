import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.ads };

export default async function Page({ params }: PageProps<"/app/[org]/trafego-pago">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "campaigns.write")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="ads"
      summary="Prepare campanhas com assistência da IA, com aprovação explícita antes de publicar."
      willDo={["Escolher serviço, objetivo, localização, idiomas e orçamento","Estratégia, textos e briefing de imagens gerados pela IA, com estimativas identificadas","Revisão de conformidade com as regras de publicidade da profissão","Limites de orçamento e confirmação explícita antes da publicação"]}
      requires={["Conta Meta Ads e página do escritório","Validação das regras de publicidade aplicáveis à advocacia"]}
    />
  );
}
