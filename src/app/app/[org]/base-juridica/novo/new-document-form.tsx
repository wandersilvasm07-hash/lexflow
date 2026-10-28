"use client";

import { useActionState, useState } from "react";
import { Field, Input, Textarea, cn, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { createKnowledgeDocumentAction } from "../actions";
import { MetaFields } from "../meta-fields";

type Method = "file" | "url" | "text";

const METHODS: { key: Method; label: string; hint: string }[] = [
  { key: "file", label: "Ficheiro", hint: "PDF, DOCX, HTML ou texto, até 4 MB." },
  { key: "url", label: "Fonte oficial", hint: "Endereço de uma página ou PDF oficial." },
  { key: "text", label: "Colar texto", hint: "Notas internas ou excertos." },
];

export function NewDocumentForm({ org, canCommon }: { org: string; canCommon: boolean }) {
  const [state, action] = useActionState(createKnowledgeDocumentAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  const [method, setMethod] = useState<Method>("file");

  return (
    <form action={action} className="space-y-8" noValidate>
      {state && !state.ok ? <FormMessage state={state} /> : null}
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="method" value={method} />

      <fieldset>
        <legend className="text-base font-semibold">Conteúdo</legend>
        <div role="radiogroup" aria-label="Origem do conteúdo" className="mt-3 grid gap-2 sm:grid-cols-3">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={method === m.key}
              onClick={() => setMethod(m.key)}
              className={cn(
                "rounded-control border px-4 py-3 text-left",
                method === m.key ? "border-ink bg-ink-faint" : "border-line-strong bg-surface hover:border-muted",
              )}
            >
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-xs text-muted">{m.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          {method === "file" ? (
            <Field id="file" label="Ficheiro" error={e?.file}>
              <input
                {...describedBy("file", e?.file)}
                type="file"
                accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain"
                className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm"
              />
            </Field>
          ) : method === "url" ? (
            <Field
              id="import_url"
              label="Endereço da fonte oficial"
              hint="Aceites: Diário da República, AIMA, portais gov.pt, MNE/vistos, Justiça, Finanças, Segurança Social, EUR-Lex, DGSI."
              error={e?.import_url}
            >
              <Input {...describedBy("import_url", e?.import_url, true)} type="url" placeholder="https://" />
            </Field>
          ) : (
            <Field id="text" label="Texto" error={e?.text}>
              <Textarea {...describedBy("text", e?.text)} rows={10} />
            </Field>
          )}
        </div>
      </fieldset>

      {canCommon ? (
        <fieldset>
          <legend className="text-base font-semibold">Onde fica</legend>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="scope" value="private" defaultChecked className="mt-1 accent-ink" />
              <span>
                Só deste escritório <span className="text-muted">— nunca aparece a outros escritórios.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="scope" value="common" className="mt-1 accent-ink" />
              <span>
                Base comum <span className="text-muted">— partilhada por todos os escritórios depois de aprovada.</span>
              </span>
            </label>
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="scope" value="private" />
      )}

      <fieldset>
        <legend className="text-base font-semibold">Identificação e vigência</legend>
        <p className="mt-1 text-sm text-muted">
          Pode preencher as datas agora ou antes de aprovar. Sem fonte e sem datas de verificação e revisão, o documento
          não pode ser aprovado.
        </p>
        <div className="mt-4">
          <MetaFields e={e} />
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <SubmitButton size="lg" pendingLabel="A importar…">
          Importar como rascunho
        </SubmitButton>
        <p className="text-xs text-muted">O assistente só usa o documento depois de aprovado.</p>
      </div>
    </form>
  );
}
