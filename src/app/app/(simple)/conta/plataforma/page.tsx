import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Panel, PanelHeader } from "@/components/ui";
import { isPlatformAdmin, requireUser } from "@/lib/auth/dal";
import { listPlans } from "@/lib/data/billing";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = { title: "Plataforma · Planos" };

export default async function PlatformPlansPage() {
  await requireUser("/app/conta/plataforma");
  if (!(await isPlatformAdmin())) notFound();
  const plans = await listPlans(true);
  return (
    <>
      <Link href="/app/conta" className="text-sm text-muted hover:text-ink">
        Voltar à conta
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Planos da plataforma</h1>
      <p className="mt-1.5 text-sm text-muted">Preços, limites e funcionalidades de cada plano. As alterações aplicam-se logo a todos os escritórios desse plano.</p>
      <Alert tone="info" className="mt-5">
        O preço aqui é o que se mostra aos escritórios; o valor cobrado é o do preço no Stripe indicado. Mantenha os dois iguais.
      </Alert>
      <div className="mt-6 space-y-6">
        {plans.map((p) => (
          <Panel key={p.id}>
            <PanelHeader title={p.name} description={`Identificador: ${p.id}`} />
            <div className="p-5">
              <PlanForm plan={p} />
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
