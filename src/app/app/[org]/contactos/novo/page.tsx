import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { PageHeader, Panel } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { NewContactForm } from "../contact-forms";

export const metadata: Metadata = { title: "Novo contacto" };

export default async function NewContactPage({ params }: PageProps<"/app/[org]/contactos/novo">) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!can(ctx, "contacts.write")) return <PermissionDenied />;
  return (
    <>
      <Link href={`/app/${org}/contactos`} className="text-sm text-muted hover:text-ink">
        Contactos
      </Link>
      <PageHeader title="Novo contacto" description="Para quem chegou por telefone, email ou recomendação." />
      <Panel className="max-w-2xl p-5 sm:p-6">
        <NewContactForm org={org} />
      </Panel>
    </>
  );
}
