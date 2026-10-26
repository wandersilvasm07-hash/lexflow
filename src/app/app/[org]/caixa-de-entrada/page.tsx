import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, EmptyState, Panel, cn } from "@/components/ui";
import { can, getOrgContext, type OrgContext } from "@/lib/auth/dal";
import { listMembers } from "@/lib/data/team";
import { formatDateTime, isPast } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/i18n";
import { AutoRefresh } from "./auto-refresh";
import { AssignSelect, ConversationActions, NoteForm, ReplyForm } from "./inbox-forms";

export const metadata: Metadata = { title: t.nav.inbox };

const FILTERS = [
  { key: "abertas", label: "Abertas" },
  { key: "humano", label: "Com a equipa" },
  { key: "urgentes", label: "Urgentes" },
  { key: "fechadas", label: "Fechadas" },
] as const;

const CATEGORY: Record<string, string> = {
  general: "Pergunta geral",
  consultation: "Pedido de consulta",
  complex: "Caso complexo",
  urgent: "Urgente",
  data_request: "Pedido RGPD",
};

type ConversationRow = {
  id: string;
  mode: "ai" | "human";
  status: "open" | "waiting" | "closed";
  category: string | null;
  is_urgent: boolean;
  unread_count: number;
  last_message_at: string | null;
  assigned_to: string | null;
  contacts: { full_name: string | null; phone_e164: string | null } | null;
};

