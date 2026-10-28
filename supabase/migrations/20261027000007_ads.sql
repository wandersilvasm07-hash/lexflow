-- =============================================================================
-- Fase 5 — Publicidade (Meta Ads) com controlo financeiro.
--
-- Garantias na base de dados:
--  * Nenhuma campanha é aprovada sem limites de orçamento definidos pelo
--    escritório, e nenhuma ultrapassa esses limites (diário por campanha,
--    total por campanha e soma diária de todas as campanhas em curso).
--  * Aprovação explícita registada: quem, quando, o texto confirmado e a
--    impressão digital (hash) exata do conteúdo e do orçamento aprovados.
--    Qualquer alteração depois de aprovada anula a aprovação.
--  * Só se aprova depois de uma revisão de conformidade feita sobre o
--    conteúdo atual, sem problemas bloqueantes.
--  * Publicação idempotente: um pedido repetido não cria segunda campanha;
--    a publicação retoma os passos já feitos. Campanhas iguais não se
--    aprovam em duplicado.
--  * O estado "ativa/pausada" só muda quando a plataforma o confirma.
--  * As métricas só entram pela sincronização com a plataforma (nunca
--    inventadas) e o gasto real dispara alertas de consumo.
--  * A IA não altera orçamentos: a função que grava o plano e os anúncios
--    não tem parâmetros de orçamento.
--  * Histórico de alterações só de acrescentar.
-- =============================================================================

create type public.campaign_status as enum (
  'draft',       -- em preparação (editável)
  'approved',    -- aprovada, à espera de publicação
  'publishing',  -- publicação em curso
  'active',      -- confirmada como ativa na plataforma
  'paused',      -- confirmada como pausada na plataforma
  'failed',      -- a publicação falhou (pode repetir-se sem duplicar)
  'rejected',    -- rejeitada pela plataforma
  'ended',       -- terminada
  'archived'
);
create type public.campaign_objective as enum ('messages', 'leads', 'traffic', 'awareness');
create type public.campaign_destination as enum ('whatsapp', 'form', 'landing_page');

-- -----------------------------------------------------------------------------
-- Contas de anúncios ligadas (Meta). O token é guardado cifrado pela aplicação
-- e nunca é legível pelos utilizadores (sem permissão de coluna).
-- -----------------------------------------------------------------------------
create table public.ad_accounts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  provider           text not null default 'meta' check (provider in ('meta')),
  external_id        text not null check (external_id ~ '^act_[0-9]{3,25}$'),
  name               text check (name is null or char_length(name) <= 200),
  currency           text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  page_id            text check (page_id is null or page_id ~ '^[0-9]{3,25}$'),
  whatsapp_number    text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{6,14}$'),
  status             text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  token_ciphertext   text,
  token_expires_at   timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  connected_by       uuid references auth.users (id) on delete set null,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);
create unique index ad_accounts_one_connected on public.ad_accounts (organization_id, provider)
  where status = 'connected';
create trigger ad_accounts_touch before update on public.ad_accounts
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Limites de orçamento definidos pelo escritório (em cêntimos).
-- -----------------------------------------------------------------------------
create table public.ad_budget_settings (
  organization_id            uuid primary key references public.organizations (id) on delete cascade,
  max_daily_cents            int not null check (max_daily_cents between 100 and 10000000),
  max_campaign_total_cents   int not null check (max_campaign_total_cents between 100 and 1000000000),
  max_all_daily_cents        int not null check (max_all_daily_cents between 100 and 100000000),
  alert_pct                  int not null default 80 check (alert_pct between 50 and 100),
  updated_by                 uuid references auth.users (id) on delete set null,
  updated_at                 timestamptz not null default now(),
  check (max_campaign_total_cents >= max_daily_cents),
  check (max_all_daily_cents >= max_daily_cents)
);

-- -----------------------------------------------------------------------------
-- Campanhas
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 2 and 120),
  service_id            uuid references public.services (id) on delete set null,
  service_label         text not null check (char_length(btrim(service_label)) between 2 and 200),
  objective             public.campaign_objective not null,
  destination           public.campaign_destination not null,
  destination_url       text check (destination_url is null
                                    or (destination_url ~ '^https://[^[:space:]]+$' and char_length(destination_url) <= 2000)),
  locations             text[] not null check (cardinality(locations) between 1 and 25),
  languages             text[] not null default '{pt}' check (cardinality(languages) between 1 and 6),
  audience_notes        text check (audience_notes is null or char_length(audience_notes) <= 1000),
  daily_budget_cents    int not null check (daily_budget_cents >= 100),
  total_budget_cents    int not null,
  starts_on             date not null,
  ends_on               date,
  plan                  jsonb not null default '{}'::jsonb,
  plan_model            text,
  plan_generated_at     timestamptz,
  compliance            jsonb not null default '{}'::jsonb,
  compliance_hash       text,
  status                public.campaign_status not null default 'draft',
  approval_id           uuid,
  ad_account_id         uuid references public.ad_accounts (id) on delete set null,
  publish_key           uuid unique,
  external_campaign_id  text,
  external_ids          jsonb not null default '{}'::jsonb,
  external_status       text,
  last_error            text check (last_error is null or char_length(last_error) <= 1000),
  spend_cents           bigint not null default 0,
  last_synced_at        timestamptz,
  alert_sent_at         timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (total_budget_cents >= daily_budget_cents),
  check (ends_on is null or ends_on >= starts_on),
  check (destination <> 'landing_page' or destination_url is not null),
  unique (organization_id, external_campaign_id)
);
create index campaigns_org_idx on public.campaigns (organization_id, status, created_at desc);
create trigger campaigns_touch before update on public.campaigns
  for each row execute function private.touch_updated_at();

