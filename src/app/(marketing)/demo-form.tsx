"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestDemoAction } from "./actions";

export function DemoForm() {
  const [state, action] = useActionState(requestDemoAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  if (state?.ok) return <FormMessage state={state} />;

  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <Field id="fullName" label="Nome" error={e?.fullName}>
        <Input {...describedBy("fullName", e?.fullName)} autoComplete="name" required />
      </Field>
      <Field id="email" label="Email" error={e?.email}>
        <Input {...describedBy("email", e?.email)} type="email" autoComplete="email" required />
      </Field>
      <Field id="firmName" label="Escritório" error={e?.firmName}>
        <Input {...describedBy("firmName", e?.firmName)} autoComplete="organization" />
      </Field>
      <Field id="phone" label="Telefone (opcional)" error={e?.phone}>
        <Input {...describedBy("phone", e?.phone)} type="tel" autoComplete="tel" />
      </Field>
      <div className="sm:col-span-2">
        <Field id="message" label="Como atende hoje os primeiros contactos? (opcional)" error={e?.message}>
          <Textarea {...describedBy("message", e?.message)} rows={3} />
        </Field>
      </div>
      {/* Armadilha para robôs: invisível para pessoas e leitores de ecrã. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input type="checkbox" name="consent" className="mt-1 size-4 accent-ink" />
          <span>
            Aceito que usem estes dados para me contactarem sobre a demonstração, nos termos da{" "}
            <Link href="/privacidade" className="text-ink underline underline-offset-2">
              política de privacidade
            </Link>
            .
          </span>
        </label>
        {e?.consent ? (
          <p role="alert" className="text-xs text-seal">
            {e.consent}
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <SubmitButton size="lg" pendingLabel="A enviar…">
          Pedir demonstração
        </SubmitButton>
      </div>
    </form>
  );
}
