"use client";

import { useActionState } from "react";
import { Field, Input, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { savePlanAction } from "./actions";

type PlanInput = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  stripe_price_id: string | null;
  limits: Record<string, number | undefined>;
  features: string[];
  is_public: boolean;
  position: number;
};

const LIMITS: [string, string][] = [
  ["members", "Membros"],
  ["ai_replies_month", "Respostas IA / mês"],
  ["ad_generations_month", "Propostas de campanha / mês"],
  ["active_campaigns", "Campanhas em curso"],
  ["knowledge_docs", "Documentos jurídicos"],
];

export function PlanForm({ plan }: { plan: PlanInput }) {
  const [state, action] = useActionState(savePlanAction, null);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const p = (k: string) => `${plan.id}-${k}`;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={plan.id} />
      <input type="hidden" name="position" value={plan.position} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={p("name")} label="Nome" error={fe.name}>
          <Input {...describedBy(p("name"), fe.name)} name="name" defaultValue={plan.name} required />
        </Field>
        <Field id={p("price")} label="Preço mensal sem IVA (€)" error={fe.price} hint="Vazio = sob consulta.">
          <Input {...describedBy(p("price"), fe.price, true)} name="price" inputMode="decimal" defaultValue={plan.price_cents !== null ? (plan.price_cents / 100).toFixed(2).replace(".", ",") : ""} />
        </Field>
        <Field id={p("stripe")} label="ID do preço no Stripe" error={fe.stripe_price_id} hint="price_… (sem isto, não se subscreve).">
          <Input {...describedBy(p("stripe"), fe.stripe_price_id, true)} name="stripe_price_id" defaultValue={plan.stripe_price_id ?? ""} placeholder="price_…" />
        </Field>
      </div>
      <Field id={p("description")} label="Descrição">
        <Input {...describedBy(p("description"))} name="description" defaultValue={plan.description ?? ""} maxLength={500} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-[0.8125rem] font-medium">Limites (vazio = sem limite)</legend>
        <div className="grid gap-3 sm:grid-cols-5">
          {LIMITS.map(([k, label]) => (
            <Field key={k} id={p(k)} label={label} error={fe[`limit_${k}`]}>
              <Input {...describedBy(p(k), fe[`limit_${k}`])} name={`limit_${k}`} inputMode="numeric" defaultValue={plan.limits[k] ?? ""} />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field id={p("features")} label="Funcionalidades mostradas (uma por linha)">
        <Textarea {...describedBy(p("features"))} name="features" rows={4} defaultValue={plan.features.join("\n")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_public" defaultChecked={plan.is_public} /> Visível para os escritórios
      </label>
      <SubmitButton>Guardar plano</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
