import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { PageHeader, Panel } from "@/components/ui";
import { can, getOrgContext, isPlatformAdmin } from "@/lib/auth/dal";
import { NewDocumentForm } from "./new-document-form";

export const metadata: Metadata = { title: "Adicionar documento" };

export default async function NewKnowledgeDocPage({ params }: PageProps<"/app/[org]/base-juridica/novo">) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!can(ctx, "knowledge.write")) return <PermissionDenied />;
  const canCommon = await isPlatformAdmin();
  return (
    <>
      <Link href={`/app/${org}/base-juridica`} className="text-sm text-muted hover:text-ink">
        Base jurídica
      </Link>
      <PageHeader
        title="Adicionar documento"
        description="O texto é extraído, dividido em secções e indexado. Fica em rascunho até ser revisto e aprovado."
      />
      <Panel className="p-5 sm:p-6">
        <NewDocumentForm org={org} canCommon={canCommon} />
      </Panel>
    </>
  );
}
