import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, Panel, PanelHeader, cn } from "@/components/ui";
import { can, getOrgContext, isPlatformAdmin } from "@/lib/auth/dal";
import { getKnowledgeChunks, getKnowledgeDoc, getVersionChain } from "@/lib/data/knowledge";
import { formatDate, formatDateTime } from "@/lib/format";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUS } from "@/lib/knowledge/categories";
import { DocActions, EditDocument } from "./doc-actions";

export const metadata: Metadata = { title: "Documento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KnowledgeDocPage({ params, searchParams }: PageProps<"/app/[org]/base-juridica/[doc]">) {
  const [{ org: slug, doc: id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "knowledge.read")) return <PermissionDenied />;
  if (!UUID.test(id)) notFound();

  const doc = await getKnowledgeDoc(id);
  // O RLS já esconde documentos de outros escritórios; esta verificação evita
  // mostrar um documento de outro escritório através do endereço deste.
  if (!doc || (doc.organization_id && doc.organization_id !== ctx.org.id)) notFound();

  const [chunks, chain, platformAdmin] = await Promise.all([
    getKnowledgeChunks(doc.id),
    getVersionChain(doc),
    isPlatformAdmin(),
  ]);
  const common = doc.organization_id === null;
  const canWrite = common ? platformAdmin : can(ctx, "knowledge.write");
  const canApprove = common ? platformAdmin : can(ctx, "knowledge.approve");
  const today = new Date().toISOString().slice(0, 10);

  const missing: string[] = [];
  if (!doc.source_name && !doc.source_url) missing.push("fonte oficial");
  if (!doc.last_verified_on) missing.push("data da última verificação");
  if (!doc.next_review_on) missing.push("data da próxima revisão");
  else if (doc.next_review_on <= today) missing.push("próxima revisão posterior a hoje");
  if (doc.effective_until && doc.effective_until < today) missing.push("vigência (o fim de vigência já passou)");

  const inUse =
    doc.status === "approved" &&
    (!doc.effective_from || doc.effective_from <= today) &&
    (!doc.effective_until || doc.effective_until >= today) &&
    !!doc.next_review_on &&
    doc.next_review_on >= today;
  const base = `/app/${slug}/base-juridica`;
  const status = KNOWLEDGE_STATUS[doc.status];

  return (
    <>
      <Link href={common ? `${base}?ambito=comum` : base} className="text-sm text-muted hover:text-ink">
        Base jurídica{common ? " · Base comum" : ""}
      </Link>
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-sm text-muted">
            Versão {doc.version} · {KNOWLEDGE_CATEGORIES[doc.category]}
          </span>
        </div>
        <h1 className="mt-2 max-w-3xl text-xl font-semibold tracking-tight">{doc.title}</h1>
      </header>

      {sp.criado ? (
        <Alert tone="ok" className="mb-6" title="Documento importado como rascunho">
          Confira o texto extraído abaixo. Quando estiver correto, envie para revisão.
        </Alert>
      ) : null}
      {sp.versao ? (
        <Alert tone="ok" className="mb-6" title="Nova versão criada em rascunho">
          A versão anterior continua a ser usada pelo assistente até esta ser aprovada.
        </Alert>
      ) : null}

      <Alert tone={inUse ? "ok" : "neutral"} className="mb-6">
        {inUse
          ? "Em uso: o assistente pode citar este documento nas respostas."
          : doc.status === "approved"
            ? "Aprovado, mas fora de uso: está fora da vigência ou a revisão está em atraso."
            : "Fora de uso: o assistente só consulta documentos aprovados."}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Identificação" />
            <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
              <Meta label="Fonte">
                {doc.source_url ? (
                  <a href={doc.source_url} target="_blank" rel="noreferrer noopener" className="text-ink underline underline-offset-2 break-all">
                    {doc.source_name ?? doc.source_url}
                  </a>
                ) : (
                  (doc.source_name ?? <Missing />)
                )}
              </Meta>
              <Meta label="Jurisdição">{doc.jurisdiction}</Meta>
              <Meta label="Publicação">{doc.published_on ? formatDate(doc.published_on) : "—"}</Meta>
              <Meta label="Vigência">
                {doc.effective_from ? `desde ${formatDate(doc.effective_from)}` : "sem data de início"}
                {doc.effective_until ? `, até ${formatDate(doc.effective_until)}` : ""}
              </Meta>
              <Meta label="Última verificação">{doc.last_verified_on ? formatDate(doc.last_verified_on) : <Missing />}</Meta>
              <Meta label="Próxima revisão">
                {doc.next_review_on ? (
                  <span className={cn(doc.next_review_on < today && "font-medium text-seal")}>
                    {formatDate(doc.next_review_on)}
                    {doc.next_review_on < today ? " (em atraso)" : ""}
                  </span>
                ) : (
                  <Missing />
                )}
              </Meta>
              <Meta label="Aprovação">
                {doc.approved_at ? formatDateTime(doc.approved_at) : "—"}
              </Meta>
              <Meta label="Origem do texto">{FORMATS[doc.import_format] ?? doc.import_format}</Meta>
              {doc.legal_references.length ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Referências legislativas</dt>
                  <dd className="mt-1">
                    <ul className="list-disc pl-5">
                      {doc.legal_references.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {doc.tags.length ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Etiquetas</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {doc.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
              {doc.summary ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Resumo</dt>
                  <dd className="mt-1 whitespace-pre-line">{doc.summary}</dd>
                </div>
              ) : null}
            </dl>
            {canWrite && (doc.status === "draft" || doc.status === "in_review") ? (
              <div className="border-t border-line">
                <EditDocument
                  org={slug}
                  id={doc.id}
                  defaults={{
                    ...doc,
                    category: doc.category,
                  }}
                />
              </div>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Texto indexado"
              description={`${chunks.length} ${chunks.length === 1 ? "secção" : "secções"}. É isto que o assistente pesquisa.`}
            />
            <ol className="divide-y divide-line">
              {chunks.map((c) => (
                <li key={c.id} className="px-5 py-4">
                  {c.heading ? <p className="mb-1 text-sm font-semibold">{c.heading}</p> : null}
                  <p className="max-w-prose text-sm whitespace-pre-line text-text/90">{c.content}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Ações" />
            <DocActions
              org={slug}
              id={doc.id}
              status={doc.status}
              canWrite={canWrite}
              canApprove={canApprove}
              missingForApproval={missing}
            />
          </Panel>
          {chain.length > 1 ? (
            <Panel>
              <PanelHeader title="Versões" />
              <ol className="divide-y divide-line">
                {chain.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`${base}/${v.id}`}
                      aria-current={v.id === doc.id ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between px-5 py-2.5 text-sm hover:bg-paper",
                        v.id === doc.id && "font-medium",
                      )}
                    >
                      Versão {v.version}
                      <Badge tone={KNOWLEDGE_STATUS[v.status].tone}>{KNOWLEDGE_STATUS[v.status].label}</Badge>
                    </Link>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}

const FORMATS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  html: "Página HTML",
  text: "Texto",
  url: "Importado da fonte oficial",
};

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="text-warn">Por preencher</span>;
}
