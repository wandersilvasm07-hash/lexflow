"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Alert, Field, Input, Select, Textarea, cn, describedBy } from "@/components/ui";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { CTAS, LANGUAGES, OBJECTIVES, SUPPORTED_DESTINATIONS, DESTINATIONS, formatCents } from "@/lib/ads/constants";
import type { ActionResult } from "@/lib/errors";
import {
  approveCampaignAction,
  connectMetaAccountAction,
  createCampaignAction,
  generatePlanAction,
  saveAdsAction,
  saveBudgetLimitsAction,
  suggestImprovementsAction,
  updateCampaignAction,
  uploadAdImageAction,
} from "./actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

const euros = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2).replace(".", ",") : "");

/** Botão que submete uma ação com campos escondidos (com confirmação opcional). */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  confirm,
  pendingLabel = "…",
}: {
  action: Action;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "ghost" | "secondary" | "danger" | "primary";
  confirm?: string;
  pendingLabel?: string;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      onSubmit={(ev) => {
        if (confirm && !window.confirm(confirm)) ev.preventDefault();
      }}
      className="inline-flex max-w-full flex-col gap-2"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- Passos 1–5

export type BasicsDefaults = {
  id?: string;
  name?: string;
  service_id?: string | null;
  service_label?: string;
  objective?: string;
  destination?: string;
  destination_url?: string | null;
  locations?: string[];
  languages?: string[];
  audience_notes?: string | null;
  daily_budget_cents?: number;
  total_budget_cents?: number;
  starts_on?: string;
  ends_on?: string | null;
};

export function CampaignBasicsForm({
  org,
  services,
  limits,
  defaults,
  minDate,
}: {
  org: string;
  services: { id: string; name: string }[];
  limits: { max_daily_cents: number; max_campaign_total_cents: number } | null;
  defaults?: BasicsDefaults;
  minDate: string;
}) {
  const editing = Boolean(defaults?.id);
  const [state, action] = useActionState(editing ? updateCampaignAction : createCampaignAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [destination, setDestination] = useState(defaults?.destination ?? "whatsapp");
  const [serviceLabel, setServiceLabel] = useState(defaults?.service_label ?? "");

  const step = (n: number, title: string, children: ReactNode, hint?: string) => (
    <fieldset className="grid gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_1fr]">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="text-xs font-medium text-muted">Passo {n}</p>
        <p className="font-semibold">{title}</p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="org" value={org} />
      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {step(
        1,
        "Serviço a divulgar",
        <>
          {services.length ? (
            <Field id="service_id" label="Serviço do escritório (opcional)">
              <Select
                {...describedBy("service_id")}
                defaultValue={defaults?.service_id ?? ""}
                onChange={(e) => {
                  const s = services.find((x) => x.id === e.target.value);
                  if (s) setServiceLabel(s.name);
                }}
              >
                <option value="">— Escrever livremente —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="service_label" label="Descrição do serviço" error={fe.service_label} hint="Ex.: Consulta sobre reagrupamento familiar.">
            <Input {...describedBy("service_label", fe.service_label, true)} value={serviceLabel} onChange={(e) => setServiceLabel(e.target.value)} required maxLength={200} />
          </Field>
          <Field id="name" label="Nome interno da campanha" error={fe.name}>
            <Input {...describedBy("name", fe.name)} defaultValue={defaults?.name ?? ""} required maxLength={120} placeholder="Reagrupamento — Lisboa — novembro" />
          </Field>
        </>,
      )}

      {step(
        2,
        "Objetivo",
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Objetivo">
          {(Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[]).map((k) => {
            const disabled = k === "leads";
            return (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-control border border-line-strong p-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink-faint",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input type="radio" name="objective" value={k} defaultChecked={(defaults?.objective ?? "messages") === k} disabled={disabled} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{OBJECTIVES[k].label}</span>
                  <span className="block text-xs text-muted">{OBJECTIVES[k].hint}</span>
                </span>
              </label>
            );
          })}
          {fe.objective ? <p className="text-xs text-seal sm:col-span-2">{fe.objective}</p> : null}
        </div>,
      )}

      {step(
        3,
        "Localização e idiomas",
        <>
          <Field id="locations" label="Localizações em Portugal" error={fe.locations} hint="Cidades ou distritos separados por vírgulas, ou “Portugal”.">
            <Input {...describedBy("locations", fe.locations, true)} defaultValue={(defaults?.locations ?? ["Lisboa"]).join(", ")} required />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">Idiomas dos anúncios</p>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(LANGUAGES) as (keyof typeof LANGUAGES)[]).map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="languages" value={l} defaultChecked={(defaults?.languages ?? ["pt"]).includes(l)} />
                  {LANGUAGES[l]}
                </label>
              ))}
            </div>
            {fe.languages ? <p className="mt-1 text-xs text-seal">{fe.languages}</p> : null}
          </div>
          <Field id="audience_notes" label="Notas sobre o público (opcional)" hint="Ex.: famílias que já vivem em Portugal. Nunca segmentamos por nacionalidade, etnia ou situação legal.">
            <Textarea {...describedBy("audience_notes", undefined, true)} defaultValue={defaults?.audience_notes ?? ""} rows={2} maxLength={1000} />
          </Field>
        </>,
      )}

      {step(
        4,
        "Orçamento",
        <>
          {limits ? (
            <p className="text-xs text-muted">
              Limites do escritório: até {formatCents(limits.max_daily_cents)}/dia e {formatCents(limits.max_campaign_total_cents)} por campanha.
            </p>
          ) : (
            <Alert tone="warn">O escritório ainda não definiu limites de orçamento. Pode preparar a campanha, mas só é aprovada depois de existirem limites.</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="daily" label="Orçamento diário (€)" error={fe.daily}>
              <Input {...describedBy("daily", fe.daily)} inputMode="decimal" defaultValue={euros(defaults?.daily_budget_cents) || "10,00"} required />
            </Field>
            <Field id="total" label="Orçamento total (€)" error={fe.total} hint="Gasto máximo desta campanha.">
              <Input {...describedBy("total", fe.total, true)} inputMode="decimal" defaultValue={euros(defaults?.total_budget_cents) || "150,00"} required />
            </Field>
            <Field id="starts_on" label="Início" error={fe.starts_on}>
              <Input {...describedBy("starts_on", fe.starts_on)} type="date" min={minDate} defaultValue={defaults?.starts_on ?? minDate} required />
            </Field>
            <Field id="ends_on" label="Fim (opcional)" error={fe.ends_on}>
              <Input {...describedBy("ends_on", fe.ends_on)} type="date" min={minDate} defaultValue={defaults?.ends_on ?? ""} />
            </Field>
          </div>
        </>,
        "A IA nunca altera estes valores.",
      )}

      {step(
        5,
        "Destino",
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(DESTINATIONS) as (keyof typeof DESTINATIONS)[]).map((k) => {
              const disabled = !SUPPORTED_DESTINATIONS.includes(k);
              return (
                <label
                  key={k}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-control border border-line-strong p-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink-faint",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input type="radio" name="destination" value={k} checked={destination === k} onChange={() => setDestination(k)} disabled={disabled} />
                  {DESTINATIONS[k]}
                  {disabled ? <span className="text-xs text-muted">(em breve)</span> : null}
                </label>
              );
            })}
          </div>
          {destination === "landing_page" ? (
            <Field id="destination_url" label="Endereço da página" error={fe.destination_url}>
              <Input {...describedBy("destination_url", fe.destination_url)} type="url" placeholder="https://" defaultValue={defaults?.destination_url ?? ""} required />
            </Field>
          ) : null}
        </>,
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <SubmitButton pendingLabel="A guardar…">{editing ? "Guardar alterações" : "Criar e continuar"}</SubmitButton>
        <p className="text-xs text-muted">
          {editing ? "Se a campanha estava aprovada, a aprovação é anulada." : "A seguir: plano e anúncios com IA, revisão, pré-visualização e aprovação."}
        </p>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- Passos 6–7

export function GeneratePlanButton({ org, id, again }: { org: string; id: string; again: boolean }) {
  return (
    <ActionButton
      action={generatePlanAction}
      fields={{ org, id }}
      variant={again ? "secondary" : "primary"}
      pendingLabel="A preparar o plano… (até 1 minuto)"
      confirm={again ? "Gerar de novo substitui os textos atuais dos anúncios (as imagens mantêm-se). Continuar?" : undefined}
    >
      {again ? "Gerar de novo com IA" : "Gerar plano e anúncios com IA"}
    </ActionButton>
  );
}

type AdRow = { position: number; primary_text: string; headline: string; description: string | null; cta: string; image_brief: string | null; image_path: string | null };

export function AdsEditor({ org, id, ads, editable }: { org: string; id: string; ads: AdRow[]; editable: boolean }) {
  const [state, action] = useActionState(saveAdsAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  if (!editable) return null;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="count" value={ads.length} />
      {ads.map((a, i) => (
        <fieldset key={a.position} className="space-y-3 rounded-control border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Anúncio {String.fromCharCode(65 + i)}</legend>
          <input type="hidden" name={`image_path_${i}`} value={a.image_path ?? ""} />
          <Field id={`primary_text_${i}`} label="Texto principal" error={fe[`primary_text_${i}`]} hint="Até 125 caracteres aparece completo no telemóvel.">
            <Textarea {...describedBy(`primary_text_${i}`, fe[`primary_text_${i}`], true)} defaultValue={a.primary_text} rows={3} maxLength={2000} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`headline_${i}`} label="Título" error={fe[`headline_${i}`]}>
              <Input {...describedBy(`headline_${i}`, fe[`headline_${i}`])} defaultValue={a.headline} maxLength={80} required />
            </Field>
            <Field id={`cta_${i}`} label="Botão" error={fe[`cta_${i}`]}>
              <Select {...describedBy(`cta_${i}`, fe[`cta_${i}`])} defaultValue={a.cta}>
                {(Object.keys(CTAS) as (keyof typeof CTAS)[]).map((k) => (
                  <option key={k} value={k}>
                    {CTAS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id={`description_${i}`} label="Descrição (opcional)">
            <Input {...describedBy(`description_${i}`)} defaultValue={a.description ?? ""} maxLength={200} />
          </Field>
          <Field id={`image_brief_${i}`} label="Briefing da imagem" hint="Para quem vai criar a imagem. Não é publicado.">
            <Textarea {...describedBy(`image_brief_${i}`, undefined, true)} defaultValue={a.image_brief ?? ""} rows={2} maxLength={1000} />
          </Field>
          {ads.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name={`remove_${i}`} value="1" /> Remover este anúncio ao guardar
            </label>
          ) : null}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="A guardar…">Guardar anúncios</SubmitButton>
        {ads.length < 5 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="add" value="1" /> Acrescentar uma variante
          </label>
        ) : null}
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function ImageUpload({ org, id, position }: { org: string; id: string; position: number }) {
  const [state, action] = useActionState(uploadAdImageAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value={position} />
      <label className="block text-xs text-muted">
        Imagem (JPG ou PNG, até 4 MB; ideal 1080×1080)
        <input type="file" name="image" accept="image/jpeg,image/png" required className="mt-1 block w-full text-xs" />
      </label>
      <SubmitButton size="sm" variant="secondary" pendingLabel="A carregar…">
        Carregar imagem
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- Passo 10

export function ApproveForm({ org, id, hash, daily, total, disabledReason }: { org: string; id: string; hash: string; daily: number; total: number; disabledReason: string | null }) {
  const [state, action] = useActionState(approveCampaignAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="hash" value={hash} />
      <input type="hidden" name="daily" value={daily} />
      <input type="hidden" name="total" value={total} />
      {[
        ["c_conteudo", "Revi o plano, os textos e as imagens de todos os anúncios na pré-visualização."],
        ["c_deontologia", "Confirmo que o conteúdo respeita as regras deontológicas da advocacia e as políticas de publicidade da Meta (a verificação automática não substitui esta confirmação)."],
        ["c_orcamento", `Autorizo um gasto máximo de ${formatCents(daily)} por dia e ${formatCents(total)} no total.`],
      ].map(([name, text]) => (
        <label key={name} className="flex gap-2 text-sm">
          <input type="checkbox" name={name} required className="mt-1" disabled={Boolean(disabledReason)} />
          <span>{text}</span>
        </label>
      ))}
      {disabledReason ? <Alert tone="warn">{disabledReason}</Alert> : null}
      <SubmitButton disabled={Boolean(disabledReason)} pendingLabel="A registar a aprovação…">
        Aprovar campanha
      </SubmitButton>
      <p className="text-xs text-muted">Fica registado quem aprovou, quando, o texto confirmado e a impressão digital exata do conteúdo e do orçamento.</p>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- Passo 13

export function Improvements({ org, id }: { org: string; id: string }) {
  const [state, action] = useActionState(suggestImprovementsAction, null);
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="id" value={id} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="A analisar os dados…">
          Propor melhorias com base nos dados
        </SubmitButton>
      </form>
      {state && state.ok && state.data ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">{state.message}</p>
          <div className="whitespace-pre-wrap rounded-control border border-line bg-paper p-4 text-sm">{state.data}</div>
        </div>
      ) : (
        <FormMessage state={state as ActionResult | null} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Limites e conta

export function BudgetLimitsForm({
  org,
  current,
}: {
  org: string;
  current: { max_daily_cents: number; max_campaign_total_cents: number; max_all_daily_cents: number; alert_pct: number } | null;
}) {
  const [state, action] = useActionState(saveBudgetLimitsAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="max_daily" label="Máximo diário por campanha (€)" error={fe.max_daily}>
          <Input {...describedBy("max_daily", fe.max_daily)} inputMode="decimal" defaultValue={euros(current?.max_daily_cents)} placeholder="20,00" required />
        </Field>
        <Field id="max_total" label="Máximo total por campanha (€)" error={fe.max_total}>
          <Input {...describedBy("max_total", fe.max_total)} inputMode="decimal" defaultValue={euros(current?.max_campaign_total_cents)} placeholder="300,00" required />
        </Field>
        <Field id="max_all_daily" label="Máximo diário de todas as campanhas juntas (€)" error={fe.max_all_daily} hint="Soma dos orçamentos diários das campanhas aprovadas ou ativas.">
          <Input {...describedBy("max_all_daily", fe.max_all_daily, true)} inputMode="decimal" defaultValue={euros(current?.max_all_daily_cents)} placeholder="40,00" required />
        </Field>
        <Field id="alert_pct" label="Alerta de consumo (%)" error={fe.alert_pct} hint="Aviso quando o gasto real chega a esta percentagem do total.">
          <Input {...describedBy("alert_pct", fe.alert_pct, true)} type="number" min={50} max={100} defaultValue={current?.alert_pct ?? 80} required />
        </Field>
      </div>
      <SubmitButton>Guardar limites</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ConnectMetaForm({ org, accounts, pages }: { org: string; accounts: { id: string; name: string; currency: string }[]; pages: { id: string; name: string }[] }) {
  const [state, action] = useActionState(connectMetaAccountAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org" value={org} />
      <Field id="account" label="Conta de anúncios">
        <Select {...describedBy("account")} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.id.replace("act_", "")}, {a.currency})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="page" label="Página do Facebook do escritório">
        <Select {...describedBy("page")} required>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="whatsapp" label="Número de WhatsApp dos anúncios (opcional)" error={fe.whatsapp} hint="O número ligado à Página, no formato +351…">
        <Input {...describedBy("whatsapp", fe.whatsapp, true)} placeholder="+351 9…" />
      </Field>
      <SubmitButton>Ligar esta conta</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
