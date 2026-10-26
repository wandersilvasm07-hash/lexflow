import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.reports };

export default async function Page({ params }: PageProps<"/app/[org]/relatorios">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "reports.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="reports"
      summary="Resultados de atendimento e de publicidade, com origem dos dados identificada."
      willDo={["Conversas, contactos qualificados e consultas por período","Investimento, custo por contacto e custo por consulta","Separação entre métricas das plataformas e métricas calculadas internamente","Janela de atribuição e limitações de medição indicadas"]}
    />
  );
}