export default async function InboxPage({ params, searchParams }: PageProps<"/app/[org]/caixa-de-entrada">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "conversations.read")) return <PermissionDenied />;

  const filter = FILTERS.find((f) => f.key === sp.f)?.key ?? "abertas";
  const selected = typeof sp.c === "string" ? sp.c : null;
  const supabase = await createClient();

  let q = supabase
    .from("conversations")
    .select("id, mode, status, category, is_urgent, unread_count, last_message_at, assigned_to, contacts(full_name, phone_e164)")
    .eq("organization_id", ctx.org.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (filter === "abertas") q = q.neq("status", "closed");
  if (filter === "humano") q = q.neq("status", "closed").eq("mode", "human");
  if (filter === "urgentes") q = q.neq("status", "closed").eq("is_urgent", true);
  if (filter === "fechadas") q = q.eq("status", "closed");

  const [{ data: list, error }, { data: account }] = await Promise.all([
    q.returns<ConversationRow[]>(),
    supabase.from("whatsapp_accounts").select("mode").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  if (error) throw error;
  const base = `/app/${slug}/caixa-de-entrada`;

  return (
    <>
      <AutoRefresh intervalMs={5000} />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Caixa de entrada</h1>
          <p className="mt-1 text-sm text-muted">Conversas do WhatsApp do escritório. Atualiza automaticamente.</p>
        </div>
        {account?.mode === "simulation" ? <Badge tone="warn">Modo de simulação</Badge> : null}
      </header>

      {!account ? (
        <Alert tone="ink" className="mb-4">
          O WhatsApp ainda não está ligado.{" "}
          {can(ctx, "whatsapp.manage") ? (
            <Link href={`/app/${slug}/whatsapp`} className="font-medium underline underline-offset-2">
              Configurar ou experimentar em simulação
            </Link>
          ) : (
            "Peça ao administrador do escritório para o configurar."
          )}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Panel className={cn("self-start overflow-hidden", selected && "hidden lg:block")}>
          <nav aria-label="Filtros" className="flex gap-1 overflow-x-auto border-b border-line p-2">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`${base}?f=${f.key}`}
                aria-current={f.key === filter ? "true" : undefined}
                className={cn(
                  "rounded px-2.5 py-1 text-xs whitespace-nowrap",
                  f.key === filter ? "bg-ink text-white" : "text-muted hover:bg-paper",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          {!list?.length ? (
            <EmptyState title="Sem conversas">
              {filter === "abertas" ? "As novas mensagens do WhatsApp aparecem aqui." : "Nada neste filtro."}
            </EmptyState>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${base}?f=${filter}&c=${c.id}`}
                    aria-current={c.id === selected ? "true" : undefined}
                    className={cn("block px-4 py-3 hover:bg-paper", c.id === selected && "bg-ink-faint")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm", c.unread_count ? "font-semibold" : "font-medium")}>
                        {c.contacts?.full_name ?? c.contacts?.phone_e164 ?? "Contacto"}
                      </span>
                      {c.unread_count ? (
                        <span className="rounded-full bg-ink px-1.5 text-xs text-white">{c.unread_count}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {c.is_urgent ? <Badge tone="seal">Urgente</Badge> : null}
                      <Badge tone={c.mode === "ai" ? "ink" : "neutral"}>{c.mode === "ai" ? "Assistente" : "Equipa"}</Badge>
                      {c.category && c.category !== "urgent" ? <Badge>{CATEGORY[c.category]}</Badge> : null}
                      {c.last_message_at ? (
                        <span className="ml-auto text-xs text-muted">{formatDateTime(c.last_message_at)}</span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className={cn(!selected && "hidden lg:block")}>
          {selected ? (
            <ConversationView ctx={ctx} id={selected} backHref={`${base}?f=${filter}`} />
          ) : (
            <Panel>
              <EmptyState title="Escolha uma conversa">
                Veja o histórico, o resumo do assistente e assuma a conversa quando for preciso.
              </EmptyState>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  author: "contact" | "ai" | "member" | "system";
  author_user_id: string | null;
  body: string | null;
  status: string;
  error_code: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "a enviar",
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};

async function ConversationView({ ctx, id, backHref }: { ctx: OrgContext; id: string; backHref: string }) {
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, mode, status, category, is_urgent, ai_summary, handoff_reason, assigned_to, last_inbound_at, contacts(full_name, phone_e164), whatsapp_accounts(mode)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!conv) {
    return (
      <Panel>
        <EmptyState title="Conversa não encontrada" />
      </Panel>
    );
  }

  const [{ data: messages }, { data: notes }, members] = await Promise.all([
    supabase
      .from("messages")
      .select("id, direction, author, author_user_id, body, status, error_code, created_at")
      .eq("conversation_id", id)
      .order("created_at")
      .limit(300)
      .returns<Message[]>(),
    supabase
      .from("internal_notes")
      .select("id, body, author_user_id, created_at")
      .eq("conversation_id", id)
      .order("created_at"),
    listMembers(ctx.org.id),
    supabase.rpc("mark_conversation_read", { p_conversation: id }),
  ]);

  const contact = conv.contacts as unknown as { full_name: string | null; phone_e164: string | null } | null;
  const simulation = (conv.whatsapp_accounts as unknown as { mode: string } | null)?.mode === "simulation";
  const names = new Map(members.map((m) => [m.user_id, m.full_name ?? m.email]));
  const assignable = members.filter((m) => m.status === "active" && ["org_admin", "lawyer", "legal_assistant"].includes(m.role));
  const windowOpen = conv.last_inbound_at ? !isPast(new Date(Date.parse(conv.last_inbound_at) + 24 * 3600 * 1000)) : false;
  const slug = ctx.org.slug;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <Link href={backHref} className="mb-1 block text-xs text-muted hover:text-ink lg:hidden">
              Voltar à lista
            </Link>
            <h2 className="truncate text-base font-semibold">{contact?.full_name ?? contact?.phone_e164 ?? "Contacto"}</h2>
            <p className="text-sm text-muted">{contact?.phone_e164}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={conv.mode === "ai" ? "ink" : "neutral"}>
                {conv.mode === "ai" ? "Assistente a responder" : "Com a equipa"}
              </Badge>
              {conv.is_urgent ? <Badge tone="seal">Urgente</Badge> : null}
              {conv.category ? <Badge>{CATEGORY[conv.category]}</Badge> : null}
              {conv.status === "closed" ? <Badge>Fechada</Badge> : null}
              {simulation ? <Badge tone="warn">Simulação</Badge> : null}
            </div>
          </div>
          <ConversationActions
            org={slug}
            id={conv.id}
            mode={conv.mode}
            status={conv.status}
            canReply={can(ctx, "conversations.reply")}
            canAssign={can(ctx, "conversations.assign")}
          />
        </div>

        {conv.handoff_reason || conv.ai_summary ? (
          <div className="space-y-2 border-b border-line bg-paper px-5 py-4 text-sm">
            {conv.handoff_reason ? (
              <p>
                <span className="font-semibold text-seal">Encaminhada: </span>
                {conv.handoff_reason}
              </p>
            ) : null}
            {conv.ai_summary ? (
              <p>
                <span className="font-semibold">Resumo do assistente: </span>
                <span className="text-muted">{conv.ai_summary}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {can(ctx, "conversations.assign") ? (
          <div className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm">
            <span className="text-muted">Responsável</span>
            <AssignSelect
              org={slug}
              id={conv.id}
              current={conv.assigned_to}
              options={assignable.map((m) => ({ id: m.user_id, name: m.full_name ?? m.email }))}
            />
          </div>
        ) : conv.assigned_to ? (
          <p className="border-b border-line px-5 py-3 text-sm text-muted">
            Responsável: {names.get(conv.assigned_to) ?? "—"}
          </p>
        ) : null}

        <ol className="max-h-[55vh] space-y-2 overflow-y-auto px-5 py-4" aria-label="Mensagens">
          {(messages ?? []).map((m) =>
            m.author === "system" ? (
              <li key={m.id} className="py-1 text-center text-xs text-muted">
                {m.body}
              </li>
            ) : (
              <li key={m.id} className={cn("flex", m.direction === "inbound" ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    m.direction === "inbound" ? "bg-ink-faint" : m.author === "ai" ? "border border-line bg-surface" : "bg-ink text-white",
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={cn("mt-1 text-[0.7rem]", m.direction === "outbound" && m.author === "member" ? "text-white/70" : "text-muted")}>
                    {m.author === "ai" ? "Assistente · " : m.author === "member" ? `${names.get(m.author_user_id ?? "") ?? "Equipa"} · ` : ""}
                    {formatDateTime(m.created_at)}
                    {m.direction === "outbound" ? ` · ${STATUS_LABEL[m.status] ?? m.status}` : ""}
                    {m.status === "failed" && m.error_code ? ` (${m.error_code})` : ""}
                  </p>
                </div>
              </li>
            ),
          )}
        </ol>

        <div className="border-t border-line p-4">
          {conv.status === "closed" ? (
            <p className="text-sm text-muted">Conversa fechada. Reabra-a para responder.</p>
          ) : conv.mode === "ai" ? (
            <p className="text-sm text-muted">O assistente está a acompanhar esta conversa. Assuma-a para escrever ao contacto.</p>
          ) : !windowOpen ? (
            <p className="text-sm text-muted">
              Passaram mais de 24 horas desde a última mensagem do contacto: pelas regras da Meta só é possível
              escrever com um modelo de mensagem aprovado.
            </p>
          ) : can(ctx, "conversations.reply") ? (
            <ReplyForm org={slug} id={conv.id} />
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-line px-5 py-3">
          <h3 className="text-sm font-semibold">Notas internas</h3>
          <p className="text-xs text-muted">Visíveis só para a equipa. Nunca são enviadas ao contacto.</p>
        </div>
        <ul className="divide-y divide-line">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="px-5 py-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted">
                {names.get(n.author_user_id) ?? "Ex-membro"} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
        {can(ctx, "conversations.reply") ? (
          <div className="border-t border-line p-4">
            <NoteForm org={slug} id={conv.id} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
