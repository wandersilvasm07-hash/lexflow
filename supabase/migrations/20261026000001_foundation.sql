-- =============================================================================
-- LexFlow — Fase 1: Fundação
-- Organizações (escritórios), membros, papéis, permissões, convites, perfis e
-- auditoria, com isolamento multi-escritório garantido por Row Level Security.
--
-- Princípios:
--  * Nenhuma tabela é escrita diretamente pelo cliente quando a operação exige
--    regras de negócio (criar escritório, convidar, mudar papel). Essas operações
--    são funções RPC "security definer" que validam a permissão no servidor,
--    escrevem de forma atómica e registam auditoria.
--  * Funções auxiliares de autorização vivem no esquema "private", que não é
--    exposto pela API REST.
--  * A auditoria é só de acréscimo: não pode ser alterada nem apagada.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.org_role as enum (
  'org_admin',          -- Administrador do escritório
  'lawyer',             -- Advogado
  'legal_assistant',    -- Assistente jurídico
  'marketing_manager',  -- Gestor de marketing
  'viewer'              -- Utilizador de consulta limitada
);

create type public.membership_status as enum ('active', 'suspended');

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis de utilizador (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) between 1 and 120),
  locale      text not null default 'pt-PT' check (locale in ('pt-PT', 'pt-BR', 'en', 'fr')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Cria o perfil quando um utilizador se regista.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(v_name, 120))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Administradores da plataforma (equipa que opera o SaaS)
-- Por confidencialidade profissional, NÃO têm acesso a dados de clientes dos
-- escritórios — apenas a metadados de organizações e membros.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Organizações (escritórios)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 2 and 120),
  slug            extensions.citext not null unique
                  check (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  legal_name      text check (legal_name is null or char_length(legal_name) <= 200),
  nif             text check (nif is null or nif ~ '^[0-9]{9}$'),
  email           text check (email is null or char_length(email) <= 254),
  phone           text check (phone is null or char_length(phone) <= 32),
  address         text check (address is null or char_length(address) <= 300),
  timezone        text not null default 'Europe/Lisbon',
  default_locale  text not null default 'pt-PT' check (default_locale in ('pt-PT', 'pt-BR', 'en', 'fr')),
  require_mfa     boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Membros
-- -----------------------------------------------------------------------------
create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.org_role not null,
  status           public.membership_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

create trigger memberships_touch before update on public.memberships
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Matriz de permissões por papel (fonte de verdade partilhada com o código;
-- um teste garante que o TypeScript e a base de dados coincidem).
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role        public.org_role not null,
  permission  text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (role, permission)
);

insert into public.role_permissions (role, permission)
select 'org_admin'::public.org_role, p from unnest(array[
  'org.read', 'org.update', 'team.read', 'team.manage', 'audit.read', 'billing.manage',
  'settings.manage', 'whatsapp.manage',
  'conversations.read', 'conversations.reply', 'conversations.assign',
  'contacts.read', 'contacts.write', 'contacts.export',
  'calendar.read', 'calendar.write',
  'knowledge.read', 'knowledge.write', 'knowledge.approve',
  'campaigns.read', 'campaigns.write', 'campaigns.publish',
  'reports.read'
]) as p
union all
select 'lawyer', p from unnest(array[
  'org.read', 'team.read',
  'conversations.read', 'conversations.reply', 'conversations.assign',
  'contacts.read', 'contacts.write', 'contacts.export',
  'calendar.read', 'calendar.write',
  'knowledge.read', 'knowledge.write', 'knowledge.approve',
  'campaigns.read', 'reports.read'
]) as p
union all
select 'legal_assistant', p from unnest(array[
  'org.read', 'team.read',
  'conversations.read', 'conversations.reply',
  'contacts.read', 'contacts.write',
  'calendar.read', 'calendar.write',
  'knowledge.read', 'knowledge.write'
]) as p
union all
-- O gestor de marketing NÃO acede a conversas nem a contactos individuais:
-- separação entre dados de atendimento e dados publicitários (RGPD).
select 'marketing_manager', p from unnest(array[
  'org.read', 'team.read',
  'campaigns.read', 'campaigns.write', 'campaigns.publish',
  'reports.read'
]) as p
union all
select 'viewer', p from unnest(array[
  'org.read', 'team.read', 'calendar.read', 'reports.read'
]) as p;

