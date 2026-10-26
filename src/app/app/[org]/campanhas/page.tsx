import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.campaigns };

export default async function Page({ params }: PageProps<"/app/[org]/campanhas">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "campaigns.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="campaigns"
      summary="Campanhas publicadas e o seu estado real nas plataformas."
      willDo={["Estado confirmado na plataforma (não apenas o pedido enviado)","Pausar campanhas e registo de todas as alterações","Alertas de consumo de orçamento"]}
    />
  );
}
