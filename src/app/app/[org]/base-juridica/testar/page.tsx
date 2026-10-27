import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, Button, EmptyState, Input, PageHeader, Panel, PanelHeader } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { searchKnowledge } from "@/lib/data/knowledge";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Testar pesquisa" };

export default async function TestSearchPage({ params, searchParams }: PageProps<"/app/[org]/base-juridica/testar">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "knowledge.read")) return <PermissionDenied />;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 500) : "";
  const hits = q.length >= 2 ? await searchKnowledge(ctx.org.id, q) : null;
  const base = `/app/${slug}/base-juridica`;

  return (
    <>
      <Link href={base} className="text-sm text-muted hover:text-ink">
        Base jurídica
      </Link>
      <PageHeader
        title="Testar pesquisa"
        description="Escreva uma pergunta como um cliente a faria. Vê exatamente as fontes que o assistente encontraria hoje."
      />
      <form action={`${base}/testar`} className="mb-6 flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Pergunta</span>
          <Input name="q" defaultValue={q} placeholder="Ex.: posso trazer a minha mulher e os meus filhos?" autoFocus />
        </label>
        <Button type="submit">Pesquisar</Button>
      </form>

      {hits === null ? null : hits.length === 0 ? (
        <Panel>
          <EmptyState title="Nenhuma fonte aprovada e em vigor responde a esta pergunta">
            Nesta situação o assistente não responde ao conteúdo jurídico: diz ao cliente que vai confirmar com a equipa
            e encaminha a conversa.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Alert tone="ink" className="mb-4">
            O assistente recebe estas {hits.length} secções, por esta ordem, e só pode citar o que nelas está.
          </Alert>
          <div className="space-y-4">
            {hits.map((h, i) => (
              <Panel key={h.chunk_id}>
                <PanelHeader
                  title={`${i + 1}. ${h.title}${h.heading ? ` — ${h.heading}` : ""}`}
                  description={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={h.scope === "common" ? "ink" : "neutral"}>
                        {h.scope === "common" ? "Base comum" : "Do escritório"}
                      </Badge>
                      <span>Versão {h.version}</span>
                      {h.last_verified_on ? <span>verificado em {formatDate(h.last_verified_on)}</span> : null}
                      {h.source_name ? <span>{h.source_name}</span> : null}
                    </span>
                  }
                  actions={
                    <Link href={`${base}/${h.document_id}`} className="text-sm text-ink underline underline-offset-2">
                      Abrir
                    </Link>
                  }
                />
                <p className="max-w-prose px-5 py-4 text-sm whitespace-pre-line">{h.content}</p>
              </Panel>
            ))}
          </div>
        </>
      )}
    </>
  );
}
