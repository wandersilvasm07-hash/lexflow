"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInvitationAction } from "./actions";

export function AcceptInvitation({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitationAction, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel="A aceitar…">Aceitar e entrar no escritório</SubmitButton>
    </form>
  );
}