-- -----------------------------------------------------------------------------
-- Convites (o token nunca é guardado em claro: apenas o hash SHA-256)
-- -----------------------------------------------------------------------------
create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            extensions.citext not null check (char_length(email::text) between 3 and 254),
  role             public.org_role not null,
  token_hash       text not null unique,
  invited_by       uuid references auth.users (id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);

create unique index invitations_one_pending_per_email
  on public.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

-- -----------------------------------------------------------------------------
-- Auditoria (só acréscimo). organization_id não tem FK de propósito: o registo
-- sobrevive à eliminação do escritório e nunca é modificado.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  actor_user_id    uuid,
  action           text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type      text,
  entity_id        text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

create or replace function private.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_delete before delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- =============================================================================
-- Funções de autorização (esquema private, não expostas pela API)
-- =============================================================================
create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and rp.permission = p_permission
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

-- Dois utilizadores partilham pelo menos um escritório ativo?
create or replace function private.shares_org_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user
  );
$$;

create or replace function private.write_audit(
  p_org uuid, p_actor uuid, p_action text,
  p_entity_type text default null, p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

create or replace function private.require_permission(p_org uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.has_permission(p_org, p_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles          enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.organizations     enable row level security;
alter table public.memberships       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.invitations       enable row level security;
alter table public.audit_logs        enable row level security;

-- Nenhum acesso anónimo a tabelas. Tudo passa por utilizadores autenticados.
revoke all on all tables in schema public from anon;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins: cada um só vê a sua própria linha (para a UI saber o papel)
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_member(id) or private.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_permission(id, 'org.update'))
  with check (private.has_permission(id, 'org.update'));
-- Sem políticas de insert/delete: criação via RPC create_organization.

-- Colunas sensíveis a alterações administrativas não podem ser mudadas por update direto.
revoke update on public.organizations from authenticated;
grant update (name, legal_name, nif, email, phone, address, timezone, default_locale, require_mfa)
  on public.organizations to authenticated;

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_member(organization_id) or private.is_platform_admin());
-- Sem políticas de escrita: alterações via RPC (protege o último administrador).

-- role_permissions: leitura para autenticados (a UI usa-a para esconder ações)
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (true);

-- invitations: só quem gere a equipa
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_permission(organization_id, 'team.manage'));

-- audit_logs
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and private.has_permission(organization_id, 'audit.read'));

-- Escrita direta proibida nestas tabelas, mesmo que surjam políticas no futuro.
revoke insert, update, delete on public.memberships, public.invitations, public.audit_logs,
  public.role_permissions, public.platform_admins from authenticated;
revoke insert, delete on public.organizations, public.profiles from authenticated;

-- =============================================================================
-- RPCs (API do domínio). Todas validam autenticação e permissão no servidor.
-- =============================================================================

-- Criar escritório: cria a organização e o membro administrador atomicamente.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_org uuid;
  v_count int;
begin
  -- Limite anti-abuso: no máximo 10 escritórios criados por utilizador.
  select count(*) into v_count from public.organizations where created_by = v_uid;
  if v_count >= 10 then
    raise exception 'organization_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid)
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_uid, 'org_admin');

  perform private.write_audit(v_org, v_uid, 'organization.created', 'organization', v_org::text,
    jsonb_build_object('name', btrim(p_name)));

  return v_org;
exception
  when unique_violation then
    raise exception 'slug_taken' using errcode = 'P0001';
end;
$$;

-- Criar convite: devolve o token em claro uma única vez.
create or replace function public.create_invitation(p_org uuid, p_email text, p_role public.org_role)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'team.manage');
  v_email text := lower(btrim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_exp timestamptz;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- Substitui convites pendentes anteriores para o mesmo email.
  update public.invitations i
     set revoked_at = now()
   where i.organization_id = p_org and i.email = v_email::extensions.citext
     and i.accepted_at is null and i.revoked_at is null;

  insert into public.invitations (organization_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid)
  returning id, invitations.expires_at into v_id, v_exp;

  perform private.write_audit(p_org, v_uid, 'invitation.created', 'invitation', v_id::text,
    jsonb_build_object('role', p_role));

  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid;
begin
  select organization_id into v_org from public.invitations where id = p_invitation;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_org, 'team.manage');

  update public.invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;

  perform private.write_audit(v_org, v_uid, 'invitation.revoked', 'invitation', p_invitation::text);
end;
$$;

