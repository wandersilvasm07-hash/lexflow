import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { CreateOrgForm } from "./create-org-form";

export const metadata: Metadata = { title: "Criar escritório" };

export default async function NewOrgPage() {
  await requireUser("/app/novo-escritorio");
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Criar o seu escritório</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        Fica como administrador e pode convidar a equipa a seguir. Se foi convidado para um
        escritório existente, abra o link do convite em vez de criar um novo.
      </p>
      <Panel className="mt-6 p-5 sm:p-6">
        <CreateOrgForm />
      </Panel>
    </>
  );
}
