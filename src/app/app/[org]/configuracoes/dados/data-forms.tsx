"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteOrganizationAction, updateRetentionAction } from "../actions";

export function RetentionForm({ org, months, canEdit }: { org: string; months: number; canEdit: boolean }) {
  const [state, action] = useActionState(updateRetentionAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="org" value={org} />
      <Field id="months" label="Apagar conversas fechadas sem atividade há mais de">
        <Select {...describedBy("months")} defaultValue={String(months)} disabled={!canEdit} className="w-48">
          {[6, 12, 18, 24, 36, 60, 120].map((m) => (
            <option key={m} value={m}>
              {m} meses{m === 24 ? " (recomendado)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {canEdit ? <SubmitButton variant="secondary">Guardar</SubmitButton> : null}
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DeleteOrganizationForm({ org }: { org: string }) {
  const [state, action] = useActionState(deleteOrganizationAction, null);
  const [typed, setTyped] = useState("");
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org" value={org} />
      <Field id="confirm" label={`Para confirmar, escreva o endereço do escritório: ${org}`} error={fe.confirm}>
        <Input {...describedBy("confirm", fe.confirm)} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="reason" label="Motivo (opcional)">
        <Textarea {...describedBy("reason")} rows={2} maxLength={500} />
      </Field>
      <SubmitButton variant="danger" disabled={typed.trim().toLowerCase() !== org.toLowerCase()} pendingLabel="A eliminar…">
        Eliminar o escritório e todos os dados
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
