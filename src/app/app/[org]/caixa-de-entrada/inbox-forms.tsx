"use client";

import { useActionState, useEffect, useRef } from "react";
import { Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/errors";
import {
  addNoteAction,
  assignAction,
  returnToAiAction,
  sendReplyAction,
  setStatusAction,
  takeOverAction,
} from "./actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

function Small({ action, org, id, extra, children, variant = "secondary" }: {
  action: Action;
  org: string;
  id: string;
  extra?: Record<string, string>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="inline-flex flex-col items-end">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton size="sm" variant={variant} pendingLabel="…">
        {children}
      </SubmitButton>
      {state && !state.ok ? <span role="alert" className="mt-1 max-w-56 text-right text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}

export function ConversationActions({
  org,
  id,
  mode,
  status,
  canReply,
  canAssign,
}: {
  org: string;
  id: string;
  mode: "ai" | "human";
  status: "open" | "waiting" | "closed";
  canReply: boolean;
  canAssign: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canReply && mode === "ai" && status !== "closed" ? (
        <Small action={takeOverAction} org={org} id={id} variant="primary">
          Assumir conversa
        </Small>
      ) : null}
      {canAssign && mode === "human" && status !== "closed" ? (
        <Small action={returnToAiAction} org={org} id={id}>
          Devolver ao assistente
        </Small>
      ) : null}
      {canReply ? (
        status === "closed" ? (
          <Small action={setStatusAction} org={org} id={id} extra={{ status: "open" }} variant="ghost">
            Reabrir
          </Small>
        ) : (
          <Small action={setStatusAction} org={org} id={id} extra={{ status: "closed" }} variant="ghost">
            Fechar
          </Small>
        )
      ) : null}
    </div>
  );
}

export function AssignSelect({
  org,
  id,
  current,
  options,
}: {
  org: string;
  id: string;
  current: string | null;
  options: { id: string; name: string }[];
}) {
  const [state, run] = useActionState(assignAction, null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={run} className="flex items-center gap-2">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Select
        name="user"
        defaultValue={current ?? ""}
        aria-label="Responsável"
        className="h-8 w-56 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">Sem responsável</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      {state && !state.ok ? <span className="text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}

function useResetOnSuccess(state: ActionResult | null) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function ReplyForm({ org, id }: { org: string; id: string }) {
  const [state, run] = useActionState(sendReplyAction, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={run} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Textarea name="body" rows={3} placeholder="Escreva a resposta ao contacto…" aria-label="Resposta" required />
      <div className="flex items-center justify-between gap-3">
        <span className={state && !state.ok ? "text-xs text-seal" : "text-xs text-muted"} role={state && !state.ok ? "alert" : undefined}>
          {state && !state.ok ? state.error : state?.ok && state.message ? state.message : "Enviada pelo WhatsApp do escritório."}
        </span>
        <SubmitButton size="sm" pendingLabel="A enviar…">
          Enviar
        </SubmitButton>
      </div>
    </form>
  );
}

export function NoteForm({ org, id }: { org: string; id: string }) {
  const [state, run] = useActionState(addNoteAction, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={run} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Textarea name="body" rows={2} placeholder="Nota interna para a equipa…" aria-label="Nota interna" required />
      <div className="flex items-center justify-between gap-3">
        {state && !state.ok ? <span role="alert" className="text-xs text-seal">{state.error}</span> : <span />}
        <SubmitButton size="sm" variant="secondary" pendingLabel="A guardar…">
          Adicionar nota
        </SubmitButton>
      </div>
    </form>
  );
}
