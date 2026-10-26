"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { verifyMfaAction } from "../../actions";

function MfaForm() {
  const params = useSearchParams();
  const [state, action] = useActionState(verifyMfaAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <Field id="code" label="Código de 6 dígitos" error={errors?.code}>
        <Input
          {...describedBy("code", errors?.code)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          className="text-lg tracking-[0.3em]"
          autoFocus
          required
        />
      </Field>
      <SubmitButton pendingLabel="A verificar…">Verificar</SubmitButton>
    </form>
  );
}

export default function MfaVerifyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Verificação em dois passos</h1>
      <p className="mt-1 text-sm text-muted">
        Abra a aplicação de autenticação no telemóvel e introduza o código atual.
      </p>
      <Suspense>
        <MfaForm />
      </Suspense>
    </>
  );
}
