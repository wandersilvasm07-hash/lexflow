import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.contacts };

export default async function Page({ params }: PageProps<"/app/[org]/contactos">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "contacts.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="contacts"
      summary="Potenciais clientes e o histórico de cada atendimento."
      willDo={["Ficha de contacto com origem, serviço pretendido, responsável e próxima ação","Estados: novo contacto, em atendimento, consulta marcada, convertido…","Filtros, etiquetas e exportações controladas e auditadas","Registo de consentimentos e pedidos de acesso ou eliminação de dados"]}
    />
  );
}
