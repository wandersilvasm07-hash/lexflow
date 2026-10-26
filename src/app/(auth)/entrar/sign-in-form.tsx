"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Alert, Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction } from "../actions";

const notices: Record<string, { tone: "seal" | "ok"; text: string }> = {
  "link-invalido": {
    tone: "seal",
    text: "O link é inválido ou expirou. Peça um novo ou entre com a palavra-passe.",
  },
};

export function SignInForm() {
  const params = useSearchParams();
  const [state, action] = useActionState(signInAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const notice = notices[params.get("erro") ?? ""];

  return (
    <form action={action} className="space-y-5" noValidate>
      {notice && !state ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <Field id="email" label="Email" error={errors?.email}>
        <Input {...describedBy("email", errors?.email)} type="email" autoComplete="email" required />
      </Field>
      <Field id="password" label="Palavra-passe" error={errors?.password}>
        <Input
          {...describedBy("password", errors?.password)}
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <div className="flex items-center justify-between gap-4">
        <SubmitButton pendingLabel="A entrar…">Entrar</SubmitButton>
        <Link href="/recuperar-palavra-passe" className="text-sm text-muted hover:text-ink">
          Esqueceu a palavra-passe?
        </Link>
      </div>
    </form>
  );
}
