"use client";

import { useActionState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { updatePasswordAction } from "../actions";

export default function ResetPasswordPage() {
  const [state, action] = useActionState(updatePasswordAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Nova palavra-passe</h1>
      <p className="mt-1 text-sm text-muted">Escolha uma palavra-passe com pelo menos 12 caracteres.</p>
      <form action={action} className="mt-8 space-y-5" noValidate>
        <FormMessage state={state} />
        <Field id="password" label="Nova palavra-passe" error={errors?.password}>
          <Input
            {...describedBy("password", errors?.password)}
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <Field id="confirm" label="Repetir palavra-passe" error={errors?.confirm}>
          <Input
            {...describedBy("confirm", errors?.confirm)}
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>
        <SubmitButton>Guardar palavra-passe</SubmitButton>
      </form>
    </>
  );
}
