"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { Organization } from "@/lib/auth/dal";
import { updateOrgProfileAction, updateOrgSecurityAction } from "./actions";

const TIMEZONES = ["Europe/Lisbon", "Atlantic/Azores", "Atlantic/Madeira"];

export function OrgProfileForm({ org, canEdit }: { org: Organization; canEdit: boolean }) {
  const [state, action] = useActionState(updateOrgProfileAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org.slug} />
      <fieldset disabled={!canEdit} className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Nome do escritório" error={e?.name}>
          <Input {...describedBy("name", e?.name)} defaultValue={org.name} required />
        </Field>
        <Field id="legal_name" label="Denominação legal" error={e?.legal_name} hint="Como consta no registo.">
          <Input {...describedBy("legal_name", e?.legal_name, true)} defaultValue={org.legal_name ?? ""} />
        </Field>
        <Field id="nif" label="NIF" error={e?.nif}>
          <Input {...describedBy("nif", e?.nif)} defaultValue={org.nif ?? ""} inputMode="numeric" maxLength={11} />
        </Field>
        <Field id="email" label="Email de contacto" error={e?.email}>
          <Input {...describedBy("email", e?.email)} type="email" defaultValue={org.email ?? ""} />
        </Field>
        <Field id="phone" label="Telefone" error={e?.phone}>
          <Input {...describedBy("phone", e?.phone)} type="tel" defaultValue={org.phone ?? ""} />
        </Field>
        <Field id="timezone" label="Fuso horário" error={e?.timezone}>
          <Select {...describedBy("timezone", e?.timezone)} defaultValue={org.timezone}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label="Morada" error={e?.address}>
            <Textarea {...describedBy("address", e?.address)} rows={2} defaultValue={org.address ?? ""} />
          </Field>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        {canEdit ? (
          <SubmitButton>Guardar alterações</SubmitButton>
        ) : (
          <p className="text-sm text-muted">Só o administrador do escritório pode alterar estes dados.</p>
        )}
        <p className="text-xs text-muted">Endereço do escritório: /app/{org.slug} (não pode ser alterado).</p>
      </div>
    </form>
  );
}

export function OrgSecurityForm({ org, requireMfa }: { org: string; requireMfa: boolean }) {
  const [state, action] = useActionState(updateOrgSecurityAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="require_mfa" defaultChecked={requireMfa} className="mt-1 size-4 accent-ink" />
        <span>
          <span className="block text-sm font-medium">Exigir verificação em dois passos a toda a equipa</span>
          <span className="block text-sm text-muted">
            Quem ainda não a tiver ativada é encaminhado para a configurar antes de aceder ao escritório.
          </span>
        </span>
      </label>
      <SubmitButton>Guardar</SubmitButton>
    </form>
  );
}
