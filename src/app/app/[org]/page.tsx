import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Panel, PanelHeader, cn } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
] as const;

/** Indicadores do dashboard e o módulo que os alimenta. */
const METRICS: { label: string; source: string }[] = [
  { label: "Novas conversas", source: "WhatsApp" },
  { label: "Atendidas pela IA", source: "WhatsApp" },
  { label: "Pendentes", source: "Caixa de entrada" },
  { label: "Encaminhadas para humanos", source: "Caixa de entrada" },
  { label: "Novos potenciais clientes", source: "Contactos" },
  { label: "Consultas marcadas", source: "Agenda" },
  { label: "Campanhas ativas", source: "Meta Ads" },
  { label: "Investimento publicitário", source: "Meta Ads" },
  { label: "Contactos vindos de anúncios", source: "Meta Ads" },
  { label: "Custo por contacto", source: "Meta Ads + Contactos" },
];

export default async function DashboardPage({ params, searchParams }: PageProps<"/app/[org]">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  const period = PERIODS.find((p) => p.value === sp.periodo)?.value ?? "30";
  const supabase = await createClient();

  const [members, invites, factors] = await Promise.all([
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
  ]);

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
      done: false,
      title: "Ligar o WhatsApp Business",
      text: "Disponível na fase 2.",
      href: null,
      available: false,
    },
    {
      done: false,
      title: "Rever a base jurídica",
      text: "Disponível na fase 3.",
      href: null,
      available: false,
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
            description="Os valores aparecem quando os módulos de origem estiverem ligados. Não mostramos números de demonstração."
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
                  <span className="text-xl font-semibold text-line-strong" aria-label="Sem dados">
                    —
                  </span>
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
