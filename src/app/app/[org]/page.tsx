import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Panel, PanelHeader, cn } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getReport, periodRange, type Report } from "@/lib/data/reports";
import { getMarketingReport, type MarketingReport } from "@/lib/data/ads";
import { formatCents } from "@/lib/ads/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
] as const;

/** Indicadores do dashboard, de onde vêm e (quando já existem) o valor calculado. */
type Ads = MarketingReport["campaigns"];
const sum = (a: Ads, k: "spend_cents" | "contacts_attributed") => a.reduce((t, c) => t + c[k], 0);

const METRICS: { label: string; source: string; value?: (r: Report) => number; ads?: (a: Ads) => string | null }[] = [
  { label: "Novas conversas", source: "WhatsApp", value: (r) => r.conversations_new },
  { label: "Atendidas pela IA", source: "WhatsApp", value: (r) => r.conversations_ai_attended },
  { label: "Pendentes agora", source: "Caixa de entrada", value: (r) => r.conversations_pending_now },
  { label: "Encaminhadas para humanos", source: "Caixa de entrada", value: (r) => r.conversations_handed_off },
  { label: "Novos potenciais clientes", source: "Contactos", value: (r) => r.contacts_new },
  { label: "Consultas marcadas", source: "Agenda", value: (r) => r.appointments_booked },
  { label: "Campanhas ativas", source: "Campanhas", ads: (a) => String(a.filter((c) => c.status === "active").length) },
  { label: "Investimento publicitário", source: "Meta", ads: (a) => (a.length ? formatCents(sum(a, "spend_cents")) : null) },
  { label: "Contactos vindos de anúncios", source: "Contactos", ads: (a) => (a.length ? String(sum(a, "contacts_attributed")) : null) },
  {
    label: "Custo por contacto",
    source: "Calculado",
    ads: (a) => (sum(a, "contacts_attributed") ? formatCents(Math.round(sum(a, "spend_cents") / sum(a, "contacts_attributed"))) : null),
  },
];

