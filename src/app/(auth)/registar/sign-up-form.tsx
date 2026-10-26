"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUpAction } from "../actions";

export function SignUpForm() {
  const params = useSearchParams();
  const [state, action] = useActionState(signUpAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) return <FormMessage state={state} />;

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <Field id="fullName" label="Nome" error={errors?.fullName}>
        <Input {...describedBy("fullName", errors?.fullName)} autoComplete="name" required />
      </Field>
      <Field id="email" label="Email profissional" error={errors?.email}>
        <Input
          {...describedBy("email", errors?.email)}
          type="email"
          autoComplete="email"
          defaultValue={params.get("email") ?? ""}
          required
        />
      </Field>
      <Field
        id="password"
        label="Palavra-passe"
        error={errors?.password}
        hint="Pelo menos 12 caracteres. Uma frase com várias palavras funciona bem."
      >
        <Input
          {...describedBy("password", errors?.password, true)}
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <div className="space-y-1.5">
        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input
            type="checkbox"
            name="acceptTerms"
            className="mt-1 size-4 accent-ink"
            aria-invalid={errors?.acceptTerms ? true : undefined}
          />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" className="text-ink underline underline-offset-2">
              termos
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" className="text-ink underline underline-offset-2">
              política de privacidade
            </Link>
            .
          </span>
        </label>
        {errors?.acceptTerms ? (
          <p className="text-xs text-seal" role="alert">
            {errors.acceptTerms}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingLabel="A criar conta…">Criar conta</SubmitButton>
    </form>
  );
}