-- Anúncios (variantes para teste) de cada campanha
create table public.campaign_ads (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.campaigns (id) on delete cascade,
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  position              int not null check (position between 0 and 4),
  primary_text          text not null check (char_length(btrim(primary_text)) between 1 and 2000),
  headline              text not null check (char_length(btrim(headline)) between 1 and 80),
  description           text check (description is null or char_length(description) <= 200),
  cta                   text not null check (cta in ('WHATSAPP_MESSAGE', 'LEARN_MORE', 'CONTACT_US', 'BOOK_NOW', 'SIGN_UP', 'GET_QUOTE')),
  image_brief           text check (image_brief is null or char_length(image_brief) <= 1000),
  image_path            text check (image_path is null or char_length(image_path) <= 300),
  external_creative_id  text,
  external_ad_id        text,
  created_at            timestamptz not null default now(),
  unique (campaign_id, position)
);
create index campaign_ads_external on public.campaign_ads (organization_id, external_ad_id) where external_ad_id is not null;

-- Aprovações explícitas (registo da autorização)
create table public.campaign_approvals (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  approved_by         uuid not null references auth.users (id),
  approved_at         timestamptz not null default now(),
  content_hash        text not null,
  daily_budget_cents  int not null,
  total_budget_cents  int not null,
  starts_on           date not null,
  ends_on             date,
  statement           text not null check (char_length(statement) between 20 and 1000),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users (id),
  revoked_reason      text check (revoked_reason is null or char_length(revoked_reason) <= 300)
);
create index campaign_approvals_campaign on public.campaign_approvals (campaign_id, approved_at desc);
alter table public.campaigns
  add constraint campaigns_approval_fk foreign key (approval_id) references public.campaign_approvals (id) on delete set null;

-- Histórico de alterações (só se acrescenta)
create table public.campaign_events (
  id               bigint generated always as identity primary key,
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  actor_user_id    uuid references auth.users (id) on delete set null,
  kind             text not null check (char_length(kind) between 2 and 60),
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index campaign_events_campaign on public.campaign_events (campaign_id, created_at desc);

-- Métricas diárias fornecidas pela plataforma
create table public.campaign_metrics_daily (
  campaign_id            uuid not null references public.campaigns (id) on delete cascade,
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  day                    date not null,
  impressions            bigint not null default 0 check (impressions >= 0),
  reach                  bigint not null default 0 check (reach >= 0),
  clicks                 bigint not null default 0 check (clicks >= 0),
  conversations_started  bigint not null default 0 check (conversations_started >= 0),
  leads                  bigint not null default 0 check (leads >= 0),
  spend_cents            bigint not null default 0 check (spend_cents >= 0),
  source                 text not null default 'meta' check (source in ('meta')),
  fetched_at             timestamptz not null default now(),
  primary key (campaign_id, day)
);

-- Atribuição de contactos a campanhas (só com dados da plataforma)
alter table public.contacts
  add column attributed_campaign_id uuid references public.campaigns (id) on delete set null,
  add column attribution jsonb;
create index contacts_attributed_idx on public.contacts (organization_id, attributed_campaign_id)
  where attributed_campaign_id is not null;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ad_accounts            enable row level security;
alter table public.ad_budget_settings     enable row level security;
alter table public.campaigns              enable row level security;
alter table public.campaign_ads           enable row level security;
alter table public.campaign_approvals     enable row level security;
alter table public.campaign_events        enable row level security;
alter table public.campaign_metrics_daily enable row level security;

revoke all on public.ad_accounts, public.ad_budget_settings, public.campaigns, public.campaign_ads,
  public.campaign_approvals, public.campaign_events, public.campaign_metrics_daily from anon;
-- Toda a escrita é feita por funções (validações e histórico).
revoke insert, update, delete on public.ad_accounts, public.ad_budget_settings, public.campaigns,
  public.campaign_ads, public.campaign_approvals, public.campaign_events, public.campaign_metrics_daily
  from authenticated;

-- O token cifrado nunca é legível pelos utilizadores.
revoke select on public.ad_accounts from authenticated;
grant select (id, organization_id, provider, external_id, name, currency, page_id, whatsapp_number,
  status, token_expires_at, last_error, connected_by, connected_at, updated_at)
  on public.ad_accounts to authenticated;

create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read'));
create policy ad_budget_settings_select on public.ad_budget_settings for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read')
         or private.has_permission(organization_id, 'settings.manage'));
create policy campaigns_select on public.campaigns for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read'));
create policy campaign_ads_select on public.campaign_ads for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read'));
create policy campaign_approvals_select on public.campaign_approvals for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read'));
create policy campaign_events_select on public.campaign_events for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read'));
create policy campaign_metrics_select on public.campaign_metrics_daily for select to authenticated
  using (private.has_permission(organization_id, 'campaigns.read')
         or private.has_permission(organization_id, 'reports.read'));

-- =============================================================================
-- Funções internas
-- =============================================================================