export default async function DashboardPage({ params, searchParams }: PageProps<"/app/[org]">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  const period = PERIODS.find((p) => p.value === sp.periodo)?.value ?? "30";
  const supabase = await createClient();

  const range = periodRange(period as "7" | "30" | "90", ctx.org.timezone);
  const headCount = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id);
  const [members, invites, factors, report, services, rules, aiRuns, marketing] = await Promise.all([
    supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.org.id),
    can(ctx, "team.manage")
      ? supabase
          .from("invitations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.org.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
      : Promise.resolve({ count: 0 }),
    supabase.auth.mfa.listFactors(),
    can(ctx, "reports.read") ? getReport(ctx.org.id, range.from, range.to) : Promise.resolve(null),
    can(ctx, "calendar.read") ? headCount("services") : Promise.resolve({ count: 0 }),
    can(ctx, "calendar.read") ? headCount("availability_rules") : Promise.resolve({ count: 0 }),
    can(ctx, "conversations.read") ? headCount("agent_runs").neq("decision", "error") : Promise.resolve({ count: 0 }),
    can(ctx, "reports.read") || can(ctx, "campaigns.read")
      ? getMarketingReport(ctx.org.id, range.fromDay, range.toDay).catch(() => null)
      : Promise.resolve(null),
  ]);
  const adsRows = marketing?.campaigns ?? null;

  const profileComplete = Boolean(ctx.org.legal_name && ctx.org.nif && ctx.org.email);
  const teamStarted = (members.count ?? 0) > 1 || (invites.count ?? 0) > 0;
  const mfaOn = (factors.data?.totp ?? []).some((f) => f.status === "verified");
  const base = `/app/${ctx.org.slug}`;

  const steps = [
    {
      done: profileComplete,
      title: "Completar o perfil do escritório",
      text: "Denominação, NIF e email de contacto.",
      href: `${base}/configuracoes`,
      available: can(ctx, "org.update"),
    },
    {
      done: teamStarted,
      title: "Convidar a equipa",
      text: "Advogados, assistentes e marketing, cada um com o seu papel.",
      href: `${base}/equipa`,
      available: can(ctx, "team.manage"),
    },
    {
      done: mfaOn,
      title: "Ativar a verificação em dois passos",
      text: "Protege o acesso a dados de clientes.",
      href: "/app/conta/seguranca",
      available: true,
    },
    {
      done: (services.count ?? 0) > 0 && (rules.count ?? 0) > 0,
      title: "Configurar a agenda",
      text: "Serviços e horários de atendimento, para o assistente poder marcar consultas.",
      href: `${base}/agenda/definicoes`,
      available: can(ctx, "calendar.write"),
    },
    {
      done: (aiRuns.count ?? 0) > 0,
      title: "Testar o assistente",
      text: "Simule uma mensagem de um cliente e veja a resposta na caixa de entrada.",
      href: `${base}/whatsapp`,
      available: can(ctx, "whatsapp.manage"),
    },
    {
      done: false,
      title: "Ligar o WhatsApp Business real",
      text: "Precisa de conta Meta Business verificada e de um número dedicado.",
      href: `${base}/whatsapp`,
      available: can(ctx, "whatsapp.manage"),
    },
  ];

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{ctx.org.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Olá{ctx.user.fullName ? `, ${ctx.user.fullName.split(" ")[0]}` : ""}. Este é o ponto de
            situação do escritório.
          </p>
        </div>
        <nav aria-label="Período" className="flex rounded-md border border-line bg-surface p-0.5">
          {PERIODS.map((p) => (
            <Link
              key={p.value}
              href={`${base}?periodo=${p.value}`}
              aria-current={p.value === period ? "true" : undefined}
              className={cn(
                "rounded px-3 py-1 text-xs",
                p.value === period ? "bg-ink text-white" : "text-muted hover:text-ink",
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel>
          <PanelHeader
            title={`Indicadores · últimos ${period} dias`}
            description={
              report
                ? "Calculados a partir das conversas, contactos e agenda do escritório. O investimento vem da Meta; aparece “—” enquanto não houver campanhas publicadas."
                : "O seu papel não inclui relatórios. Os indicadores ficam visíveis para quem tem acesso a relatórios."
            }
          />
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            {METRICS.map((m, i) => (
              <div
                key={m.label}
                className={cn(
                  "border-line px-5 py-4",
                  i < METRICS.length - (METRICS.length % 2 === 0 ? 2 : 1) && "border-b",
                  i % 2 === 0 && "sm:border-r",
                )}
              >
                <dt className="text-sm text-muted">{m.label}</dt>
                <dd className="mt-1 flex items-baseline justify-between gap-2">
                  {report && m.value ? (
                    <span className="text-xl font-semibold tabular-nums">{m.value(report).toLocaleString("pt-PT")}</span>
                  ) : adsRows && m.ads && m.ads(adsRows) !== null ? (
                    <span className="text-xl font-semibold tabular-nums">{m.ads(adsRows)}</span>
                  ) : (
                    <span className="text-xl font-semibold text-line-strong" aria-label="Sem dados">
                      —
                    </span>
                  )}
                  <span className="text-xs text-muted">Origem: {m.source}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="self-start">
          <PanelHeader title="Primeiros passos" />
          <ol className="divide-y divide-line">
            {steps.map((s, i) => {
              const content = (
                <>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                      s.done ? "border-ok bg-ok text-white" : "border-line-strong text-muted",
                    )}
                    aria-hidden="true"
                  >
                    {s.done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", s.done && "text-muted line-through")}>
                      {s.title}
                    </span>
                    <span className="block text-xs text-muted">{s.text}</span>
                  </span>
                  {s.done ? <span className="sr-only">(concluído)</span> : null}
                </>
              );
              return (
                <li key={s.title}>
                  {s.href && s.available && !s.done ? (
                    <Link href={s.href} className="flex gap-3 px-5 py-3 hover:bg-paper">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-5 py-3">
                      {content}
                      {!s.available && !s.href ? (
                        <Badge className="ml-auto self-start">Em breve</Badge>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>
    </>
  );
}
