import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.billing };

export default async function Page({ params }: PageProps<"/app/[org]/faturacao">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "billing.manage")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="billing"
      summary="Plano, consumos e histórico de pagamentos do escritório."
      willDo={["Planos Essencial, Profissional e Premium configuráveis","Consumo de IA, mensagens e campanhas face aos limites do plano","Alterar ou cancelar o plano","Pagamentos geridos por um prestador externo (sem guardar cartões)"]}
      requires={["Conta num prestador de pagamentos (ex.: Stripe)","Definição de preços e limites por plano"]}
    />
  );
}