create or replace function private.campaign_event(
  p_campaign uuid, p_org uuid, p_actor uuid, p_kind text, p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.campaign_events (campaign_id, organization_id, actor_user_id, kind, details)
  values (p_campaign, p_org, p_actor, p_kind, coalesce(p_details, '{}'::jsonb));
$$;

-- Impressão digital do conteúdo e do orçamento: o que é aprovado é exatamente isto.
create or replace function private.campaign_content_hash(p_campaign uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
      'name', c.name,
      'service', c.service_label,
      'objective', c.objective,
      'destination', c.destination,
      'url', c.destination_url,
      'locations', to_jsonb(c.locations),
      'languages', to_jsonb(c.languages),
      'audience', c.audience_notes,
      'daily', c.daily_budget_cents,
      'total', c.total_budget_cents,
      'starts', c.starts_on,
      'ends', c.ends_on,
      'ads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'p', a.position, 't', a.primary_text, 'h', a.headline, 'd', a.description,
          'c', a.cta, 'i', a.image_path) order by a.position)
        from public.campaign_ads a where a.campaign_id = c.id), '[]'::jsonb)
    )::text, 'sha256'), 'hex')
  from public.campaigns c where c.id = p_campaign;
$$;

-- Valida o orçamento contra os limites do escritório.
-- p_check_all: inclui a soma diária das outras campanhas em curso.
create or replace function private.check_campaign_budget(
  p_org uuid, p_campaign uuid, p_daily int, p_total int, p_check_all boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ad_budget_settings;
  v_others bigint;
begin
  select * into s from public.ad_budget_settings where organization_id = p_org;
  if not found then
    if p_check_all then
      raise exception 'budget_limits_not_set' using errcode = 'P0001';
    end if;
    return;
  end if;
  if p_daily > s.max_daily_cents then
    raise exception 'budget_daily_over_limit' using errcode = 'P0001';
  end if;
  if p_total > s.max_campaign_total_cents then
    raise exception 'budget_total_over_limit' using errcode = 'P0001';
  end if;
  if p_check_all then
    select coalesce(sum(daily_budget_cents), 0) into v_others
    from public.campaigns
    where organization_id = p_org
      and id <> p_campaign
      and status in ('approved', 'publishing', 'active');
    if v_others + p_daily > s.max_all_daily_cents then
      raise exception 'budget_all_daily_over_limit' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- Normaliza e valida os dados básicos vindos da aplicação.
create or replace function private.apply_campaign_basics(p_campaign uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_service uuid := nullif(p_data->>'service_id', '')::uuid;
  v_locations text[];
  v_languages text[];
begin
  select organization_id into v_org from public.campaigns where id = p_campaign;
  if v_service is not null and not exists (
    select 1 from public.services where id = v_service and organization_id = v_org
  ) then
    raise exception 'invalid_service' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}')
    into v_locations from jsonb_array_elements_text(coalesce(p_data->'locations', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_languages from jsonb_array_elements_text(coalesce(p_data->'languages', '["pt"]'::jsonb)) x;
  if exists (select 1 from unnest(v_locations) l where char_length(l) > 120) then
    raise exception 'invalid_locations' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_languages) l where l !~ '^[a-z]{2}(-[a-z]{2})?$') then
    raise exception 'invalid_languages' using errcode = 'P0001';
  end if;

  update public.campaigns set
    name               = btrim(p_data->>'name'),
    service_id         = v_service,
    service_label      = btrim(p_data->>'service_label'),
    objective          = (p_data->>'objective')::public.campaign_objective,
    destination        = (p_data->>'destination')::public.campaign_destination,
    destination_url    = nullif(btrim(coalesce(p_data->>'destination_url', '')), ''),
    locations          = v_locations,
    languages          = v_languages,
    audience_notes     = nullif(btrim(coalesce(p_data->>'audience_notes', '')), ''),
    daily_budget_cents = (p_data->>'daily_budget_cents')::int,
    total_budget_cents = (p_data->>'total_budget_cents')::int,
    starts_on          = (p_data->>'starts_on')::date,
    ends_on            = nullif(p_data->>'ends_on', '')::date
  where id = p_campaign;
end;
$$;

-- Edição de conteúdo: só em rascunho. Se estiver aprovada, a aprovação é anulada.
create or replace function private.open_for_edit(p_campaign uuid, p_actor uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status in ('publishing', 'active', 'paused', 'ended', 'archived') then
    raise exception 'campaign_locked' using errcode = 'P0001';
  end if;
  if c.status in ('approved', 'failed', 'rejected') then
    update public.campaign_approvals
       set revoked_at = now(), revoked_by = p_actor, revoked_reason = 'Campanha alterada depois de aprovada.'
     where id = c.approval_id and revoked_at is null;
    update public.campaigns set status = 'draft', approval_id = null where id = p_campaign;
    perform private.campaign_event(p_campaign, c.organization_id, p_actor, 'approval_revoked',
      jsonb_build_object('reason', 'edited', 'previous_status', c.status));
    c.status := 'draft';
  end if;
  return c;
end;
$$;

-- =============================================================================
-- Funções da aplicação (utilizador autenticado)
-- =============================================================================

create or replace function public.update_ad_budget_settings(
  p_org uuid, p_max_daily_cents int, p_max_campaign_total_cents int, p_max_all_daily_cents int, p_alert_pct int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'settings.manage');
  v_before jsonb;
begin
  select to_jsonb(s) - 'organization_id' - 'updated_by' - 'updated_at' into v_before
  from public.ad_budget_settings s where organization_id = p_org;

  insert into public.ad_budget_settings as s
    (organization_id, max_daily_cents, max_campaign_total_cents, max_all_daily_cents, alert_pct, updated_by)
  values (p_org, p_max_daily_cents, p_max_campaign_total_cents, p_max_all_daily_cents, p_alert_pct, v_uid)
  on conflict (organization_id) do update set
    max_daily_cents = excluded.max_daily_cents,
    max_campaign_total_cents = excluded.max_campaign_total_cents,
    max_all_daily_cents = excluded.max_all_daily_cents,
    alert_pct = excluded.alert_pct,
    updated_by = v_uid,
    updated_at = now();

  perform private.write_audit(p_org, v_uid, 'ads.budget_limits_updated', 'organization', p_org::text,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'max_daily_cents', p_max_daily_cents, 'max_campaign_total_cents', p_max_campaign_total_cents,
      'max_all_daily_cents', p_max_all_daily_cents, 'alert_pct', p_alert_pct)));
