"use client";

import { useActionState, useState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { slugify } from "@/lib/validation";
import { createOrganizationAction } from "./actions";

export function CreateOrgForm() {
  const [state, action] = useActionState(createOrganizationAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const effectiveSlug = slugEdited ? slug : slugify(name);

  return (
    <form action={action} className="space-y-5" noValidate>
      {state && !state.ok && !e ? <FormMessage state={state} /> : null}
      <Field id="name" label="Nome do escritório" error={e?.name}>
        <Input
          {...describedBy("name", e?.name)}
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="Ex.: Silva & Costa Advogados"
          autoFocus
          required
        />
      </Field>
      <Field
        id="slug"
        label="Endereço"
        error={e?.slug}
        hint="Letras minúsculas, números e hífenes. Não pode ser alterado depois."
      >
        <div className="flex items-center rounded-control border border-line-strong bg-paper focus-within:border-ink">
          <span className="pl-3 text-sm text-muted">/app/</span>
          <Input
            {...describedBy("slug", e?.slug, true)}
            value={effectiveSlug}
            onChange={(ev) => {
              setSlugEdited(true);
              setSlug(ev.target.value.toLowerCase());
            }}
            className="border-0 bg-transparent pl-0.5 focus:ring-0"
            required
          />
        </div>
      </Field>
      <SubmitButton pendingLabel="A criar…">Criar escritório</SubmitButton>
    </form>
  );
}
