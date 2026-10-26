"use client";

import { useActionState } from "react";
import { Field, Input, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateProfileAction } from "./actions";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action] = useActionState(updateProfileAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="max-w-md space-y-5" noValidate>
      <FormMessage state={state} />
      <Field id="fullName" label="Nome" error={e?.fullName}>
        <Input {...describedBy("fullName", e?.fullName)} defaultValue={fullName} autoComplete="name" required />
      </Field>
      <SubmitButton>Guardar</SubmitButton>
    </form>
  );
}