end;
$$;

create or replace function public.create_campaign(p_org uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'campaigns.write');
  v_id uuid;
begin
  insert into public.campaigns (organization_id, name, service_label, objective, destination, locations,
    daily_budget_cents, total_budget_cents, starts_on, created_by)
  values (p_org, 'nova', 'nova', 'messages', 'whatsapp', '{Portugal}', 100, 100, current_date, v_uid)
  returning id into v_id;
  perform private.apply_campaign_basics(v_id, p_data);
  perform private.check_campaign_budget(
    p_org, v_id, (p_data->>'daily_budget_cents')::int, (p_data->>'total_budget_cents')::int, false);
  perform private.campaign_event(v_id, p_org, v_uid, 'created', jsonb_build_object(
    'daily_budget_cents', (p_data->>'daily_budget_cents')::int,
    'total_budget_cents', (p_data->>'total_budget_cents')::int));
  return v_id;
end;
$$;

create or replace function public.update_campaign(p_campaign uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid;
  v_before public.campaigns;
  v_after public.campaigns;
begin
  select organization_id into v_org from public.campaigns where id = p_campaign;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_org, 'campaigns.write');
  v_before := private.open_for_edit(p_campaign, v_uid);
  perform private.apply_campaign_basics(p_campaign, p_data);
  select * into v_after from public.campaigns where id = p_campaign;
  perform private.check_campaign_budget(v_org, p_campaign, v_after.daily_budget_cents, v_after.total_budget_cents, false);
  perform private.campaign_event(p_campaign, v_org, v_uid, 'updated', jsonb_build_object(
    'budget_changed', (v_before.daily_budget_cents, v_before.total_budget_cents)
                      is distinct from (v_after.daily_budget_cents, v_after.total_budget_cents),
    'daily_budget_cents', jsonb_build_array(v_before.daily_budget_cents, v_after.daily_budget_cents),
    'total_budget_cents', jsonb_build_array(v_before.total_budget_cents, v_after.total_budget_cents)));
end;
$$;

-- Anúncios e plano. Sem parâmetros de orçamento: a IA nunca mexe em dinheiro.
create or replace function public.set_campaign_content(
  p_campaign uuid, p_ads jsonb, p_plan jsonb default null, p_model text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid;
  v_count int := jsonb_array_length(coalesce(p_ads, '[]'::jsonb));
  v_ad jsonb;
  v_i int := 0;
  v_old jsonb;
begin
  select organization_id into v_org from public.campaigns where id = p_campaign;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_org, 'campaigns.write');
  if v_count < 1 or v_count > 5 then
    raise exception 'invalid_ads_count' using errcode = 'P0001';
  end if;
  perform private.open_for_edit(p_campaign, v_uid);

  -- As imagens já carregadas mantêm-se na mesma posição se não vierem indicadas.
  select coalesce(jsonb_object_agg(position::text, image_path), '{}'::jsonb) into v_old
  from public.campaign_ads where campaign_id = p_campaign and image_path is not null;
  delete from public.campaign_ads where campaign_id = p_campaign;

  for v_ad in select * from jsonb_array_elements(p_ads) loop
    insert into public.campaign_ads (campaign_id, organization_id, position, primary_text, headline,
      description, cta, image_brief, image_path)
    values (p_campaign, v_org, v_i, btrim(v_ad->>'primary_text'), btrim(v_ad->>'headline'),
      nullif(btrim(coalesce(v_ad->>'description', '')), ''), v_ad->>'cta',
      nullif(btrim(coalesce(v_ad->>'image_brief', '')), ''),
      case when v_ad ? 'image_path' then nullif(v_ad->>'image_path', '')
           else v_old->>(v_i::text) end);
    v_i := v_i + 1;
  end loop;

  if p_plan is not null then
    update public.campaigns
       set plan = p_plan, plan_model = left(p_model, 80), plan_generated_at = now()
     where id = p_campaign;
  end if;
  perform private.campaign_event(p_campaign, v_org, v_uid,
    case when p_model is not null then 'ai_generated' else 'ads_updated' end,
    jsonb_build_object('ads', v_count, 'model', p_model));
end;
$$;

