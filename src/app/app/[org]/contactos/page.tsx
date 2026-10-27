import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, ButtonLink, EmptyState, Input, PageHeader, Panel, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/i18n";
import { CONTACT_SOURCE, CONTACT_STATUS } from "@/lib/crm";
import { StatusSelect } from "./contact-forms";

export const metadata: Metadata = { title: t.nav.contacts };

const SOURCE: Record<string, string> = CONTACT_SOURCE;

const PAGE_SIZE = 50;

export default async function ContactsPage({ params, searchParams }: PageProps<"/app/[org]/contactos">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "contacts.read")) return <PermissionDenied />;

  const search = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const status = typeof sp.estado === "string" && sp.estado in CONTACT_STATUS ? sp.estado : "";
  const page = Math.max(1, Number(sp.p) || 1);
  const supabase = await createClient();

  let q = supabase
    .from("contacts")
    .select("id, full_name, phone_e164, email, source, status, service_interest, created_at", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) q = q.eq("status", status);
  if (search) {
    // Caracteres especiais do filtro PostgREST são removidos antes de pesquisar.
    const safe = search.replace(/[,()%*\\]/g, " ");
    q = q.or(`full_name.ilike.%${safe}%,phone_e164.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, count, error } = await q;
  if (error) throw error;
  const total = count ?? 0;
  const base = `/app/${slug}/contactos`;
  const qs = (p: number) => `${base}?${new URLSearchParams({ ...(search && { q: search }), ...(status && { estado: status }), p: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Contactos e CRM"
        description="Potenciais clientes e o estado de cada um."
        actions={
          <>
            {can(ctx, "contacts.export") ? (
              <a
                href={`${base}/exportar?${new URLSearchParams({ ...(search && { q: search }), ...(status && { estado: status }) })}`}
                className={buttonClass("secondary")}
              >
                Exportar CSV
              </a>
            ) : null}
            {can(ctx, "contacts.write") ? <ButtonLink href={`${base}/novo`}>Novo contacto</ButtonLink> : null}
          </>
        }
      />
      {sp.eliminado ? (
        <Alert tone="ok" className="mb-4">
          Os dados do contacto foram eliminados. A eliminação ficou no registo de atividade.
        </Alert>
      ) : null}
      <Panel>
        <form className="flex flex-wrap items-center gap-2 border-b border-line p-3" role="search">
          <Input name="q" defaultValue={search} placeholder="Pesquisar nome, telefone ou email" aria-label="Pesquisar" className="h-9 max-w-xs" />
          <Select name="estado" defaultValue={status} aria-label="Estado" className="h-9 w-48">
            <option value="">Todos os estados</option>
            {Object.entries(CONTACT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <button type="submit" className={buttonClass("secondary", "sm", "h-9")}>
            Filtrar
          </button>
          <span className="ml-auto text-xs text-muted">{total} contacto{total === 1 ? "" : "s"}</span>
        </form>

        {!data?.length ? (
          <EmptyState title={search || status ? "Nenhum contacto com estes filtros" : "Ainda sem contactos"}>
            {search || status ? null : "Os contactos são criados automaticamente quando alguém escreve para o WhatsApp do escritório."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Contacto</Th>
                <Th>Origem</Th>
                <Th>Serviço</Th>
                <Th>Estado</Th>
                <Th>Entrada</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`${base}/${c.id}`} className="font-medium hover:underline">
                      {c.full_name ?? "Sem nome"}
                    </Link>
                    <p className="text-xs text-muted">{c.phone_e164 ?? c.email}</p>
                  </Td>
                  <Td>
                    <Badge>{SOURCE[c.source] ?? c.source}</Badge>
                  </Td>
                  <Td className="text-muted">{c.service_interest ?? "—"}</Td>
                  <Td>
                    {can(ctx, "contacts.write") ? (
                      <StatusSelect org={slug} id={c.id} status={c.status} />
                    ) : (
                      CONTACT_STATUS[c.status as keyof typeof CONTACT_STATUS]
                    )}
                  </Td>
                  <Td className="text-muted">{formatDate(c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2 p-3 text-sm">
            {page > 1 ? <Link href={qs(page - 1)} className={buttonClass("secondary", "sm")}>Anterior</Link> : null}
            <span className="text-muted">
              Página {page} de {Math.ceil(total / PAGE_SIZE)}
            </span>
            {page * PAGE_SIZE < total ? <Link href={qs(page + 1)} className={buttonClass("secondary", "sm")}>Seguinte</Link> : null}
          </div>
        ) : null}
      </Panel>
    </>
  );
}
