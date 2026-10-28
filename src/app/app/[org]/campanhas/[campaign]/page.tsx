import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, ButtonLink, Panel, PanelHeader, Table, Td, Th, cn } from "@/components/ui";
import { hasBlocking } from "@/lib/ads/compliance";
import { CAMPAIGN_STATUS, CTAS, DESTINATIONS, EVENT_LABELS, LANGUAGES, OBJECTIVES, formatCents, type Cta } from "@/lib/ads/constants";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getAdAccount, getBudgetSettings, getCampaign, signedImageUrls } from "@/lib/data/ads";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  archiveCampaignAction,
  changeStatusAction,
  publishCampaignAction,
  reviewComplianceAction,
  revokeApprovalAction,
  syncCampaignAction,
} from "../actions";
import { ActionButton, AdsEditor, ApproveForm, GeneratePlanButton, ImageUpload, Improvements } from "../campaign-forms";

export const metadata: Metadata = { title: "Campanha" };

const EDITABLE = ["draft", "approved", "failed", "rejected"];

function Section({ n, title, description, children, muted }: { n: string; title: string; description?: string; children: ReactNode; muted?: boolean }) {
  return (
    <Panel className={cn(muted && "opacity-70")}>
      <PanelHeader title={`${n} · ${title}`} description={description} />
      <div className="p-5">{children}</div>
    </Panel>
  );
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/app/[org]/campanhas/[campaign]">) {
  const [{ org: slug, campaign: id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.read")) return <PermissionDenied />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [data, limits, account] = await Promise.all([getCampaign(ctx.org.id, id), getBudgetSettings(ctx.org.id), getAdAccount(ctx.org.id)]);
  if (!data) notFound();
  const { campaign: c, ads, events, metrics, contentHash, lastApproval } = data;
  const images = await signedImageUrls(ads.map((a) => a.image_path));

  const canWrite = can(ctx, "campaigns.write");
  const canPublish = can(ctx, "campaigns.publish");
  const editable = canWrite && EDITABLE.includes(c.status);
  const st = CAMPAIGN_STATUS[c.status];
  const plan = c.plan ?? {};
  const issues = c.compliance?.issues ?? [];
  const reviewed = Boolean(c.compliance_hash && c.compliance_hash === contentHash);
  const blocking = hasBlocking({ issues });
  const published = ["publishing", "active", "paused", "ended"].includes(c.status);
  const base = `/app/${slug}/campanhas/${id}`;

  const approvalBlock = !limits
    ? "O escritório ainda não definiu limites de orçamento."
    : !ads.length
      ? "Gere ou escreva primeiro os anúncios."
      : ads.some((a) => !a.image_path)
        ? "Todos os anúncios precisam de imagem."
        : !reviewed
          ? "Falta a revisão de conformidade do conteúdo atual."
          : blocking
            ? "A revisão de conformidade encontrou problemas a corrigir."
            : c.daily_budget_cents > limits.max_daily_cents || c.total_budget_cents > limits.max_campaign_total_cents
              ? "O orçamento ultrapassa os limites do escritório."
              : null;

  const totals = metrics.reduce(
    (a, m) => ({
      impressions: a.impressions + m.impressions,
      clicks: a.clicks + m.clicks,
      conversations: a.conversations + m.conversations_started,
      spend: a.spend + m.spend_cents,
    }),
    { impressions: 0, clicks: 0, conversations: 0, spend: 0 },
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/app/${slug}/campanhas`} className="text-xs text-muted hover:underline">
            ← Campanhas
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={st.tone}>{st.label}</Badge>
            {c.external_status ? <span className="text-xs text-muted">Meta: {c.external_status}</span> : null}
            {c.last_synced_at ? <span className="text-xs text-muted">· confirmado em {formatDateTime(c.last_synced_at)}</span> : null}
          </div>
        </div>
        {canWrite && ["draft", "rejected", "ended"].includes(c.status) ? (
          <ActionButton action={archiveCampaignAction} fields={{ org: slug, id }} variant="ghost" confirm="Arquivar esta campanha?">
            Arquivar
          </ActionButton>
        ) : null}
      </div>

      {sp.criada ? <Alert tone="ok" className="mb-4">Campanha criada. Agora gere o plano e os anúncios com a IA.</Alert> : null}
      {sp.guardada ? <Alert tone="ok" className="mb-4">Alterações guardadas.</Alert> : null}
      {c.last_error && ["failed", "rejected"].includes(c.status) ? (
        <Alert tone="seal" className="mb-4" title={c.status === "rejected" ? "A Meta rejeitou a campanha" : "A publicação falhou"}>
          {c.last_error}
        </Alert>
      ) : null}

      <div className="space-y-6">
        <Section n="1–5" title="Serviço, objetivo, público, orçamento e destino">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Serviço</dt><dd className="font-medium">{c.service_label}</dd></div>
            <div><dt className="text-muted">Objetivo</dt><dd>{OBJECTIVES[c.objective].label}</dd></div>
            <div><dt className="text-muted">Destino</dt><dd>{DESTINATIONS[c.destination]}{c.destination_url ? <span className="block truncate text-xs text-muted">{c.destination_url}</span> : null}</dd></div>
            <div><dt className="text-muted">Localizações</dt><dd>{c.locations.join(", ")}</dd></div>
            <div><dt className="text-muted">Idiomas</dt><dd>{c.languages.map((l) => LANGUAGES[l as keyof typeof LANGUAGES] ?? l).join(", ")}</dd></div>
            <div><dt className="text-muted">Período</dt><dd>{formatDate(c.starts_on)}{c.ends_on ? ` – ${formatDate(c.ends_on)}` : " · sem fim (até ao total)"}</dd></div>
            <div><dt className="text-muted">Orçamento diário</dt><dd className="font-medium tabular-nums">{formatCents(c.daily_budget_cents)}</dd></div>
            <div><dt className="text-muted">Orçamento total</dt><dd className="font-medium tabular-nums">{formatCents(c.total_budget_cents)}</dd></div>
            {c.audience_notes ? <div className="sm:col-span-3"><dt className="text-muted">Notas sobre o público</dt><dd>{c.audience_notes}</dd></div> : null}
          </dl>
          {editable ? (
            <div className="mt-4">
              <ButtonLink href={`${base}/editar`} variant="secondary" size="sm">Alterar</ButtonLink>
            </div>
          ) : null}
        </Section>

        <Section n="6" title="Plano da campanha" description="Proposto pela IA. As estimativas são indicativas e não garantem resultados.">
          {c.plan_generated_at ? (
            <dl className="space-y-3 text-sm">
              {([
                ["Objetivo", plan.objetivo],
                ["Estrutura", plan.estrutura],
                ["Público sugerido", plan.publico_sugerido],
                ["Localizações", plan.localizacoes],
                ["Orçamento sugerido", plan.orcamento_sugerido],
                ["Justificação", plan.justificacao],
              ] as const).map(([k, v]) => (v ? <div key={k}><dt className="font-medium">{k}</dt><dd className="whitespace-pre-wrap text-muted">{v}</dd></div> : null))}
              {plan.estimativas ? <Alert tone="neutral" title="Estimativa (não é um resultado)">{plan.estimativas}</Alert> : null}
              <p className="text-xs text-muted">Gerado em {formatDateTime(c.plan_generated_at)} · modelo {c.plan_model}. A IA não altera o orçamento definido.</p>
            </dl>
          ) : (
            <p className="text-sm text-muted">Ainda sem plano.</p>
          )}
          {editable ? <div className="mt-4"><GeneratePlanButton org={slug} id={id} again={Boolean(c.plan_generated_at)} /></div> : null}
        </Section>

        <Section n="7" title="Textos e imagens" description="Pode editar tudo o que a IA propôs. Cada alteração anula uma aprovação anterior.">
          {ads.length ? (
            <div className="space-y-6">
              {editable ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {ads.map((a, i) => (
                    <div key={a.id} className="rounded-control border border-line p-3">
                      <p className="mb-2 text-sm font-semibold">Imagem do anúncio {String.fromCharCode(65 + i)}</p>
                      {a.image_path && images[a.image_path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images[a.image_path]} alt="" className="mb-3 aspect-square w-full rounded object-cover" />
                      ) : (
                        <p className="mb-3 text-xs text-seal">Sem imagem.</p>
                      )}
                      {a.image_brief ? <p className="mb-3 text-xs text-muted">Briefing: {a.image_brief}</p> : null}
                      <ImageUpload org={slug} id={id} position={a.position} />
                    </div>
                  ))}
                </div>
              ) : null}
              <AdsEditor org={slug} id={id} ads={ads} editable={editable} />
              {!editable ? <p className="text-sm text-muted">A campanha já não pode ser alterada neste estado.</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Ainda sem anúncios. Gere o plano no passo 6.</p>
          )}
        </Section>

        <Section n="8" title="Revisão de conformidade" description="Verificação automática de regras (publicidade enganosa, segredo profissional, angariação, políticas da Meta). Não substitui a revisão de um advogado.">
          {!c.compliance?.checked_at ? (
            <p className="text-sm text-muted">Ainda não revista.</p>
          ) : (
            <div className="space-y-3">
              {!reviewed ? <Alert tone="warn">O conteúdo mudou depois da última revisão. Reveja de novo.</Alert> : null}
              {issues.length === 0 ? (
                <Alert tone="ok">Sem problemas encontrados pelas regras automáticas.</Alert>
              ) : (
                <ul className="space-y-2">
                  {issues.map((it, i) => (
                    <li key={i} className={cn("rounded-control border p-3 text-sm", it.severity === "block" ? "border-seal/30 bg-seal-faint" : "border-warn/30 bg-warn-faint")}>
                      <p className="font-medium">
                        {it.severity === "block" ? "Impede a aprovação" : "A rever"} · {it.where}
                      </p>
                      <p className="mt-0.5">{it.message}</p>
                      {it.excerpt ? <p className="mt-1 text-xs text-muted">“…{it.excerpt}…”</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted">Revista em {formatDateTime(c.compliance.checked_at)} · regras {c.compliance.version}.</p>
            </div>
          )}
          {editable && ads.length ? (
            <div className="mt-4">
              <ActionButton action={reviewComplianceAction} fields={{ org: slug, id }} pendingLabel="A rever…">Rever agora</ActionButton>
            </div>
          ) : null}
        </Section>

        <Section n="9" title="Pré-visualização" description="Aproximação do aspeto no feed do Facebook e do Instagram. O aspeto final é definido pela Meta.">
          {ads.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ads.map((a, i) => (
                <figure key={a.id} className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
                  <figcaption className="sr-only">Pré-visualização do anúncio {String.fromCharCode(65 + i)}</figcaption>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{ctx.org.name.slice(0, 1)}</span>
                    <span className="text-sm leading-tight">
                      <span className="block font-semibold">{ctx.org.name}</span>
                      <span className="block text-xs text-muted">Patrocinado</span>
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap px-3 pb-2 text-sm">{a.primary_text}</p>
                  {a.image_path && images[a.image_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[a.image_path]} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-paper text-xs text-muted">Imagem em falta</div>
                  )}
                  <div className="flex items-center justify-between gap-3 bg-paper px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{a.headline}</span>
                      {a.description ? <span className="block truncate text-xs text-muted">{a.description}</span> : null}
                    </span>
                    <span className="shrink-0 rounded bg-line px-3 py-1.5 text-xs font-semibold">{CTAS[a.cta as Cta] ?? a.cta}</span>
                  </div>
                </figure>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Sem anúncios para mostrar.</p>
          )}
        </Section>

        <Section n="10" title="Aprovação" description="A aprovação fica registada com quem aprovou, quando, o texto aceite e a impressão digital exata do conteúdo e do orçamento.">
          {lastApproval && !lastApproval.revoked_at && ["approved", "publishing", "active", "paused", "ended", "failed"].includes(c.status) ? (
            <div className="space-y-3 text-sm">
              <Alert tone="ok" title={`Aprovada em ${formatDateTime(lastApproval.approved_at)}`}>{lastApproval.statement}</Alert>
              {canPublish && ["approved", "failed"].includes(c.status) ? (
                <ActionButton action={revokeApprovalAction} fields={{ org: slug, id }} variant="ghost" confirm="Anular a aprovação? A campanha volta a rascunho.">
                  Anular aprovação
                </ActionButton>
              ) : null}
            </div>
          ) : canPublish && editable && contentHash ? (
            <ApproveForm org={slug} id={id} hash={contentHash} daily={c.daily_budget_cents} total={c.total_budget_cents} disabledReason={approvalBlock} />
          ) : (
            <p className="text-sm text-muted">{canPublish ? "Ainda não é possível aprovar." : "Só um administrador ou advogado pode aprovar campanhas."}</p>
          )}
        </Section>

        <Section n="11" title="Publicação" description="Publicação idempotente: repetir o pedido nunca duplica a campanha. O estado só muda depois de a Meta o confirmar.">
          {c.status === "approved" || c.status === "failed" ? (
            !account ? (
              <Alert tone="neutral">
                Para publicar, ligue a conta de anúncios em{" "}
                <Link href={`/app/${slug}/trafego-pago/conta`} className="font-medium underline underline-offset-2">Tráfego Pago IA › Conta Meta</Link>.
              </Alert>
            ) : canPublish ? (
              <ActionButton
                action={publishCampaignAction}
                fields={{ org: slug, id }}
                variant="primary"
                pendingLabel="A publicar na Meta…"
                confirm={`Publicar na conta ${account.name ?? account.external_id}, com gasto máximo de ${formatCents(c.daily_budget_cents)}/dia e ${formatCents(c.total_budget_cents)} no total?`}
              >
                {c.status === "failed" ? "Tentar publicar de novo" : "Publicar na Meta"}
              </ActionButton>
            ) : null
          ) : published ? (
            <div className="flex flex-wrap gap-2">
              {canPublish && c.status === "active" ? (
                <ActionButton action={changeStatusAction} fields={{ org: slug, id, target: "paused" }} pendingLabel="A pausar…">Pausar</ActionButton>
              ) : null}
              {canPublish && c.status === "paused" ? (
                <ActionButton action={changeStatusAction} fields={{ org: slug, id, target: "active" }} pendingLabel="A retomar…">Retomar</ActionButton>
              ) : null}
              {canPublish && ["active", "paused"].includes(c.status) ? (
                <ActionButton action={changeStatusAction} fields={{ org: slug, id, target: "ended" }} variant="danger" confirm="Terminar a campanha? Não pode ser retomada." pendingLabel="A terminar…">
                  Terminar
                </ActionButton>
              ) : null}
              <ActionButton action={syncCampaignAction} fields={{ org: slug, id }} variant="ghost" pendingLabel="A confirmar com a Meta…">
                Atualizar estado e métricas
              </ActionButton>
            </div>
          ) : (
            <p className="text-sm text-muted">Disponível depois da aprovação.</p>
          )}
        </Section>

        <Section n="12" title="Resultados" description="Números fornecidos pela Meta (podem ser revistos por ela durante alguns dias). Contactos e consultas atribuídos estão nos Relatórios.">
          {metrics.length ? (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div><dt className="text-muted">Impressões</dt><dd className="text-lg font-semibold tabular-nums">{totals.impressions.toLocaleString("pt-PT")}</dd></div>
                <div><dt className="text-muted">Cliques</dt><dd className="text-lg font-semibold tabular-nums">{totals.clicks.toLocaleString("pt-PT")}</dd></div>
                <div><dt className="text-muted">Conversas iniciadas</dt><dd className="text-lg font-semibold tabular-nums">{totals.conversations.toLocaleString("pt-PT")}</dd></div>
                <div><dt className="text-muted">Gasto</dt><dd className="text-lg font-semibold tabular-nums">{formatCents(totals.spend)}</dd></div>
              </dl>
              <Table>
                <thead>
                  <tr><Th>Dia</Th><Th>Impressões</Th><Th>Alcance</Th><Th>Cliques</Th><Th>Conversas</Th><Th>Gasto</Th></tr>
                </thead>
                <tbody>
                  {[...metrics].reverse().map((m) => (
                    <tr key={m.day}>
                      <Td>{formatDate(m.day)}</Td>
                      <Td className="tabular-nums">{m.impressions.toLocaleString("pt-PT")}</Td>
                      <Td className="tabular-nums">{m.reach.toLocaleString("pt-PT")}</Td>
                      <Td className="tabular-nums">{m.clicks.toLocaleString("pt-PT")}</Td>
                      <Td className="tabular-nums">{m.conversations_started.toLocaleString("pt-PT")}</Td>
                      <Td className="tabular-nums">{formatCents(m.spend_cents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : (
            <p className="text-sm text-muted">Sem dados. Os resultados aparecem depois de a campanha estar ativa e de a Meta os disponibilizar.</p>
          )}
        </Section>

        <Section n="13" title="Melhorias" description="Sugestões da IA com base apenas nos dados reais desta campanha. Nada é alterado automaticamente.">
          {metrics.length ? <Improvements org={slug} id={id} /> : <p className="text-sm text-muted">Disponível quando houver pelo menos 3 dias de dados reais.</p>}
        </Section>

        <Panel>
          <PanelHeader title="Histórico" description="Todas as alterações, aprovações e respostas da Meta." />
          {events.length ? (
            <ol className="divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                  <span>{EVENT_LABELS[e.kind] ?? e.kind}</span>
                  <span className="text-xs text-muted">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">Sem registos.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
