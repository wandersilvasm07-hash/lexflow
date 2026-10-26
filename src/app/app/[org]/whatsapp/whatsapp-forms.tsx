"use client";

import { useActionState } from "react";
import { Field, Input, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { enableSimulationAction, setAgentEnabledAction, simulateInboundAction } from "./actions";

export function EnableSimulation({ org }: { org: string }) {
  const [state, action] = useActionState(enableSimulationAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <SubmitButton pendingLabel="A criar…">Experimentar em modo de simulação</SubmitButton>
    </form>
  );
}

export function AgentToggle({ org, enabled }: { org: string; enabled: boolean }) {
  const [state, action] = useActionState(setAgentEnabledAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <div className="flex items-center gap-2">
        <span className={enabled ? "text-ok" : "text-muted"}>{enabled ? "Ativo" : "Pausado"}</span>
        <SubmitButton variant="secondary" size="sm" pendingLabel="…">
          {enabled ? "Pausar" : "Ativar"}
        </SubmitButton>
      </div>
      {state && !state.ok ? <span className="text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}

export function Simulator({ org }: { org: string }) {
  const [state, action] = useActionState(simulateInboundAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <input type="hidden" name="org" value={org} />
      <Field id="phone" label="Número do cliente (simulado)" error={e?.phone}>
        <Input {...describedBy("phone", e?.phone)} defaultValue="+351910000001" inputMode="tel" />
      </Field>
      <Field id="name" label="Nome no WhatsApp (opcional)" error={e?.name}>
        <Input {...describedBy("name", e?.name)} defaultValue="Cliente de teste" />
      </Field>
      <div className="sm:col-span-2">
        <Field id="body" label="Mensagem" error={e?.body}>
          <Textarea
            {...describedBy("body", e?.body)}
            rows={3}
            defaultValue="Boa tarde. Tenho autorização de residência e quero trazer a minha mulher para Portugal. Como faço?"
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="A enviar…">Simular mensagem recebida</SubmitButton>
      </div>
    </form>
  );
}
