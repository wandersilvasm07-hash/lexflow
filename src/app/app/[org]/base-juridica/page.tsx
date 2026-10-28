import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  Input,
  PageHeader,
  Panel,
  Select,
  Table,
  Td,
  Th,
  cn,
} from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { knowledgeCounters, listKnowledgeDocs } from "@/lib/data/knowledge";
import { formatDate, isPast } from "@/lib/format";
import {
  CATEGORY_KEYS,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUS,
  type KnowledgeCategory,
  type KnowledgeStatus,
} from "@/lib/knowledge/categories";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.knowledge };

const STATUS_FILTERS: (KnowledgeStatus | "all")[] = ["all", "draft", "in_review", "approved", "outdated", "archived"];

export default async function KnowledgePage({ params, searchParams }: PageProps<"/app/[org]/base-juridica">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "knowledge.read")) return <PermissionDenied />;

  const scope = sp.ambito === "comum" ? "common" : "private";
  const status = STATUS_FILTERS.includes(sp.estado as KnowledgeStatus) ? (sp.estado as KnowledgeStatus) : "all";
  const category = CATEGORY_KEYS.includes(sp.categoria as KnowledgeCategory)
    ? (sp.categoria as KnowledgeCategory)
    : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";

  const [docs, counters] = await Promise.all([
    listKnowledgeDocs({ orgId: ctx.org.id, scope, status, category, q: q || undefined }),
    knowledgeCounters(ctx.org.id),
  ]);
  const base = `/app/${slug}/base-juridica`;
  const tab = (s: "private" | "common") => (s === "common" ? `${base}?ambito=comum` : base);

  return (
    <>
      <PageHeader
        title="Base jurídica"
        description="Documentos que o assistente consulta antes de responder. Só usa os aprovados, em vigor e com a revisão em dia."
        actions={
          <>
            <ButtonLink href={`${base}/testar`} variant="secondary">
              Testar pesquisa
            </ButtonLink>
            {can(ctx, "knowledge.write") ? <ButtonLink href={`${base}/novo`}>Adicionar documento</ButtonLink> : null}
          </>
        }
      />

      {counters.inReview > 0 || counters.overdue > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {counters.inReview > 0 ? (
            <Alert tone="warn">
              <Link href={`${base}?estado=in_review`} className="underline underline-offset-2">
                {counters.inReview} {counters.inReview === 1 ? "documento espera" : "documentos esperam"} revisão
              </Link>{" "}
              antes de o assistente os poder usar.
            </Alert>
          ) : null}
          {counters.overdue > 0 ? (
            <Alert tone="seal">
              {counters.overdue} {counters.overdue === 1 ? "documento aprovado tem" : "documentos aprovados têm"} a revisão
              em atraso e não {counters.overdue === 1 ? "está" : "estão"} a ser {counters.overdue === 1 ? "usado" : "usados"} pelo
              assistente até serem verificados.
            </Alert>
          ) : null}
        </div>
      ) : null}

      <nav aria-label="Âmbito" className="mb-4 flex gap-1 border-b border-line">
        {(["private", "common"] as const).map((s) => (
          <Link
            key={s}
            href={tab(s)}
            aria-current={scope === s ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              scope === s ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {s === "private" ? "Do escritório" : "Base comum"}
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-wrap items-end gap-3" action={base}>
        {scope === "common" ? <input type="hidden" name="ambito" value="comum" /> : null}
        <label className="min-w-48 flex-1">
          <span className="sr-only">Pesquisar por título</span>
          <Input name="q" defaultValue={q} placeholder="Pesquisar por título" />
        </label>
        <label>
          <span className="sr-only">Estado</span>
          <Select name="estado" defaultValue={status} className="w-40">
            <option value="all">Todos os estados</option>
            {STATUS_FILTERS.filter((s) => s !== "all").map((s) => (
              <option key={s} value={s}>
                {KNOWLEDGE_STATUS[s as KnowledgeStatus].label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="sr-only">Categoria</span>
          <Select name="categoria" defaultValue={category ?? ""} className="w-56">
            <option value="">Todas as categorias</option>
            {CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {KNOWLEDGE_CATEGORIES[c]}
              </option>
            ))}
          </Select>
        </label>
        <button type="submit" className="h-10 rounded-control border border-line-strong bg-surface px-4 text-sm hover:border-ink">
          Filtrar
        </button>
      </form>

      <Panel>
        {docs.length === 0 ? (
          <EmptyState
            title={
              q || category || status !== "all"
                ? "Nenhum documento com estes filtros"
                : scope === "common"
                  ? "A base comum ainda não tem documentos aprovados"
                  : "Ainda não há documentos do escritório"
            }
            action={
              scope === "private" && can(ctx, "knowledge.write") && !q ? (
                <ButtonLink href={`${base}/novo`}>Adicionar o primeiro documento</ButtonLink>
              ) : null
            }
          >
            {scope === "private"
              ? "Importe legislação, orientações da AIMA ou notas internas. Tudo entra como rascunho e só é usado pelo assistente depois de aprovado por um advogado."
              : "A base comum é mantida pela equipa da plataforma e partilhada por todos os escritórios."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Estado</Th>
                <Th>Vigência</Th>
                <Th>Próxima revisão</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const overdue = d.status === "approved" && d.next_review_on && isPast(`${d.next_review_on}T23:59:59Z`);
                return (
                  <tr key={d.id} className="hover:bg-paper">
                    <Td>
                      <Link href={`${base}/${d.id}`} className="font-medium hover:underline">
                        {d.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {KNOWLEDGE_CATEGORIES[d.category]} · v{d.version}
                        {d.source_name ? ` · ${d.source_name}` : ""}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={KNOWLEDGE_STATUS[d.status].tone}>{KNOWLEDGE_STATUS[d.status].label}</Badge>
                    </Td>
                    <Td className="text-muted">
                      {d.effective_from ? `desde ${formatDate(d.effective_from)}` : "—"}
                      {d.effective_until ? ` até ${formatDate(d.effective_until)}` : ""}
                    </Td>
                    <Td>
                      {d.next_review_on ? (
                        overdue ? (
                          <Badge tone="seal">Em atraso ({formatDate(d.next_review_on)})</Badge>
                        ) : (
                          <span className="text-muted">{formatDate(d.next_review_on)}</span>
                        )
                      ) : (
                        <span className="text-muted">Por definir</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
