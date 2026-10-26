import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.knowledge };

export default async function Page({ params }: PageProps<"/app/[org]/base-juridica">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "knowledge.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="knowledge"
      summary="Documentos aprovados que a IA consulta antes de responder."
      willDo={["Importar PDF, DOCX, HTML e texto de fontes oficiais","Estados editoriais: rascunho, em revisão, aprovado, desatualizado, arquivado","Datas de vigência, revisão e versão de cada documento","Documentos privados do escritório separados da base comum"]}
      requires={["Revisão e aprovação por um advogado antes de a IA usar qualquer conteúdo"]}
    />
  );
}
