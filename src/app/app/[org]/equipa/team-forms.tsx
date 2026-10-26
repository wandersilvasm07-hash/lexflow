"use client";

import { Copy } from "lucide-react";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Field, Input, Select, describedBy, cn } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { ORG_ROLES, type OrgRole } from "@/lib/authz/permissions";
import type { ActionResult } from "@/lib/errors";
import { t } from "@/i18n";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  setStatusAction,
} from "./actions";

/* --------------------------------------------------------------- Convite */

export function InviteForm({ org }: { org: string }) {
  const [state, action] = useActionState(inviteMemberAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const [role, setRole] = useState<OrgRole>("lawyer");

  return (
    <div className="space-y-4">
      {state?.ok && state.data ? <InviteLink email={state.data.email} link={state.data.link} /> : null}
      {state && !state.ok ? <FormMessage state={state} /> : null}
      <form action={action} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-start" noValidate>
        <input type="hidden" name="org" value={org} />
        <Field id="email" label="Email" error={errors?.email}>
          <Input {...describedBy("email", errors?.email)} type="email" autoComplete="off" required />
        </Field>
        <Field id="role" label="Papel" hint={t.roleDescriptions[role]} error={errors?.role}>
          <Select
            {...describedBy("role", errors?.role, true)}
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton className="sm:mt-[1.65rem]" pendingLabel="A criar…">
          Criar convite
        </SubmitButton>
      </form>
    </div>
  );
}

function InviteLink({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="ok" title={`Convite criado para ${email}`}>
      <p>
        O envio automático por email ainda não está ativo. Copie este link e envie-o à pessoa por
        um canal seguro. É válido durante 7 dias e só funciona com a conta de {email}. Por
        segurança, não voltará a ser mostrado.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={link}
          aria-label="Link do convite"
          className="h-9 min-w-0 flex-1 rounded border border-ok/30 bg-surface px-2 text-xs text-text"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </Alert>
  );
}

/* ------------------------------------------------------- Ações por linha */

type RowAction = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

function RowForm({
  action,
  org,
  id,
  confirm,
  children,
  extra,
}: {
  action: RowAction;
  org: string;
  id: string;
  confirm?: string;
  children: ReactNode;
  extra?: Record<string, string>;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      {state && !state.ok ? (
        <span role="alert" className="mt-1 max-w-56 text-right text-xs text-seal">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function RoleSelect({
  org,
  membershipId,
  role,
  disabled,
}: {
  org: string;
  membershipId: string;
  role: OrgRole;
  disabled?: boolean;
}) {
  const [state, run] = useActionState(changeRoleAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={run}>
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={membershipId} />
      <Select
        name="role"
        defaultValue={role}
        disabled={disabled}
        aria-label="Papel"
        className="h-8 w-48 text-xs"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>
            {t.roles[r]}
          </option>
        ))}
      </Select>
      {state && !state.ok ? (
        <span role="alert" className="mt-1 block text-xs text-seal">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function MemberActions({
  org,
  membershipId,
  status,
  isSelf,
}: {
  org: string;
  membershipId: string;
  status: "active" | "suspended";
  isSelf: boolean;
}) {
  return (
    <div className="flex justify-end gap-1">
      <RowForm
        action={setStatusAction}
        org={org}
        id={membershipId}
        extra={{ status: status === "active" ? "suspended" : "active" }}
        confirm={status === "active" ? "Suspender o acesso deste membro? Deixa de conseguir entrar no escritório." : undefined}
      >
        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
          {status === "active" ? "Suspender" : "Reativar"}
        </SubmitButton>
      </RowForm>
      <RowForm
        action={removeMemberAction}
        org={org}
        id={membershipId}
        confirm={
          isSelf
            ? "Sair deste escritório? Perde o acesso imediatamente."
            : "Remover este membro do escritório? Perde o acesso imediatamente."
        }
      >
        <SubmitButton variant="ghost" size="sm" className="text-seal hover:bg-seal-faint" pendingLabel="…">
          {isSelf ? "Sair" : "Remover"}
        </SubmitButton>
      </RowForm>
    </div>
  );
}

export function RevokeInvitation({ org, id }: { org: string; id: string }) {
  return (
    <RowForm action={revokeInvitationAction} org={org} id={id} confirm="Cancelar este convite? O link deixa de funcionar.">
      <SubmitButton variant="ghost" size="sm" className={cn("text-seal hover:bg-seal-faint")} pendingLabel="…">
        Cancelar
      </SubmitButton>
    </RowForm>
  );
}
