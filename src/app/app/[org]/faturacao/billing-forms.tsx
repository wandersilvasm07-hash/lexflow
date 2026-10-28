"use client";

import { useActionState, type ReactNode } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { openPortalAction, startCheckoutAction } from "./actions";

export function CheckoutButton({ org, plan, children, variant = "primary" }: { org: string; plan: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const [state, action] = useActionState(startCheckoutAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton variant={variant} className="w-full" pendingLabel="A abrir o pagamento…">
        {children}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function PortalButton({ org }: { org: string }) {
  const [state, action] = useActionState(openPortalAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <SubmitButton variant="secondary" pendingLabel="A abrir…">
        Gerir subscrição e pagamentos
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