create or replace function public.approve_campaign(
  p_campaign uuid, p_content_hash text, p_daily_cents int, p_total_cents int, p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_uid uuid;
  v_hash text;
  v_id uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(c.organization_id, 'campaigns.publish');
  if c.status <> 'draft' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.campaign_ads where campaign_id = p_campaign) then
    raise exception 'no_ads' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.campaign_ads where campaign_id = p_campaign and image_path is null) then
    raise exception 'missing_images' using errcode = 'P0001';
  end if;

  v_hash := private.campaign_content_hash(p_campaign);
  -- O que a pessoa viu tem de ser exatamente o que está gravado.
  if p_content_hash is distinct from v_hash then
    raise exception 'campaign_changed' using errcode = 'P0001';
  end if;
  if p_daily_cents is distinct from c.daily_budget_cents or p_total_cents is distinct from c.total_budget_cents then
    raise exception 'budget_mismatch' using errcode = 'P0001';
  end if;
  -- Revisão de conformidade feita sobre este conteúdo e sem bloqueios.
  if c.compliance_hash is distinct from v_hash then
    raise exception 'compliance_required' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(c.compliance->'issues', '[]'::jsonb)) i
    where i->>'severity' = 'block'
  ) then
    raise exception 'compliance_blocked' using errcode = 'P0001';
  end if;
  if c.starts_on < (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  perform private.check_campaign_budget(c.organization_id, p_campaign, c.daily_budget_cents, c.total_budget_cents, true);
  -- Não aprovar em duplicado uma campanha igual que já está em curso.
  if exists (
    select 1 from public.campaigns o
    join public.campaign_approvals a on a.id = o.approval_id
    where o.organization_id = c.organization_id and o.id <> c.id
      and o.status in ('approved', 'publishing', 'active', 'paused')
      and a.content_hash = v_hash
  ) then
    raise exception 'duplicate_campaign' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_statement, '')) < 20 then
    raise exception 'statement_required' using errcode = 'P0001';
  end if;

  insert into public.campaign_approvals (campaign_id, organization_id, approved_by, content_hash,
    daily_budget_cents, total_budget_cents, starts_on, ends_on, statement)
  values (p_campaign, c.organization_id, v_uid, v_hash, c.daily_budget_cents, c.total_budget_cents,
    c.starts_on, c.ends_on, p_statement)
  returning id into v_id;
  update public.campaigns set status = 'approved', approval_id = v_id, last_error = null where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, v_uid, 'approved', jsonb_build_object(
    'approval_id', v_id, 'daily_budget_cents', c.daily_budget_cents, 'total_budget_cents', c.total_budget_cents));
  perform private.write_audit(c.organization_id, v_uid, 'ads.campaign_approved', 'campaign', p_campaign::text,
    jsonb_build_object('daily_budget_cents', c.daily_budget_cents, 'total_budget_cents', c.total_budget_cents));
  return v_id;
end;
$$;

