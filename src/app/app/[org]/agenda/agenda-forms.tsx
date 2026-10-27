"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, Textarea, cn, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { SERVICE_MODE, WEEKDAYS } from "@/lib/crm";
import type { ActionResult } from "@/lib/errors";
import {
  addBlockAction,
  addRuleAction,
  bookAppointmentAction,
  deleteBlockAction,
  deleteRuleAction,
  saveServiceAction,
  setAppointmentStatusAction,
} from "./actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

/** Botão simples que submete uma ação com campos escondidos. */
function ActionButton({
  action,
  fields,
  children,
  variant = "ghost",
  confirm,
}: {
  action: Action;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "ghost" | "secondary" | "danger" | "primary";
  confirm?: string;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      onSubmit={(ev) => {
        if (confirm && !window.confirm(confirm)) ev.preventDefault();
      }}
      className="inline-flex flex-col"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size="sm" pendingLabel="…">
        {children}
      </SubmitButton>
      {state && !state.ok ? <span role="alert" className="mt-1 max-w-48 text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}

export function AppointmentActions({
  org,
  id,
  status,
  started,
}: {
  org: string;
  id: string;
  status: string;
  started: boolean;
}) {
  if (!["booked", "confirmed"].includes(status)) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {status === "booked" && !started ? (
        <ActionButton action={setAppointmentStatusAction} fields={{ org, id, status: "confirmed" }}>
          Confirmar
        </ActionButton>
      ) : null}
      {started ? (
        <>
          <ActionButton action={setAppointmentStatusAction} fields={{ org, id, status: "completed" }}>
            Realizada
          </ActionButton>
          <ActionButton action={setAppointmentStatusAction} fields={{ org, id, status: "no_show" }}>
            Faltou
          </ActionButton>
        </>
      ) : null}
      <ActionButton
        action={setAppointmentStatusAction}
        fields={{ org, id, status: "cancelled" }}
        confirm="Cancelar esta marcação? O horário fica livre."
      >
        Cancelar
      </ActionButton>
    </div>
  );
}

// ------------------------------------------------------------------ Marcar

export type SlotGroup = { day: string; label: string; slots: { value: string; time: string; professional: string }[] };

export function BookForm({
  org,
  contact,
  service,
  groups,
  professionals,
  defaultDay,
}: {
  org: string;
  contact: string;
  service: string;
  groups: SlotGroup[];
  professionals: { id: string; name: string }[];
  defaultDay: string;
}) {
  const [state, action] = useActionState(bookAppointmentAction, null);
  const [outside, setOutside] = useState(false);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="contact" value={contact} />
      <input type="hidden" name="service" value={service} />
      <input type="hidden" name="outside" value={outside ? "1" : "0"} />

      {!outside ? (
        groups.length ? (
          <fieldset>
            <legend className="text-base font-semibold">Horários livres</legend>
            {e?.slot ? <p className="mt-1 text-xs text-seal">{e.slot}</p> : null}
            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <div key={g.day}>
                  <p className="text-sm font-medium capitalize">{g.label}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {g.slots.map((s) => (
                      <label
                        key={s.value}
                        className="cursor-pointer rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white"
                      >
                        <input type="radio" name="slot" value={s.value} className="sr-only" required />
                        {s.time}
                        {professionals.length > 1 ? <span className="ml-1 text-xs opacity-75">{s.professional}</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="rounded-md border border-line bg-paper px-4 py-3 text-sm text-muted">
            Não há horários livres nestes dias. Escolha outro dia, outro profissional, ou marque fora do horário.
          </p>
        )
      ) : (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-base font-semibold">Marcação fora do horário configurado</legend>
          <Field id="manual_professional" label="Profissional">
            <Select id="manual_professional" name="manual_professional">
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="manual_day" label="Dia">
            <Input id="manual_day" name="manual_day" type="date" defaultValue={defaultDay} />
          </Field>
          <Field id="manual_time" label="Hora">
            <Input id="manual_time" name="manual_time" type="time" step={900} />
          </Field>
          <p className="text-xs text-muted sm:col-span-3">
            Continua a não ser possível marcar por cima de outra consulta do mesmo profissional.
          </p>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mode" label="Formato">
          <Select id="mode" name="mode" defaultValue="">
            <option value="">Por definir</option>
            <option value="presencial">Presencial</option>
            <option value="online">Online</option>
          </Select>
        </Field>
        <Field id="notes" label="Notas para a equipa (opcional)">
          <Textarea id="notes" name="notes" rows={1} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="A marcar…">Marcar consulta</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOutside((v) => !v)}>
          {outside ? "Escolher dos horários livres" : "Marcar fora do horário"}
        </Button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------- Definições

export function ServiceForm({
  org,
  service,
}: {
  org: string;
  service?: {
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    mode: keyof typeof SERVICE_MODE;
    min_notice_minutes: number;
    bookable_by_ai: boolean;
    active: boolean;
  };
}) {
  const [state, action] = useActionState(saveServiceAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  const p = service?.id ?? "novo";
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${p}-name`} label="Nome" error={e?.name}>
          <Input {...describedBy(`${p}-name`, e?.name)} name="name" defaultValue={service?.name} placeholder="Ex.: Consulta de imigração" />
        </Field>
        <Field id={`${p}-duration`} label="Duração (minutos)" error={e?.duration_minutes}>
          <Input
            {...describedBy(`${p}-duration`, e?.duration_minutes)}
            name="duration_minutes"
            type="number"
            min={15}
            max={240}
            step={15}
            defaultValue={service?.duration_minutes ?? 60}
          />
        </Field>
        <Field id={`${p}-mode`} label="Formato" error={e?.mode}>
          <Select {...describedBy(`${p}-mode`, e?.mode)} name="mode" defaultValue={service?.mode ?? "presencial_ou_online"}>
            {Object.entries(SERVICE_MODE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}-notice`} label="Antecedência mínima (horas)" hint="Evita marcações em cima da hora." error={e?.min_notice_hours}>
          <Input
            {...describedBy(`${p}-notice`, e?.min_notice_hours, true)}
            name="min_notice_hours"
            type="number"
            min={0}
            max={336}
            defaultValue={service ? service.min_notice_minutes / 60 : 2}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id={`${p}-description`} label="Descrição (opcional)" error={e?.description}>
            <Input {...describedBy(`${p}-description`, e?.description)} name="description" defaultValue={service?.description ?? ""} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="bookable_by_ai" defaultChecked={service?.bookable_by_ai ?? true} className="accent-ink" />
          O assistente pode marcar este serviço
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={service?.active ?? true} className="accent-ink" />
          Ativo
        </label>
      </div>
      <SubmitButton size="sm">{service ? "Guardar" : "Criar serviço"}</SubmitButton>
    </form>
  );
}

export function RuleForm({ org, user }: { org: string; user: string }) {
  const [state, action] = useActionState(addRuleAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="user" value={user} />
      <fieldset>
        <legend className="text-sm font-medium">Dias</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((d, i) => (
            <label
              key={d}
              className={cn(
                "cursor-pointer rounded-md border border-line-strong px-2.5 py-1 text-xs has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white",
              )}
            >
              <input type="checkbox" name="weekday" value={i + 1} defaultChecked={i < 5} className="sr-only" />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`start-${user}`} label="Das">
          <Input id={`start-${user}`} name="start" type="time" defaultValue="09:30" step={900} className="w-32" />
        </Field>
        <Field id={`end-${user}`} label="Às">
          <Input id={`end-${user}`} name="end" type="time" defaultValue="13:00" step={900} className="w-32" />
        </Field>
        <SubmitButton size="sm" className="mb-0.5">
          Adicionar período
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteRule({ org, id }: { org: string; id: string }) {
  return (
    <ActionButton action={deleteRuleAction} fields={{ org, id }}>
      Remover
    </ActionButton>
  );
}

export function BlockForm({ org, users, me }: { org: string; users: { id: string; name: string }[]; me: string }) {
  const [state, action] = useActionState(addBlockAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="block-user" label="Quem">
          <Select id="block-user" name="user" defaultValue={me}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="block-reason" label="Motivo (opcional)">
          <Input id="block-reason" name="reason" placeholder="Ex.: férias, tribunal" />
        </Field>
        <Field id="block-from" label="De">
          <div className="flex gap-2">
            <Input id="block-from" name="from" type="date" />
            <Input name="from_time" type="time" aria-label="Hora de início (opcional)" className="w-28" />
          </div>
        </Field>
        <Field id="block-to" label="Até">
          <div className="flex gap-2">
            <Input id="block-to" name="to" type="date" />
            <Input name="to_time" type="time" aria-label="Hora de fim (opcional)" className="w-28" />
          </div>
        </Field>
      </div>
      <p className="text-xs text-muted">Sem horas, a ausência ocupa os dias inteiros.</p>
      <SubmitButton size="sm">Registar ausência</SubmitButton>
    </form>
  );
}

export function DeleteBlock({ org, id }: { org: string; id: string }) {
  return (
    <ActionButton action={deleteBlockAction} fields={{ org, id }}>
      Remover
    </ActionButton>
  );
}
