"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestPasswordResetAction } from "../actions";

export default function RecoverPasswordPage() {
  const [state, action] = useActionState(requestPasswordResetAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Recuperar palavra-passe</h1>
      <p className="mt-1 text-sm text-muted">Enviamos um link para definir uma nova.</p>
      <form action={action} className="mt-8 space-y-5" noValidate>
        <FormMessage state={state} />
        {state?.ok ? null : (
          <>
            <Field id="email" label="Email" error={errors?.email}>
              <Input
                {...describedBy("email", errors?.email)}
                type="email"
                autoComplete="email"
                required
              />
            </Field>
            <SubmitButton pendingLabel="A enviar…">Enviar link</SubmitButton>
          </>
        )}
      </form>
      <p className="mt-8 text-sm">
        <Link href="/entrar" className="text-muted hover:text-ink">
          Voltar a entrar
        </Link>
      </p>
    </>
  );
}
