-- =============================================================================
-- Fase 3 — Base jurídica (RAG).
--
-- Garantias na base de dados:
--  * Base comum (organization_id nulo) separada dos documentos privados de cada
--    escritório; documentos privados nunca aparecem a outro escritório.
--  * A pesquisa só devolve documentos APROVADOS, em vigor na data pedida e com
--    a revisão periódica em dia. Indexado não significa atual.
--  * Conteúdo só se altera em rascunho/revisão; um documento aprovado muda
--    através de uma nova versão, e a anterior passa a "desatualizado" quando a
--    nova é aprovada.
--  * Aprovar exige fonte, data de verificação e data da próxima revisão.
--  * Todas as transições ficam no registo de atividade.
-- =============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

create type public.knowledge_status as enum ('draft', 'in_review', 'approved', 'outdated', 'archived');

-- Pesquisa em português sem acentos ("residência" encontra "residencia").
create or replace function private.pt_tsv(p_text text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_tsvector('pg_catalog.portuguese'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')));
$$;

create or replace function private.pt_tsq(p_text text)
returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  select websearch_to_tsquery('pg_catalog.portuguese'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')));
$$;

-- -----------------------------------------------------------------------------
-- Documentos
-- -----------------------------------------------------------------------------
create table public.knowledge_documents (
  id                uuid primary key default gen_random_uuid(),
  -- nulo = base comum da plataforma; preenchido = documento privado do escritório
  organization_id   uuid references public.organizations (id) on delete cascade,
  category          text not null check (category in (
                      'vistos', 'entrada_permanencia', 'autorizacao_residencia', 'renovacao',
                      'reagrupamento_familiar', 'nacionalidade', 'trabalho', 'estudo',
                      'empreendedorismo_investimento', 'documentacao', 'aima_servicos',
                      'indeferimentos', 'integracao', 'outro')),
  title             text not null check (char_length(btrim(title)) between 3 and 300),
  summary           text check (summary is null or char_length(summary) <= 2000),
  content           text not null check (char_length(content) between 1 and 2000000),
  content_hash      text not null,
  jurisdiction      text not null default 'PT' check (char_length(jurisdiction) between 2 and 20),
  source_name       text check (source_name is null or char_length(source_name) <= 200),
  source_url        text check (source_url is null or (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) between 12 and 2000)),
  legal_references  text[] not null default '{}',
  published_on      date,
  effective_from    date,
  effective_until   date,
  last_verified_on  date,
  next_review_on    date,
  version           int not null default 1 check (version >= 1),
  supersedes_id     uuid references public.knowledge_documents (id) on delete set null,
  status            public.knowledge_status not null default 'draft',
  import_format     text not null default 'text' check (import_format in ('text', 'html', 'pdf', 'docx', 'url')),
  tags              text[] not null default '{}',
  created_by        uuid references auth.users (id) on delete set null,
  reviewer_id       uuid references auth.users (id) on delete set null,
  approved_by       uuid references auth.users (id) on delete set null,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_until is null or effective_from is null or effective_until >= effective_from),
  check (status <> 'approved' or (approved_at is not null and last_verified_on is not null
                                  and next_review_on is not null
                                  and (source_url is not null or source_name is not null)))
);

create index knowledge_documents_scope_idx on public.knowledge_documents (organization_id, status, category);
-- Só uma versão "viva" (não arquivada/desatualizada) por cadeia de versões.
create unique index knowledge_documents_one_successor on public.knowledge_documents (supersedes_id)
  where supersedes_id is not null and status not in ('archived');

create trigger knowledge_documents_touch before update on public.knowledge_documents
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Segmentos indexados
-- -----------------------------------------------------------------------------
create table public.knowledge_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.knowledge_documents (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete cascade,
  position         int not null check (position >= 0),
  heading          text check (heading is null or char_length(heading) <= 300),
  content          text not null check (char_length(content) between 1 and 8000),
  tsv              tsvector generated always as (private.pt_tsv(coalesce(heading, '') || ' ' || content)) stored,
  -- Preparado para pesquisa semântica quando houver um fornecedor de embeddings.
  embedding        extensions.vector(1024),
  unique (document_id, position)
);

create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (tsv);
create index knowledge_chunks_doc_idx on public.knowledge_chunks (document_id);

-- -----------------------------------------------------------------------------
-- Relações entre documentos/conceitos
-- -----------------------------------------------------------------------------
create table public.knowledge_relations (
  document_id  uuid not null references public.knowledge_documents (id) on delete cascade,
  related_id   uuid not null references public.knowledge_documents (id) on delete cascade,
  relation     text not null check (relation in ('regulamenta', 'altera', 'revoga', 'complementa', 'relacionado')),
  primary key (document_id, related_id, relation),
  check (document_id <> related_id)
);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks    enable row level security;
alter table public.knowledge_relations enable row level security;

revoke all on public.knowledge_documents, public.knowledge_chunks, public.knowledge_relations from anon;
revoke insert, update, delete on public.knowledge_documents, public.knowledge_chunks, public.knowledge_relations
  from authenticated;

-- Tem acesso de leitura a algum escritório? (base comum é para escritórios clientes)
create or replace function private.has_any_knowledge_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = 'knowledge.read'
  );