-- Pré-visualização de um convite (página pública do link). Só revela o mínimo.
create or replace function public.get_invitation_preview(p_token text)
returns table (organization_name text, role public.org_role, email text, expires_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name,
         i.role,
         i.email::text,
         i.expires_at,
         case
           when i.revoked_at is not null then 'revoked'
           when i.accepted_at is not null then 'accepted'
           when i.expires_at < now() then 'expired'
           else 'pending'
         end
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.invitations%rowtype;
  v_user_email text;
begin
  select * into v_inv from public.invitations
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;

  select lower(email) into v_user_email from auth.users where id = v_uid;
  if v_user_email is distinct from lower(v_inv.email::text) then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (v_inv.organization_id, v_uid, v_inv.role)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  perform private.write_audit(v_inv.organization_id, v_uid, 'invitation.accepted', 'invitation',
    v_inv.id::text, jsonb_build_object('role', v_inv.role));

  return v_inv.organization_id;
end;
$$;

-- Garante que o escritório mantém pelo menos um administrador ativo.
create or replace function private.assert_not_last_admin(p_org uuid, p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.memberships where id = p_membership and role = 'org_admin' and status = 'active')
     and (select count(*) from public.memberships
           where organization_id = p_org and role = 'org_admin' and status = 'active') <= 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.change_member_role(p_membership uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships%rowtype;
  v_uid uuid;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_m.organization_id, 'team.manage');

  if v_m.role = p_role then
    return;
  end if;
  if v_m.role = 'org_admin' then
    perform private.assert_not_last_admin(v_m.organization_id, p_membership);
  end if;

  update public.memberships set role = p_role where id = p_membership;

  perform private.write_audit(v_m.organization_id, v_uid, 'membership.role_changed', 'membership',
    p_membership::text, jsonb_build_object('from', v_m.role, 'to', p_role, 'user_id', v_m.user_id));
end;
$$;

create or replace function public.set_member_status(p_membership uuid, p_status public.membership_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships%rowtype;
  v_uid uuid;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_m.organization_id, 'team.manage');

  if p_status = 'suspended' then
    perform private.assert_not_last_admin(v_m.organization_id, p_membership);
  end if;

  update public.memberships set status = p_status where id = p_membership;

  perform private.write_audit(v_m.organization_id, v_uid, 'membership.status_changed', 'membership',
    p_membership::text, jsonb_build_object('status', p_status, 'user_id', v_m.user_id));
end;
$$;

-- Remover membro (por quem gere a equipa) ou sair do escritório (o próprio).
create or replace function public.remove_member(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_m public.memberships%rowtype;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_m.user_id <> v_uid and not private.has_permission(v_m.organization_id, 'team.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.assert_not_last_admin(v_m.organization_id, p_membership);

  delete from public.memberships where id = p_membership;

  perform private.write_audit(v_m.organization_id, v_uid,
    case when v_m.user_id = v_uid then 'membership.left' else 'membership.removed' end,
    'membership', p_membership::text, jsonb_build_object('user_id', v_m.user_id, 'role', v_m.role));
end;
$$;

-- Eventos de auditoria gerados pela aplicação (ex.: exportações, alterações de
-- definições). Só membros do escritório podem registar, com o seu próprio id.
create or replace function public.log_audit_event(
  p_org uuid, p_action text, p_entity_type text default null,
  p_entity_id text default null, p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action !~ '^(organization|settings|security|export|session)\.[a-z_]+$' then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  if pg_column_size(coalesce(p_metadata, '{}'::jsonb)) > 4096 then
    raise exception 'metadata_too_large' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_org, v_uid, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

-- Permissões do utilizador atual num escritório (usado pela UI e pelo servidor).
create or replace function public.my_permissions(p_org uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select rp.permission
  from public.memberships m
  join public.role_permissions rp on rp.role = m.role
  where m.organization_id = p_org
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

-- Membros do escritório com email (auth.users não é legível diretamente).
create or replace function public.list_members(p_org uuid)
returns table (
  membership_id uuid, user_id uuid, email text, full_name text,
  role public.org_role, status public.membership_status, joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_org, 'team.read');
  return query
    select m.id, m.user_id, u.email::text, p.full_name, m.role, m.status, m.created_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org
    order by m.created_at;
end;
$$;

-- Permissões de execução: só utilizadores autenticados (exceto pré-visualização de convite).
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_organization(text, text),
  public.create_invitation(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(text),
  public.change_member_role(uuid, public.org_role),
  public.set_member_status(uuid, public.membership_status),
  public.remove_member(uuid),
  public.log_audit_event(uuid, text, text, text, jsonb),
  public.my_permissions(uuid),
  public.list_members(uuid)
to authenticated;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;