create or replace function public.revoke_campaign_approval(p_campaign uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_uid uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(c.organization_id, 'campaigns.publish');
  if c.status not in ('approved', 'failed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update public.campaign_approvals
     set revoked_at = now(), revoked_by = v_uid, revoked_reason = left(coalesce(p_reason, 'Anulada'), 300)
   where id = c.approval_id and revoked_at is null;
  update public.campaigns set status = 'draft', approval_id = null where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, v_uid, 'approval_revoked',
    jsonb_build_object('reason', left(p_reason, 300)));
end;
$$;

-- Pedido de publicação. Idempotente: se já está a publicar ou publicada,
-- devolve a mesma chave e não cria nada de novo.
create or replace function public.request_campaign_publish(p_campaign uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_uid uuid;
  v_account uuid;
  v_key uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(c.organization_id, 'campaigns.publish');

  if c.status in ('publishing', 'active', 'paused') then
    return jsonb_build_object('publish_key', c.publish_key, 'already', true, 'status', c.status);
  end if;
  if c.status not in ('approved', 'failed') then
    raise exception 'not_approved' using errcode = 'P0001';
  end if;
  -- A aprovação tem de continuar válida para este conteúdo.
  if not exists (
    select 1 from public.campaign_approvals a
    where a.id = c.approval_id and a.revoked_at is null
      and a.content_hash = private.campaign_content_hash(p_campaign)
  ) then
    raise exception 'not_approved' using errcode = 'P0001';
  end if;
  -- Os limites podem ter mudado desde a aprovação.
  perform private.check_campaign_budget(c.organization_id, p_campaign, c.daily_budget_cents, c.total_budget_cents, true);

  select id into v_account from public.ad_accounts
  where organization_id = c.organization_id and provider = 'meta' and status = 'connected';
  if v_account is null then
    raise exception 'ad_account_not_connected' using errcode = 'P0001';
  end if;

  v_key := coalesce(c.publish_key, gen_random_uuid());
  update public.campaigns
     set status = 'publishing', publish_key = v_key, ad_account_id = v_account, last_error = null
   where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, v_uid, 'publish_requested',
    jsonb_build_object('publish_key', v_key, 'retry', c.status = 'failed'));
  return jsonb_build_object('publish_key', v_key, 'already', false, 'status', 'publishing');
end;
$$;

-- Pedido de pausa/retoma/fim. O estado só muda quando a plataforma confirma
-- (confirm_campaign_status, chamada pelo servidor).
create or replace function public.authorize_campaign_status(p_campaign uuid, p_target text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_uid uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(c.organization_id, 'campaigns.publish');
  if p_target = 'paused' and c.status = 'active' then
    null;
  elsif p_target = 'ended' and c.status in ('active', 'paused') then
    null;
  elsif p_target = 'active' and c.status = 'paused' then
    -- Retomar volta a gastar: limites e aprovação têm de continuar válidos.
    if not exists (
      select 1 from public.campaign_approvals a
      where a.id = c.approval_id and a.revoked_at is null
        and a.content_hash = private.campaign_content_hash(p_campaign)
    ) then
      raise exception 'not_approved' using errcode = 'P0001';
    end if;
    if c.spend_cents >= c.total_budget_cents then
      raise exception 'budget_exhausted' using errcode = 'P0001';
    end if;
    perform private.check_campaign_budget(c.organization_id, p_campaign, c.daily_budget_cents, c.total_budget_cents, true);
  else
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  perform private.campaign_event(p_campaign, c.organization_id, v_uid, 'status_change_requested',
    jsonb_build_object('from', c.status, 'to', p_target));
end;
$$;

create or replace function public.archive_campaign(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_uid uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(c.organization_id, 'campaigns.write');
  if c.status not in ('draft', 'rejected', 'ended', 'failed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if c.status = 'failed' and c.external_campaign_id is not null then
    -- Já existe algo na plataforma: tem de ser terminado lá primeiro.
    raise exception 'campaign_locked' using errcode = 'P0001';
  end if;
  update public.campaigns set status = 'archived' where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, v_uid, 'archived', '{}'::jsonb);
end;
$$;

-- Ligação da conta Meta (o token chega já cifrado pela aplicação).
create or replace function public.connect_ad_account(
  p_org uuid, p_external_id text, p_name text, p_currency text, p_page_id text,
  p_whatsapp_number text, p_token_ciphertext text, p_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'campaigns.publish');
  v_id uuid;
begin
  if p_token_ciphertext is null or char_length(p_token_ciphertext) < 20 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  update public.ad_accounts set status = 'disconnected'
   where organization_id = p_org and provider = 'meta' and status = 'connected' and external_id <> p_external_id;
  insert into public.ad_accounts as a (organization_id, provider, external_id, name, currency, page_id,
    whatsapp_number, status, token_ciphertext, token_expires_at, connected_by, connected_at, last_error)
  values (p_org, 'meta', p_external_id, p_name, upper(coalesce(p_currency, 'EUR')), p_page_id,
    p_whatsapp_number, 'connected', p_token_ciphertext, p_token_expires_at, v_uid, now(), null)
  on conflict (organization_id, provider, external_id) do update set
    name = excluded.name, currency = excluded.currency, page_id = excluded.page_id,
    whatsapp_number = excluded.whatsapp_number, status = 'connected',
    token_ciphertext = excluded.token_ciphertext, token_expires_at = excluded.token_expires_at,
    connected_by = v_uid, connected_at = now(), last_error = null
  returning id into v_id;
  perform private.write_audit(p_org, v_uid, 'ads.account_connected', 'ad_account', v_id::text,
    jsonb_build_object('external_id', p_external_id));
  return v_id;
end;
$$;

create or replace function public.disconnect_ad_account(p_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.ad_accounts;
  v_uid uuid;
begin
  select * into a from public.ad_accounts where id = p_account;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(a.organization_id, 'campaigns.publish');
  update public.ad_accounts set status = 'disconnected', token_ciphertext = null where id = p_account;
  perform private.write_audit(a.organization_id, v_uid, 'ads.account_disconnected', 'ad_account', p_account::text, '{}'::jsonb);
end;
$$;

-- Relatório de marketing: métricas da plataforma e números internos, separados.
create or replace function public.marketing_report(p_org uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not (private.has_permission(p_org, 'reports.read') or private.has_permission(p_org, 'campaigns.read')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to := ((p_to + 1)::timestamp) at time zone v_tz;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'campaigns', coalesce((
      select jsonb_agg(row_to_json(x) order by x.spend_cents desc, x.name)
      from (
        select c.id, c.name, c.status,
          coalesce(sum(m.impressions), 0) as impressions,
          coalesce(sum(m.reach), 0) as reach_sum_daily,
          coalesce(sum(m.clicks), 0) as clicks,
          coalesce(sum(m.conversations_started), 0) as conversations_started,
          coalesce(sum(m.leads), 0) as leads,
          coalesce(sum(m.spend_cents), 0) as spend_cents,
          max(m.fetched_at) as last_fetched_at,
          (select count(*) from public.contacts k
            where k.attributed_campaign_id = c.id and k.created_at >= v_from and k.created_at < v_to) as contacts_attributed,
          (select count(*) from public.contacts k
            where k.attributed_campaign_id = c.id and k.created_at >= v_from and k.created_at < v_to
              and k.status in ('consultation_proposed', 'consultation_booked', 'converted')) as contacts_qualified,
          (select count(*) from public.appointments ap join public.contacts k on k.id = ap.contact_id
            where k.attributed_campaign_id = c.id and ap.created_at >= v_from and ap.created_at < v_to
              and ap.status <> 'cancelled') as appointments_booked
        from public.campaigns c
        left join public.campaign_metrics_daily m on m.campaign_id = c.id and m.day between p_from and p_to
        where c.organization_id = p_org and c.status not in ('draft', 'archived')
        group by c.id
      ) x), '[]'::jsonb),
    'contacts_from_ads_unattributed', (
      select count(*) from public.contacts k
      where k.organization_id = p_org and k.source = 'ads' and k.attributed_campaign_id is null
        and k.created_at >= v_from and k.created_at < v_to)
  );
end;
$$;

-- =============================================================================
-- Funções do servidor (service_role): publicação, estado real e métricas
-- =============================================================================

create or replace function public.campaign_publish_progress(p_campaign uuid, p_publish_key uuid, p_external_ids jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaigns
     set external_ids = external_ids || coalesce(p_external_ids, '{}'::jsonb),
         external_campaign_id = coalesce(external_campaign_id, p_external_ids->>'campaign')
   where id = p_campaign and publish_key = p_publish_key and status = 'publishing';
  if not found then
    raise exception 'stale_publish' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.mark_campaign_published(
  p_campaign uuid, p_publish_key uuid, p_external_status text, p_ads jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  v_ad jsonb;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or c.publish_key is distinct from p_publish_key then
    raise exception 'stale_publish' using errcode = 'P0001';
  end if;
  if c.status in ('active', 'paused') then
    return; -- já confirmado (repetição)
  end if;
  if c.status <> 'publishing' or c.external_campaign_id is null then
    raise exception 'stale_publish' using errcode = 'P0001';
  end if;
  for v_ad in select * from jsonb_array_elements(coalesce(p_ads, '[]'::jsonb)) loop
    update public.campaign_ads
       set external_creative_id = v_ad->>'creative_id', external_ad_id = v_ad->>'ad_id'
     where campaign_id = p_campaign and position = (v_ad->>'position')::int;
  end loop;
  update public.campaigns
     set status = case when upper(p_external_status) = 'ACTIVE' then 'active'::public.campaign_status
                       else 'paused'::public.campaign_status end,
         external_status = upper(p_external_status), last_error = null, last_synced_at = now()
   where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, null, 'published',
    jsonb_build_object('external_campaign_id', c.external_campaign_id, 'external_status', upper(p_external_status)));
end;
$$;

create or replace function public.mark_campaign_publish_failed(p_campaign uuid, p_publish_key uuid, p_error text, p_rejected boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or c.publish_key is distinct from p_publish_key or c.status <> 'publishing' then
    raise exception 'stale_publish' using errcode = 'P0001';
  end if;
  update public.campaigns
     set status = case when p_rejected then 'rejected'::public.campaign_status else 'failed'::public.campaign_status end,
         last_error = left(p_error, 1000)
   where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, null,
    case when p_rejected then 'rejected' else 'publish_failed' end, jsonb_build_object('error', left(p_error, 500)));
end;
$$;

create or replace function public.confirm_campaign_status(
  p_campaign uuid, p_status public.campaign_status, p_external_status text, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_status not in ('active', 'paused', 'ended', 'rejected') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if c.status not in ('active', 'paused', 'publishing') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if c.status = p_status then
    update public.campaigns set external_status = upper(p_external_status), last_synced_at = now() where id = p_campaign;
    return;
  end if;
  update public.campaigns
     set status = p_status, external_status = upper(p_external_status), last_synced_at = now()
   where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, p_actor, 'status_confirmed',
    jsonb_build_object('from', c.status, 'to', p_status, 'external_status', upper(p_external_status)));
end;
$$;

-- Métricas diárias vindas da plataforma. Devolve se é preciso alertar.
create or replace function public.record_campaign_metrics(p_campaign uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  s public.ad_budget_settings;
  v_row jsonb;
  v_spend bigint;
  v_alert text := null;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.campaign_metrics_daily as m (campaign_id, organization_id, day, impressions, reach,
      clicks, conversations_started, leads, spend_cents, fetched_at)
    values (p_campaign, c.organization_id, (v_row->>'day')::date,
      coalesce((v_row->>'impressions')::bigint, 0), coalesce((v_row->>'reach')::bigint, 0),
      coalesce((v_row->>'clicks')::bigint, 0), coalesce((v_row->>'conversations_started')::bigint, 0),
      coalesce((v_row->>'leads')::bigint, 0), coalesce((v_row->>'spend_cents')::bigint, 0), now())
    on conflict (campaign_id, day) do update set
      impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks,
      conversations_started = excluded.conversations_started, leads = excluded.leads,
      spend_cents = excluded.spend_cents, fetched_at = now();
  end loop;

  select coalesce(sum(spend_cents), 0) into v_spend from public.campaign_metrics_daily where campaign_id = p_campaign;
  update public.campaigns set spend_cents = v_spend, last_synced_at = now() where id = p_campaign;

  select * into s from public.ad_budget_settings where organization_id = c.organization_id;
  if v_spend >= c.total_budget_cents then
    if not exists (select 1 from public.campaign_events where campaign_id = p_campaign and kind = 'budget_exhausted') then
      v_alert := 'budget_exhausted';
      update public.campaigns set alert_sent_at = coalesce(alert_sent_at, now()) where id = p_campaign;
    end if;
  elsif c.alert_sent_at is null
        and v_spend * 100 >= c.total_budget_cents::bigint * coalesce(s.alert_pct, 80) then
    v_alert := 'budget_alert';
    update public.campaigns set alert_sent_at = now() where id = p_campaign;
  end if;
  if v_alert is not null then
    perform private.campaign_event(p_campaign, c.organization_id, null, v_alert, jsonb_build_object(
      'spend_cents', v_spend, 'total_budget_cents', c.total_budget_cents));
  end if;
  return jsonb_build_object('spend_cents', v_spend, 'alert', v_alert);
end;
$$;

-- Clique num anúncio "Click to WhatsApp": a Meta indica o anúncio de origem.
create or replace function public.attribute_contact_to_ad(p_contact uuid, p_external_ad_id text, p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contacts;
  v_campaign uuid;
begin
  select * into k from public.contacts where id = p_contact for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select a.campaign_id into v_campaign from public.campaign_ads a
  where a.organization_id = k.organization_id and a.external_ad_id = p_external_ad_id
  limit 1;
  if v_campaign is null then
    return null; -- anúncio desconhecido: não se atribui por palpite
  end if;
  if k.attributed_campaign_id is null then
    update public.contacts
       set attributed_campaign_id = v_campaign,
           source = case when source in ('whatsapp', 'manual') then 'ads'::public.contact_source else source end,
           attribution = coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
             'external_ad_id', p_external_ad_id, 'attributed_at', now(), 'model', 'first_touch_ctwa')
     where id = p_contact;
  end if;
  return v_campaign;
end;
$$;

-- =============================================================================
-- Armazenamento das imagens dos anúncios (só no Supabase real)
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ad-creatives', 'ad-creatives', false, 4194304, array['image/jpeg', 'image/png'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- =============================================================================
-- Permissões de execução
-- =============================================================================
revoke all on function
  private.campaign_event(uuid, uuid, uuid, text, jsonb),
  private.campaign_content_hash(uuid),
  private.check_campaign_budget(uuid, uuid, int, int, boolean),
  private.apply_campaign_basics(uuid, jsonb),
  private.open_for_edit(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.update_ad_budget_settings(uuid, int, int, int, int),
  public.create_campaign(uuid, jsonb),
  public.update_campaign(uuid, jsonb),
  public.set_campaign_content(uuid, jsonb, jsonb, text),
  public.approve_campaign(uuid, text, int, int, text),
  public.revoke_campaign_approval(uuid, text),
  public.request_campaign_publish(uuid),
  public.authorize_campaign_status(uuid, text),
  public.archive_campaign(uuid),
  public.connect_ad_account(uuid, text, text, text, text, text, text, timestamptz),
  public.disconnect_ad_account(uuid),
  public.marketing_report(uuid, date, date),
  public.campaign_publish_progress(uuid, uuid, jsonb),
  public.mark_campaign_published(uuid, uuid, text, jsonb),
  public.mark_campaign_publish_failed(uuid, uuid, text, boolean),
  public.confirm_campaign_status(uuid, public.campaign_status, text, uuid),
  public.record_campaign_metrics(uuid, jsonb),
  public.attribute_contact_to_ad(uuid, text, jsonb)
from public, anon;

grant execute on function
  public.update_ad_budget_settings(uuid, int, int, int, int),
  public.create_campaign(uuid, jsonb),
  public.update_campaign(uuid, jsonb),
  public.set_campaign_content(uuid, jsonb, jsonb, text),
  public.approve_campaign(uuid, text, int, int, text),
  public.revoke_campaign_approval(uuid, text),
  public.request_campaign_publish(uuid),
  public.authorize_campaign_status(uuid, text),
  public.archive_campaign(uuid),
  public.connect_ad_account(uuid, text, text, text, text, text, text, timestamptz),
  public.disconnect_ad_account(uuid),
  public.marketing_report(uuid, date, date)
to authenticated;

revoke execute on function
  public.campaign_publish_progress(uuid, uuid, jsonb),
  public.mark_campaign_published(uuid, uuid, text, jsonb),
  public.mark_campaign_publish_failed(uuid, uuid, text, boolean),
  public.confirm_campaign_status(uuid, public.campaign_status, text, uuid),
  public.record_campaign_metrics(uuid, jsonb),
  public.attribute_contact_to_ad(uuid, text, jsonb)
from authenticated;
grant execute on function
  public.campaign_publish_progress(uuid, uuid, jsonb),
  public.mark_campaign_published(uuid, uuid, text, jsonb),
  public.mark_campaign_publish_failed(uuid, uuid, text, boolean),
  public.confirm_campaign_status(uuid, public.campaign_status, text, uuid),
  public.record_campaign_metrics(uuid, jsonb),
  public.attribute_contact_to_ad(uuid, text, jsonb)
to service_role;

-- Revisão de conformidade: calculada no servidor e gravada só por ele, para
-- que um utilizador não consiga "aprovar-se" com um resultado forjado.
create or replace function public.record_campaign_compliance(p_campaign uuid, p_content_hash text, p_result jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'draft' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  -- O resultado só vale para o conteúdo que foi analisado.
  if p_content_hash is distinct from private.campaign_content_hash(p_campaign) then
    raise exception 'campaign_changed' using errcode = 'P0001';
  end if;
  update public.campaigns set compliance = p_result, compliance_hash = p_content_hash where id = p_campaign;
  perform private.campaign_event(p_campaign, c.organization_id, p_actor, 'compliance_checked', jsonb_build_object(
    'blocking', (select count(*) from jsonb_array_elements(coalesce(p_result->'issues', '[]'::jsonb)) i where i->>'severity' = 'block'),
    'warnings', (select count(*) from jsonb_array_elements(coalesce(p_result->'issues', '[]'::jsonb)) i where i->>'severity' = 'warn')));
end;
$$;
revoke execute on function public.record_campaign_compliance(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_campaign_compliance(uuid, text, jsonb, uuid) to service_role;

-- Leitura do hash atual (para a página de aprovação mostrar o que vai ser aprovado).
create or replace function public.campaign_content_hash(p_campaign uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.campaigns where id = p_campaign;
  if v_org is null or not private.has_permission(v_org, 'campaigns.read') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return private.campaign_content_hash(p_campaign);
end;
$$;
revoke execute on function public.campaign_content_hash(uuid) from public, anon;
grant execute on function public.campaign_content_hash(uuid) to authenticated, service_role;