$$;

create or replace function private.can_read_knowledge_doc(p_org uuid, p_status public.knowledge_status)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is null then private.is_platform_admin()
                         or (p_status in ('approved', 'outdated') and private.has_any_knowledge_access())
    else private.has_permission(p_org, 'knowledge.read')
  end;
$$;

create policy knowledge_documents_select on public.knowledge_documents for select to authenticated
  using (private.can_read_knowledge_doc(organization_id, status));

create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated
  using (exists (select 1 from public.knowledge_documents d
                 where d.id = document_id and private.can_read_knowledge_doc(d.organization_id, d.status)));

create policy knowledge_relations_select on public.knowledge_relations for select to authenticated
  using (exists (select 1 from public.knowledge_documents d
                 where d.id = document_id and private.can_read_knowledge_doc(d.organization_id, d.status)));

-- =============================================================================
-- Helpers de autorização para escrita
-- =============================================================================
create or replace function private.require_knowledge_write(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if p_org is null then
    if not private.is_platform_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return v_uid;
  end if;
  return private.require_permission(p_org, 'knowledge.write');
end;
$$;

create or replace function private.require_knowledge_approve(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if p_org is null then
    if not private.is_platform_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return v_uid;
  end if;
  return private.require_permission(p_org, 'knowledge.approve');
end;
$$;

create or replace function private.lock_knowledge_doc(p_doc uuid)
returns public.knowledge_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_documents%rowtype;
begin
  select * into v from public.knowledge_documents where id = p_doc for update;
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Substitui os segmentos de um documento. p_chunks = [{"heading": "...", "content": "..."}]
create or replace function private.replace_chunks(p_doc public.knowledge_documents, p_chunks jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'chunks_required' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_chunks) > 5000 then
    raise exception 'too_many_chunks' using errcode = 'P0001';
  end if;
  delete from public.knowledge_chunks where document_id = p_doc.id;
  insert into public.knowledge_chunks (document_id, organization_id, position, heading, content)
  select p_doc.id, p_doc.organization_id, (e.ord - 1)::int,
         nullif(left(btrim(coalesce(e.value ->> 'heading', '')), 300), ''),
         btrim(e.value ->> 'content')
  from jsonb_array_elements(p_chunks) with ordinality as e(value, ord)
  where btrim(coalesce(e.value ->> 'content', '')) <> '';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'chunks_required' using errcode = 'P0001';
  end if;
  return n;
end;
$$;

revoke all on function
  private.has_any_knowledge_access(), private.can_read_knowledge_doc(uuid, public.knowledge_status),
  private.require_knowledge_write(uuid), private.require_knowledge_approve(uuid),
  private.lock_knowledge_doc(uuid), private.replace_chunks(public.knowledge_documents, jsonb)
from public, anon;
grant execute on function
  private.has_any_knowledge_access(), private.can_read_knowledge_doc(uuid, public.knowledge_status)
to authenticated, service_role;

-- =============================================================================
-- RPCs de escrita
-- =============================================================================

-- Criar documento (sempre em rascunho).
create or replace function public.create_knowledge_document(
  p_org uuid,
  p_meta jsonb,
  p_content text,
  p_chunks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_knowledge_write(p_org);
  v_doc public.knowledge_documents%rowtype;
begin
  insert into public.knowledge_documents (
    organization_id, category, title, summary, content, content_hash, jurisdiction,
    source_name, source_url, legal_references, published_on, effective_from, effective_until,
    last_verified_on, next_review_on, import_format, tags, created_by, status
  ) values (
    p_org,
    p_meta ->> 'category',
    btrim(p_meta ->> 'title'),
    nullif(btrim(coalesce(p_meta ->> 'summary', '')), ''),
    p_content,
    encode(extensions.digest(p_content, 'sha256'), 'hex'),
    coalesce(nullif(p_meta ->> 'jurisdiction', ''), 'PT'),
    nullif(btrim(coalesce(p_meta ->> 'source_name', '')), ''),
    nullif(btrim(coalesce(p_meta ->> 'source_url', '')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_meta -> 'legal_references', '[]'::jsonb))), '{}'),
    nullif(p_meta ->> 'published_on', '')::date,
    nullif(p_meta ->> 'effective_from', '')::date,
    nullif(p_meta ->> 'effective_until', '')::date,
    nullif(p_meta ->> 'last_verified_on', '')::date,
    nullif(p_meta ->> 'next_review_on', '')::date,
    coalesce(nullif(p_meta ->> 'import_format', ''), 'text'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_meta -> 'tags', '[]'::jsonb))), '{}'),
    v_uid,
    'draft'
  ) returning * into v_doc;

  perform private.replace_chunks(v_doc, p_chunks);
  perform private.write_audit(p_org, v_uid, 'knowledge.created', 'knowledge_document', v_doc.id::text,
    jsonb_build_object('title', v_doc.title, 'scope', case when p_org is null then 'common' else 'private' end));
  return v_doc.id;
