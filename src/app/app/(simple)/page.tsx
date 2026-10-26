import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Panel } from "@/components/ui";
import { listMyOrganizations, requireUser } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Escritórios" };

/**
 * Ponto de entrada após o login:
 *  - sem escritório → criar um;
 *  - um escritório → entra diretamente;
 *  - vários → escolher.
 */
export default async function AppEntryPage() {
  await requireUser("/app");
  const orgs = await listMyOrganizations();

  if (orgs.length === 0) redirect("/app/novo-escritorio");
  if (orgs.length === 1) redirect(`/app/${orgs[0].slug}`);

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Escolha o escritório</h1>
      <Panel className="mt-6">
        <ul className="divide-y divide-line">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/app/${o.slug}`} className="flex items-center justify-between px-5 py-4 hover:bg-paper">
                <span className="font-medium">{o.name}</span>
                <span className="text-sm text-muted">{t.roles[o.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="mt-6">
        <ButtonLink href="/app/novo-escritorio" variant="secondary">
          Criar outro escritório
        </ButtonLink>
      </div>
    </>
  );
}
