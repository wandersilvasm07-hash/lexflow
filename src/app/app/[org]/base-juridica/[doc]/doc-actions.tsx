"use client";

import { useActionState, useState } from "react";
import { Button, Panel, PanelHeader, Textarea } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/errors";
import type { KnowledgeStatus } from "@/lib/knowledge/categories";
import { newKnowledgeVersionAction, setKnowledgeStatusAction, updateKnowledgeMetaAction } from "../actions";
import { MetaFields, type MetaDefaults } from "../meta-fields";

type Transition = { to: KnowledgeStatus; label: string; variant: "primary" | "secondary" | "danger"; needs: "write" | "approve"; confirm?: string };

const TRANSITIONS: Record<KnowledgeStatus, Transition[]> = {
  draft: [
    { to: "in_review", label: "Enviar para revisão", variant: "primary", needs: "write" },
    { to: "archived", label: "Arquivar", variant: "secondary", needs: "write", confirm: "Arquivar este rascunho?" },
  ],
  in_review: [
    { to: "approved", label: "Aprovar", variant: "primary", needs: "approve" },
    { to: "draft", label: "Devolver a rascunho", variant: "secondary", needs: "write" },
    { to: "archived", label: "Arquivar", variant: "secondary", needs: "write", confirm: "Arquivar este documento?" },
  ],
  approved: [
    {
      to: "outdated",
      label: "Marcar como desatualizado",
      variant: "danger",
      needs: "approve",
      confirm: "O assistente deixa de usar este documento de imediato. Continuar?",
    },
    { to: "archived", label: "Arquivar", variant: "secondary", needs: "approve", confirm: "Arquivar? O assistente deixa de o usar." },
  ],
  outdated: [{ to: "archived", label: "Arquivar", variant: "secondary", needs: "write" }],
  archived: [],
};

function StatusButton({ org, id, t, missing }: { org: string; id: string; t: Transition; missing: string[] }) {
  const [state, run] = useActionState(setKnowledgeStatusAction, null);
  const blocked = t.to === "approved" && missing.length > 0;
  return (
    <form
      action={run}
      onSubmit={(ev) => {
        if (t.confirm && !window.confirm(t.confirm)) ev.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={t.to} />
      <SubmitButton variant={t.variant} disabled={blocked} pendingLabel="A atualizar…" className="w-full">
        {t.label}
      </SubmitButton>
      {blocked ? (
        <p className="text-xs text-muted">Para aprovar falta: {missing.join("; ")}.</p>
      ) : null}
      <FormMessage state={state} />
    </form>
  );
}

export function DocActions({
  org,
  id,
  status,
  canWrite,
  canApprove,
  missingForApproval,
}: {
  org: string;
  id: string;
  status: KnowledgeStatus;
  canWrite: boolean;
  canApprove: boolean;
  missingForApproval: string[];
}) {
  const [versionState, versionRun] = useActionState(newKnowledgeVersionAction, null);
  const transitions = TRANSITIONS[status].filter((t) => (t.needs === "approve" ? canApprove : canWrite));
  const canVersion = canWrite && (status === "approved" || status === "outdated");

  if (!transitions.length && !canVersion) {
    return <p className="px-5 py-4 text-sm text-muted">Sem ações disponíveis para o seu papel neste estado.</p>;
  }

  return (
    <div className="space-y-3 p-5">
      {transitions.map((t) => (
        <StatusButton key={t.to} org={org} id={id} t={t} missing={missingForApproval} />
      ))}
      {canVersion ? (
        <form action={versionRun} className="space-y-2 border-t border-line pt-3">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="secondary" className="w-full" pendingLabel="A criar…">
            Criar nova versão
          </SubmitButton>
          <p className="text-xs text-muted">
            Copia o documento para um rascunho. Esta versão continua em uso até a nova ser aprovada.
          </p>
          <FormMessage state={versionState} />
        </form>
      ) : null}
    </div>
  );
}

export function EditDocument({ org, id, defaults }: { org: string; id: string; defaults: MetaDefaults }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult | null, FormData>(updateKnowledgeMetaAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted">Pode corrigir metadados ou substituir o texto enquanto não estiver aprovado.</p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Editar
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-6 p-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <MetaFields d={defaults} e={e} />
      <div>
        <label htmlFor="text" className="block text-sm font-medium">
          Substituir o texto (opcional)
        </label>
        <p className="text-xs text-muted">Deixe vazio para manter o texto atual. Se colar texto, o documento é reindexado.</p>
        <Textarea id="text" name="text" rows={6} className="mt-1.5" />
      </div>
      <div className="flex gap-2">
        <SubmitButton>Guardar alterações</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Fechar
        </Button>
      </div>
    </form>
  );
}

export function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      {children}
    </Panel>
  );
}