end;
$$;

-- Atualizar metadados e/ou conteúdo (só rascunho ou em revisão).
create or replace function public.update_knowledge_document(
  p_doc uuid, p_meta jsonb, p_content text default null, p_chunks jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_documents%rowtype := private.lock_knowledge_doc(p_doc);
  v_uid uuid := private.require_knowledge_write(v.organization_id);
begin
  if v.status not in ('draft', 'in_review') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  update public.knowledge_documents set
    category         = coalesce(p_meta ->> 'category', category),
    title            = coalesce(nullif(btrim(p_meta ->> 'title'), ''), title),
    summary          = case when p_meta ? 'summary' then nullif(btrim(coalesce(p_meta ->> 'summary', '')), '') else summary end,
    jurisdiction     = coalesce(nullif(p_meta ->> 'jurisdiction', ''), jurisdiction),
    source_name      = case when p_meta ? 'source_name' then nullif(btrim(coalesce(p_meta ->> 'source_name', '')), '') else source_name end,
    source_url       = case when p_meta ? 'source_url' then nullif(btrim(coalesce(p_meta ->> 'source_url', '')), '') else source_url end,
    legal_references = case when p_meta ? 'legal_references'
                         then coalesce(array(select jsonb_array_elements_text(p_meta -> 'legal_references')), '{}')
                         else legal_references end,
    published_on     = case when p_meta ? 'published_on' then nullif(p_meta ->> 'published_on', '')::date else published_on end,
    effective_from   = case when p_meta ? 'effective_from' then nullif(p_meta ->> 'effective_from', '')::date else effective_from end,
    effective_until  = case when p_meta ? 'effective_until' then nullif(p_meta ->> 'effective_until', '')::date else effective_until end,
    last_verified_on = case when p_meta ? 'last_verified_on' then nullif(p_meta ->> 'last_verified_on', '')::date else last_verified_on end,
    next_review_on   = case when p_meta ? 'next_review_on' then nullif(p_meta ->> 'next_review_on', '')::date else next_review_on end,
    tags             = case when p_meta ? 'tags'
                         then coalesce(array(select jsonb_array_elements_text(p_meta -> 'tags')), '{}')
                         else tags end,
    content          = coalesce(p_content, content),
    content_hash     = case when p_content is not null
                         then encode(extensions.digest(p_content, 'sha256'), 'hex') else content_hash end
  where id = v.id
  returning * into v;

  if p_content is not null then
    perform private.replace_chunks(v, coalesce(p_chunks, 'null'::jsonb));
  end if;

  perform private.write_audit(v.organization_id, v_uid, 'knowledge.updated', 'knowledge_document', v.id::text,
    jsonb_build_object('content_changed', p_content is not null));
end;
$$;

-- Transições editoriais.
--   draft      → in_review            (knowledge.write)
--   in_review  → draft                (knowledge.write)  devolver
--   in_review  → approved             (knowledge.approve) exige metadados completos
--   approved   → outdated | archived  (knowledge.approve)
--   draft/in_review/outdated → archived (knowledge.write)
create or replace function public.set_knowledge_status(p_doc uuid, p_status public.knowledge_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_documents%rowtype := private.lock_knowledge_doc(p_doc);
  v_uid uuid;
  v_from public.knowledge_status := v.status;
begin
  if v_from = p_status then return; end if;

  if p_status = 'approved' or v_from = 'approved' then
    v_uid := private.require_knowledge_approve(v.organization_id);
  else
    v_uid := private.require_knowledge_write(v.organization_id);
  end if;

  if not (
       (v_from = 'draft' and p_status in ('in_review', 'archived'))
    or (v_from = 'in_review' and p_status in ('draft', 'approved', 'archived'))
    or (v_from = 'approved' and p_status in ('outdated', 'archived'))
    or (v_from = 'outdated' and p_status = 'archived')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if p_status = 'approved' then
    if v.source_url is null and v.source_name is null then
      raise exception 'approval_requires_source' using errcode = 'P0001';
    end if;
    if v.last_verified_on is null or v.next_review_on is null then
      raise exception 'approval_requires_review_dates' using errcode = 'P0001';
    end if;
    if v.next_review_on <= current_date then
      raise exception 'approval_requires_future_review' using errcode = 'P0001';
    end if;
    if v.effective_until is not null and v.effective_until < current_date then
      raise exception 'approval_document_expired' using errcode = 'P0001';
    end if;

    update public.knowledge_documents
       set status = 'approved', approved_by = v_uid, approved_at = now(), reviewer_id = v_uid
     where id = v.id;

    -- A versão anterior deixa de estar em vigor na base.
    if v.supersedes_id is not null then
      update public.knowledge_documents set status = 'outdated'
       where id = v.supersedes_id and status = 'approved';
    end if;
  else
    update public.knowledge_documents set status = p_status where id = v.id;
  end if;

  perform private.write_audit(v.organization_id, v_uid, 'knowledge.status_changed', 'knowledge_document', v.id::text,
    jsonb_build_object('from', v_from, 'to', p_status, 'version', v.version,
                       'note', nullif(left(btrim(coalesce(p_note, '')), 300), '')));
end;
$$;

-- Nova versão de um documento aprovado ou desatualizado (cópia em rascunho).
create or replace function public.new_knowledge_version(p_doc uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_documents%rowtype := private.lock_knowledge_doc(p_doc);
  v_uid uuid := private.require_knowledge_write(v.organization_id);
  v_new uuid;
begin
  if v.status not in ('approved', 'outdated') then
    raise exception 'version_requires_approved' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.knowledge_documents
             where supersedes_id = v.id and status not in ('archived')) then
    raise exception 'version_already_exists' using errcode = 'P0001';
  end if;

  insert into public.knowledge_documents (
    organization_id, category, title, summary, content, content_hash, jurisdiction, source_name, source_url,
    legal_references, published_on, effective_from, effective_until, last_verified_on, next_review_on,
    version, supersedes_id, import_format, tags, created_by, status
  ) values (
    v.organization_id, v.category, v.title, v.summary, v.content, v.content_hash, v.jurisdiction, v.source_name,
    v.source_url, v.legal_references, v.published_on, v.effective_from, v.effective_until, null, null,
    v.version + 1, v.id, v.import_format, v.tags, v_uid, 'draft'
  ) returning id into v_new;

  insert into public.knowledge_chunks (document_id, organization_id, position, heading, content)
  select v_new, organization_id, position, heading, content
    from public.knowledge_chunks where document_id = v.id;

  perform private.write_audit(v.organization_id, v_uid, 'knowledge.version_created', 'knowledge_document',
    v_new::text, jsonb_build_object('from_document', v.id, 'version', v.version + 1));
  return v_new;
end;
$$;

create or replace function public.set_knowledge_relation(p_doc uuid, p_related uuid, p_relation text, p_remove boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_documents%rowtype := private.lock_knowledge_doc(p_doc);
  v_uid uuid := private.require_knowledge_write(v.organization_id);
  v_rel_org uuid;
begin
  select organization_id into v_rel_org from public.knowledge_documents where id = p_related;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Só se relaciona com documentos do mesmo escritório ou da base comum.
  if v_rel_org is not null and v_rel_org is distinct from v.organization_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_remove then
    delete from public.knowledge_relations
     where document_id = v.id and related_id = p_related and relation = p_relation;
  else
    insert into public.knowledge_relations (document_id, related_id, relation)
    values (v.id, p_related, p_relation) on conflict do nothing;
  end if;
end;
$$;

-- =============================================================================
-- Pesquisa
-- =============================================================================
create or replace function private.search_knowledge_impl(
  p_org uuid, p_query text, p_as_of date, p_limit int, p_include_private boolean
)
returns table (
  chunk_id uuid, document_id uuid, title text, heading text, content text, category text,
  scope text, version int, source_name text, source_url text, legal_references text[],
  effective_from date, effective_until date, last_verified_on date, next_review_on date, rank real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select private.pt_tsq(p_query) as tsq)
  select c.id, d.id, d.title, c.heading, c.content, d.category,
         case when d.organization_id is null then 'common' else 'private' end,
         d.version, d.source_name, d.source_url, d.legal_references,
         d.effective_from, d.effective_until, d.last_verified_on, d.next_review_on,
         ts_rank_cd(c.tsv, q.tsq)::real
  from q
  join public.knowledge_chunks c on c.tsv @@ q.tsq
  join public.knowledge_documents d on d.id = c.document_id
  where d.status = 'approved'
    and (d.organization_id is null or (p_include_private and d.organization_id = p_org))
    and (d.effective_from is null or d.effective_from <= p_as_of)
    and (d.effective_until is null or d.effective_until >= p_as_of)
    and d.next_review_on is not null and d.next_review_on >= p_as_of
  order by 16 desc, d.last_verified_on desc nulls last
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- Para a equipa (testar o que o assistente encontra).
create or replace function public.search_knowledge(p_org uuid, p_query text, p_as_of date default null, p_limit int default 6)
returns table (
  chunk_id uuid, document_id uuid, title text, heading text, content text, category text,
  scope text, version int, source_name text, source_url text, legal_references text[],
  effective_from date, effective_until date, last_verified_on date, next_review_on date, rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_org, 'knowledge.read');
  if char_length(btrim(coalesce(p_query, ''))) < 2 or char_length(p_query) > 500 then
    raise exception 'invalid_query' using errcode = 'P0001';
  end if;
  return query select * from private.search_knowledge_impl(p_org, p_query, coalesce(p_as_of, current_date), p_limit, true);
end;
$$;

-- Para o assistente (servidor, chave de serviço).
create or replace function public.agent_search_knowledge(p_org uuid, p_query text, p_limit int default 6)
returns table (
  chunk_id uuid, document_id uuid, title text, heading text, content text, category text,
  scope text, version int, source_name text, source_url text, legal_references text[],
  effective_from date, effective_until date, last_verified_on date, next_review_on date, rank real
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.search_knowledge_impl(p_org, left(coalesce(p_query, ''), 500), current_date, p_limit, true);
$$;

revoke all on function private.search_knowledge_impl(uuid, text, date, int, boolean) from public, anon, authenticated;
revoke execute on function
  public.create_knowledge_document(uuid, jsonb, text, jsonb),
  public.update_knowledge_document(uuid, jsonb, text, jsonb),
  public.set_knowledge_status(uuid, public.knowledge_status, text),
  public.new_knowledge_version(uuid),
  public.set_knowledge_relation(uuid, uuid, text, boolean),
  public.search_knowledge(uuid, text, date, int),
  public.agent_search_knowledge(uuid, text, int)
from public, anon;
grant execute on function
  public.create_knowledge_document(uuid, jsonb, text, jsonb),
  public.update_knowledge_document(uuid, jsonb, text, jsonb),
  public.set_knowledge_status(uuid, public.knowledge_status, text),
  public.new_knowledge_version(uuid),
  public.set_knowledge_relation(uuid, uuid, text, boolean),
  public.search_knowledge(uuid, text, date, int)
to authenticated;
revoke execute on function public.agent_search_knowledge(uuid, text, int) from authenticated;
grant execute on function public.agent_search_knowledge(uuid, text, int) to service_role;
