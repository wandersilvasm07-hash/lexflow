"use client";

import { useActionState, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { CONTACT_STATUS } from "@/lib/crm";
import {
  addContactNoteAction,
  createContactAction,
  eraseContactAction,
  updateContactAction,
  updateContactStatusAction,
} from "./actions";

export function StatusSelect({ org, id, status }: { org: string; id: string; status: string }) {
  const [state, run] = useActionState(updateContactStatusAction, null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={run}>
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Select
        name="status"
        defaultValue={status}
        aria-label="Estado do contacto"
        className="h-8 w-52 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        {Object.entries(CONTACT_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {state && !state.ok ? <span className="mt-1 block text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}

type ContactFormValues = {
  id: string;
  full_name: string | null;
  email: string | null;
  locale: string | null;
  status: string;
  service_interest: string | null;
  assigned_to: string | null;
  next_action: string | null;
  next_action_at: string | null;
  tags: string[];
};

export function ContactForm({
  org,
  contact,
  members,
}: {
  org: string;
  contact: ContactFormValues;
  members: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(updateContactAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  const nextAt = contact.next_action_at ? contact.next_action_at.slice(0, 16) : "";
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={contact.id} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="full_name" label="Nome" error={e?.full_name}>
          <Input {...describedBy("full_name", e?.full_name)} defaultValue={contact.full_name ?? ""} />
        </Field>
        <Field id="email" label="Email" error={e?.email}>
          <Input {...describedBy("email", e?.email)} type="email" defaultValue={contact.email ?? ""} />
        </Field>
        <Field id="status" label="Estado" error={e?.status}>
          <Select {...describedBy("status", e?.status)} defaultValue={contact.status}>
            {Object.entries(CONTACT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="assigned_to" label="Responsável" error={e?.assigned_to}>
          <Select {...describedBy("assigned_to", e?.assigned_to)} defaultValue={contact.assigned_to ?? ""}>
            <option value="">Sem responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="service_interest" label="Serviço pretendido" error={e?.service_interest}>
          <Input {...describedBy("service_interest", e?.service_interest)} defaultValue={contact.service_interest ?? ""} />
        </Field>
        <Field id="locale" label="Idioma" hint="Ex.: pt-PT, pt-BR, en, fr." error={e?.locale}>
          <Input {...describedBy("locale", e?.locale, true)} defaultValue={contact.locale ?? ""} />
        </Field>
        <Field id="next_action" label="Próxima ação" error={e?.next_action}>
          <Input {...describedBy("next_action", e?.next_action)} defaultValue={contact.next_action ?? ""} placeholder="Ex.: enviar orçamento" />
        </Field>
        <Field id="next_action_at" label="Até" error={e?.next_action_at}>
          <Input {...describedBy("next_action_at", e?.next_action_at)} type="datetime-local" defaultValue={nextAt} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="tags" label="Etiquetas" hint="Separadas por vírgula." error={e?.tags}>
            <Input {...describedBy("tags", e?.tags, true)} defaultValue={contact.tags.join(", ")} />
          </Field>
        </div>
      </div>
      <SubmitButton>Guardar alterações</SubmitButton>
    </form>
  );
}

export function NewContactForm({ org }: { org: string }) {
  const [state, action] = useActionState(createContactAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state && !state.ok && !e ? <FormMessage state={state} /> : null}
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="full_name" label="Nome" error={e?.full_name}>
            <Input {...describedBy("full_name", e?.full_name)} autoFocus required />
          </Field>
        </div>
        <Field id="phone_e164" label="Telefone" hint="Formato internacional, ex.: +351912345678." error={e?.phone_e164}>
          <Input {...describedBy("phone_e164", e?.phone_e164, true)} type="tel" />
        </Field>
        <Field id="email" label="Email" error={e?.email}>
          <Input {...describedBy("email", e?.email)} type="email" />
        </Field>
        <Field id="source" label="Origem" error={e?.source}>
          <Select {...describedBy("source", e?.source)} defaultValue="manual">
            <option value="manual">Manual</option>
            <option value="referral">Recomendação</option>
            <option value="form">Formulário</option>
          </Select>
        </Field>
        <Field id="service_interest" label="Serviço pretendido" error={e?.service_interest}>
          <Input {...describedBy("service_interest", e?.service_interest)} />
        </Field>
      </div>
      <SubmitButton>Criar contacto</SubmitButton>
    </form>
  );
}

export function NoteForm({ org, id }: { org: string; id: string }) {
  const [state, action] = useActionState(addContactNoteAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await action(fd);
        formRef.current?.reset();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <label htmlFor="note-body" className="sr-only">
        Nova nota
      </label>
      <Textarea id="note-body" name="body" rows={2} placeholder="Nota interna (visível só para a equipa de atendimento)" />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm">Guardar nota</SubmitButton>
        {state && !state.ok ? <span className="text-xs text-seal">{state.error}</span> : null}
      </div>
    </form>
  );
}

export function EraseContact({ org, id }: { org: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(eraseContactAction, null);
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-seal hover:bg-seal-faint" onClick={() => setOpen(true)}>
        Eliminar dados do contacto
      </Button>
    );
  }
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!window.confirm("Elimina o contacto, conversas, mensagens, notas e marcações. Não pode ser desfeito. Continuar?")) {
          ev.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Field id="reason" label="Motivo (fica no registo de atividade)" error={state && !state.ok ? state.fieldErrors?.reason : undefined}>
        <Input id="reason" name="reason" placeholder="Ex.: pedido do titular por email de 27/10" />
      </Field>
      <div className="flex gap-2">
        <SubmitButton variant="danger" size="sm" pendingLabel="A eliminar…">
          Eliminar definitivamente
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
