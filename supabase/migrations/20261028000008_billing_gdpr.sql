-- =============================================================================
-- Fase 6 — Comercialização: planos, subscrições, limites, faturação (Stripe),
-- retenção de dados, exportação e eliminação do escritório (RGPD).
--
-- Garantias na base de dados:
--  * Preços, limites e funcionalidades vivem na tabela `plans` (configuráveis
--    pelo administrador da plataforma), não no código.
--  * Limites do plano aplicados no servidor: membros, respostas da IA por mês,
--    gerações de campanhas por mês, campanhas em curso e documentos jurídicos.
--  * Subscrição inativa (teste expirado, cancelada, por pagar além da
--    tolerância): os dados continuam acessíveis e exportáveis, mas a IA e a
--    publicação de campanhas param.
--  * Só o servidor (webhook do Stripe, com assinatura verificada) altera o
--    estado da subscrição. Eventos repetidos não se aplicam duas vezes.
--  * Nenhum dado de cartão é guardado: os pagamentos são do Stripe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissão nova: eliminar o escritório e exportar todos os dados (só admin).
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values ('org_admin', 'org.delete')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Planos
-- -----------------------------------------------------------------------------
create table public.plans (
  id               text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  description      text check (description is null or char_length(description) <= 500),
  price_cents      int check (price_cents is null or price_cents >= 0),
  currency         text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  stripe_price_id  text unique check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  -- Limites: chave → inteiro (null ou ausente = sem limite).
  limits           jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  features         jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  is_public        boolean not null default true,
  position         int not null default 0,
  updated_at       timestamptz not null default now()
);
create trigger plans_touch before update on public.plans
  for each row execute function private.touch_updated_at();

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (is_public or private.is_platform_admin());
grant select on public.plans to authenticated;

-- Valores iniciais: PROPOSTA a confirmar pelo dono da plataforma (preços sem IVA).
insert into public.plans (id, name, description, price_cents, limits, features, position) values
  ('essencial', 'Essencial', 'Para quem trabalha sozinho ou com um assistente.', 4900,
   '{"members": 2, "ai_replies_month": 500, "ad_generations_month": 10, "active_campaigns": 1, "knowledge_docs": 50}',
   '["Assistente de IA no WhatsApp", "Caixa de entrada e contactos", "Agenda com marcação pelo assistente", "Base jurídica comum", "1 campanha em curso"]', 1),
  ('profissional', 'Profissional', 'Para escritórios com equipa e captação regular.', 9900,
   '{"members": 6, "ai_replies_month": 2000, "ad_generations_month": 40, "active_campaigns": 3, "knowledge_docs": 300}',
   '["Tudo do Essencial", "Até 6 membros", "Base jurídica privada do escritório", "3 campanhas em curso", "Relatórios de marketing"]', 2),
  ('premium', 'Premium', 'Para escritórios com vários advogados e volume elevado.', 19900,
   '{"members": 20, "ai_replies_month": 8000, "ad_generations_month": 150, "active_campaigns": 10, "knowledge_docs": 2000}',
   '["Tudo do Profissional", "Até 20 membros", "10 campanhas em curso", "Volume elevado de respostas da IA"]', 3);

-- -----------------------------------------------------------------------------
-- Subscrições (uma por escritório)
-- -----------------------------------------------------------------------------
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid');

create table public.subscriptions (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  status                 public.subscription_status not null default 'trialing',
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function private.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (private.is_member(organization_id));
grant select on public.subscriptions to authenticated;

-- Escritório novo: 14 dias de teste no plano Profissional.
create or replace function private.start_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  values (new.id, 'profissional', 'trialing', now() + interval '14 days')
  on conflict do nothing;
  return new;
end;
$$;
create trigger organizations_start_trial after insert on public.organizations
  for each row execute function private.start_trial();

-- Escritórios já existentes: o teste começa agora.
insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
select id, 'profissional', 'trialing', now() + interval '14 days' from public.organizations
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Faturas e eventos do Stripe
-- -----------------------------------------------------------------------------
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  stripe_invoice_id  text not null unique,
  number             text,
  status             text not null,
  amount_due_cents   int not null default 0,
  amount_paid_cents  int not null default 0,
  currency           text not null default 'EUR',
  hosted_invoice_url text check (hosted_invoice_url is null or hosted_invoice_url ~ '^https://'),
  invoice_pdf        text check (invoice_pdf is null or invoice_pdf ~ '^https://'),
  period_start       timestamptz,
  period_end         timestamptz,
  issued_at          timestamptz not null default now()
);
create index invoices_org_idx on public.invoices (organization_id, issued_at desc);
alter table public.invoices enable row level security;
create policy invoices_read on public.invoices for select to authenticated
  using (private.has_permission(organization_id, 'billing.manage'));
grant select on public.invoices to authenticated;

create table public.billing_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);
alter table public.billing_events enable row level security; -- sem políticas: só o servidor

-- -----------------------------------------------------------------------------
-- Direitos (plano + estado) e consumo
-- -----------------------------------------------------------------------------
create or replace function private.entitlements(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  p public.plans;
  v_active boolean;
  v_reason text;
begin
  select * into s from public.subscriptions where organization_id = p_org;
  if not found then
    return jsonb_build_object('active', false, 'reason', 'no_subscription', 'limits', '{}'::jsonb);
  end if;
  select * into p from public.plans where id = s.plan_id;
  v_active := case s.status
    when 'active' then true
    when 'trialing' then coalesce(s.trial_ends_at > now(), false)
    -- Tolerância de 7 dias para regularizar o pagamento.
    when 'past_due' then coalesce(s.current_period_end + interval '7 days' > now(), false)
    else false
  end;
  v_reason := case
    when v_active then null
    when s.status = 'trialing' then 'trial_expired'
    when s.status = 'past_due' then 'payment_overdue'
    else 'subscription_inactive'
  end;
  return jsonb_build_object(
    'plan', s.plan_id, 'plan_name', p.name, 'status', s.status, 'active', v_active, 'reason', v_reason,
    'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end, 'limits', coalesce(p.limits, '{}'::jsonb));
end;
$$;

-- Início do mês no fuso do escritório.
create or replace function private.month_start(p_org uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', now() at time zone o.timezone) at time zone o.timezone
  from public.organizations o where o.id = p_org;
$$;

create index if not exists agent_runs_org_created_idx on public.agent_runs (organization_id, created_at);

create or replace function private.usage(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'members', (select count(*) from public.memberships m where m.organization_id = p_org and m.status = 'active'),
    'pending_invitations', (select count(*) from public.invitations i where i.organization_id = p_org
                              and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    -- Só conta chamadas reais ao modelo (com tokens), não encaminhamentos por falha.
    'ai_replies_month', (select count(*) from public.agent_runs r where r.organization_id = p_org
                           and r.input_tokens is not null and r.created_at >= private.month_start(p_org)),
    'ai_tokens_month', (select coalesce(sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)), 0)
                          from public.agent_runs r where r.organization_id = p_org and r.created_at >= private.month_start(p_org)),
    'ad_generations_month', (select count(*) from public.campaign_events e where e.organization_id = p_org
                               and e.kind = 'ai_generated' and e.created_at >= private.month_start(p_org)),
    'active_campaigns', (select count(*) from public.campaigns c where c.organization_id = p_org
                           and c.status in ('publishing', 'active', 'paused')),
    'knowledge_docs', (select count(*) from public.knowledge_documents d where d.organization_id = p_org
                         and d.status <> 'archived'),
    'month_start', private.month_start(p_org));
$$;

-- Lança 'subscription_inactive' ou 'plan_limit:<chave>' se não houver margem.
create or replace function private.assert_limit(p_org uuid, p_key text, p_current bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e jsonb := private.entitlements(p_org);
  v_limit int;
begin
  if not coalesce((e->>'active')::boolean, false) then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
  v_limit := (e->'limits'->>p_key)::int;
  if v_limit is not null and p_current >= v_limit then
    raise exception 'plan_limit:%', p_key using errcode = 'P0001';
  end if;
end;
$$;

-- Leitura para a interface (membros do escritório).
create or replace function public.org_billing_overview(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.entitlements(p_org) || jsonb_build_object('usage', private.usage(p_org));
end;
$$;
grant execute on function public.org_billing_overview(uuid) to authenticated;

-- Verificação antes de chamar a IA no atendimento (servidor).
create or replace function public.agent_entitlement(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_limit(p_org, 'ai_replies_month', (private.usage(p_org)->>'ai_replies_month')::bigint);
  return jsonb_build_object('allowed', true);
exception when others then
  if sqlerrm like 'plan_limit:%' or sqlerrm = 'subscription_inactive' then
    return jsonb_build_object('allowed', false, 'reason', sqlerrm);
  end if;
  raise;
end;
$$;
revoke execute on function public.agent_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.agent_entitlement(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Aplicação dos limites (gatilhos: valem para qualquer caminho de escrita)
-- -----------------------------------------------------------------------------
create or replace function private.enforce_invitation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare u jsonb := private.usage(new.organization_id);
begin
  perform private.assert_limit(new.organization_id, 'members',
    (u->>'members')::bigint + (u->>'pending_invitations')::bigint);
  return new;
end;
$$;
create trigger invitations_plan_limit before insert on public.invitations
  for each row execute function private.enforce_invitation_limit();

create or replace function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_members bigint;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  select count(*) into v_members from public.memberships
   where organization_id = new.organization_id and status = 'active' and id <> new.id;
  -- O primeiro membro (quem cria o escritório) entra sempre.
  if v_members > 0 then
    perform private.assert_limit(new.organization_id, 'members', v_members);
  end if;
  return new;
end;
$$;
create trigger memberships_plan_limit before insert or update of status on public.memberships
  for each row execute function private.enforce_member_limit();

create or replace function private.enforce_campaign_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_active bigint;
begin
  if new.status = 'publishing' and old.status is distinct from 'publishing' then
    select count(*) into v_active from public.campaigns
     where organization_id = new.organization_id and id <> new.id
       and status in ('publishing', 'active', 'paused');
    perform private.assert_limit(new.organization_id, 'active_campaigns', v_active);
  elsif new.status = 'active' and old.status = 'paused' then
    -- Retomar exige subscrição ativa (já conta como campanha em curso).
    perform private.assert_limit(new.organization_id, 'active_campaigns', 0);
  end if;
  return new;
end;
$$;
create trigger campaigns_plan_limit before update of status on public.campaigns
  for each row execute function private.enforce_campaign_limit();

create or replace function private.enforce_ad_generation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'ai_generated' then
    perform private.assert_limit(new.organization_id, 'ad_generations_month',
      (private.usage(new.organization_id)->>'ad_generations_month')::bigint);
  end if;
  return new;
end;
$$;
create trigger campaign_events_plan_limit before insert on public.campaign_events
  for each row execute function private.enforce_ad_generation_limit();

create or replace function private.enforce_knowledge_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not null then
    perform private.assert_limit(new.organization_id, 'knowledge_docs',
      (private.usage(new.organization_id)->>'knowledge_docs')::bigint);
  end if;
  return new;
end;
$$;
create trigger knowledge_documents_plan_limit before insert on public.knowledge_documents
  for each row execute function private.enforce_knowledge_limit();

-- -----------------------------------------------------------------------------
-- Stripe (só o servidor)
-- -----------------------------------------------------------------------------
create or replace function public.billing_register_event(p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_events (event_id, type) values (p_event_id, left(p_type, 100));
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.billing_set_customer(p_org uuid, p_customer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;
  update public.subscriptions set stripe_customer_id = p_customer
   where organization_id = p_org and (stripe_customer_id is null or stripe_customer_id = p_customer);
  if not found then
    raise exception 'customer_mismatch' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.billing_sync_subscription(
  p_customer text,
  p_subscription text,
  p_price text,
  p_status text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_org uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_plan text;
  v_status public.subscription_status;
  s public.subscriptions;
begin
  select organization_id into v_org from public.subscriptions where stripe_customer_id = p_customer;
  if v_org is null then
    v_org := p_org;
  elsif p_org is not null and p_org <> v_org then
    raise exception 'customer_mismatch' using errcode = 'P0001';
  end if;
  if v_org is null then
    raise exception 'unknown_customer' using errcode = 'P0002';
  end if;

  select id into v_plan from public.plans where stripe_price_id = p_price;
  if v_plan is null then
    raise exception 'unknown_price' using errcode = 'P0002';
  end if;

  v_status := case p_status
    when 'active' then 'active'
    when 'trialing' then 'trialing'
    when 'past_due' then 'past_due'
    when 'unpaid' then 'unpaid'
    when 'incomplete' then 'incomplete'
    else 'canceled'  -- canceled, incomplete_expired, paused
  end::public.subscription_status;

  select * into s from public.subscriptions where organization_id = v_org for update;
  update public.subscriptions
     set plan_id = v_plan,
         status = v_status,
         stripe_customer_id = p_customer,
         stripe_subscription_id = p_subscription,
         current_period_end = p_period_end,
         cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
         trial_ends_at = case when v_status = 'trialing' then coalesce(p_period_end, trial_ends_at) else trial_ends_at end
   where organization_id = v_org;

  if s.plan_id is distinct from v_plan or s.status is distinct from v_status
     or s.cancel_at_period_end is distinct from coalesce(p_cancel_at_period_end, false) then
    perform private.write_audit(v_org, null, 'billing.subscription_changed', 'subscription', p_subscription,
      jsonb_build_object('from_plan', s.plan_id, 'to_plan', v_plan, 'from_status', s.status, 'to_status', v_status,
                         'cancel_at_period_end', coalesce(p_cancel_at_period_end, false)));
  end if;
  return v_org;
end;
$$;

create or replace function public.billing_record_invoice(
  p_customer text,
  p_invoice text,
  p_number text,
  p_status text,
  p_amount_due int,
  p_amount_paid int,
  p_currency text,
  p_hosted_url text,
  p_pdf text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.subscriptions where stripe_customer_id = p_customer;
  if v_org is null then
    raise exception 'unknown_customer' using errcode = 'P0002';
  end if;
  insert into public.invoices (organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents,
                               currency, hosted_invoice_url, invoice_pdf, period_start, period_end)
  values (v_org, p_invoice, p_number, left(p_status, 30), coalesce(p_amount_due, 0), coalesce(p_amount_paid, 0),
          upper(coalesce(p_currency, 'EUR')), p_hosted_url, p_pdf, p_period_start, p_period_end)
  on conflict (stripe_invoice_id) do update
     set status = excluded.status, number = excluded.number, amount_due_cents = excluded.amount_due_cents,
         amount_paid_cents = excluded.amount_paid_cents, hosted_invoice_url = excluded.hosted_invoice_url,
         invoice_pdf = excluded.invoice_pdf;
end;
$$;

revoke execute on function public.billing_register_event(text, text) from public, anon, authenticated;
revoke execute on function public.billing_set_customer(uuid, text) from public, anon, authenticated;
revoke execute on function public.billing_sync_subscription(text, text, text, text, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.billing_record_invoice(text, text, text, text, int, int, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_register_event(text, text) to service_role;
grant execute on function public.billing_set_customer(uuid, text) to service_role;
grant execute on function public.billing_sync_subscription(text, text, text, text, timestamptz, boolean, uuid) to service_role;
grant execute on function public.billing_record_invoice(text, text, text, text, int, int, text, text, text, timestamptz, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- Administração da plataforma: editar planos
-- -----------------------------------------------------------------------------
create or replace function public.admin_upsert_plan(
  p_id text, p_name text, p_description text, p_price_cents int, p_stripe_price_id text,
  p_limits jsonb, p_features jsonb, p_is_public boolean, p_position int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare k text;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(coalesce(p_limits, '{}'::jsonb)) loop
    if k not in ('members', 'ai_replies_month', 'ad_generations_month', 'active_campaigns', 'knowledge_docs') then
      raise exception 'invalid_limit_key' using errcode = '22023';
    end if;
    if jsonb_typeof(p_limits->k) not in ('number', 'null') or (p_limits->>k)::numeric < 0 then
      raise exception 'invalid_limit_value' using errcode = '22023';
    end if;
  end loop;
  insert into public.plans (id, name, description, price_cents, stripe_price_id, limits, features, is_public, position)
  values (p_id, p_name, nullif(btrim(p_description), ''), p_price_cents, nullif(btrim(p_stripe_price_id), ''),
          coalesce(p_limits, '{}'::jsonb), coalesce(p_features, '[]'::jsonb), coalesce(p_is_public, true), coalesce(p_position, 0))
  on conflict (id) do update
     set name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
         stripe_price_id = excluded.stripe_price_id, limits = excluded.limits, features = excluded.features,
         is_public = excluded.is_public, position = excluded.position;
  perform private.write_audit(null, auth.uid(), 'platform.plan_updated', 'plan', p_id,
    jsonb_build_object('price_cents', p_price_cents, 'limits', p_limits, 'stripe_price_id', p_stripe_price_id));
end;
$$;
grant execute on function public.admin_upsert_plan(text, text, text, int, text, jsonb, jsonb, boolean, int) to authenticated;

-- -----------------------------------------------------------------------------
-- RGPD: retenção, exportação e eliminação do escritório
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column retention_months int not null default 24 check (retention_months between 6 and 120);

create or replace function public.update_retention(p_org uuid, p_months int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_permission(p_org, 'org.update');
declare v_old int;
begin
  select retention_months into v_old from public.organizations where id = p_org;
  update public.organizations set retention_months = p_months where id = p_org;
  perform private.write_audit(p_org, v_uid, 'org.retention_updated', 'organization', p_org::text,
    jsonb_build_object('from', v_old, 'to', p_months));
end;
$$;
grant execute on function public.update_retention(uuid, int) to authenticated;

-- Corre diariamente (servidor). Apaga conversas FECHADAS sem atividade há mais
-- do que o prazo do escritório (mensagens, notas e execuções da IA vão com
-- elas), e os registos técnicos de webhooks com mais de 30 dias.
create or replace function public.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv int;
  v_hooks int;
  v_billing int;
begin
  with gone as (
    delete from public.conversations c
     using public.organizations o
     where o.id = c.organization_id
       and c.status = 'closed'
       and coalesce(c.last_message_at, c.created_at) < now() - make_interval(months => o.retention_months)
    returning c.organization_id
  )
  select count(*) into v_conv from gone;

  delete from public.webhook_events where received_at < now() - interval '30 days';
  get diagnostics v_hooks = row_count;
  delete from public.billing_events where received_at < now() - interval '90 days';
  get diagnostics v_billing = row_count;

  if v_conv > 0 then
    perform private.write_audit(null, null, 'platform.retention_applied', null, null,
      jsonb_build_object('conversations', v_conv));
  end if;
  return jsonb_build_object('conversations', v_conv, 'webhook_events', v_hooks, 'billing_events', v_billing);
end;
$$;
revoke execute on function public.apply_retention() from public, anon, authenticated;
grant execute on function public.apply_retention() to service_role;

-- Registo mínimo de eliminações (sobrevive à eliminação do escritório).
create table public.organization_deletions (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  slug             text not null,
  deleted_by       uuid,
  reason           text,
  deleted_at       timestamptz not null default now()
);
alter table public.organization_deletions enable row level security;
create policy organization_deletions_platform on public.organization_deletions for select to authenticated
  using (private.is_platform_admin());
grant select on public.organization_deletions to authenticated;

create or replace function public.delete_organization(p_org uuid, p_confirm_slug text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'org.delete');
  o public.organizations;
begin
  select * into o from public.organizations where id = p_org for update;
  if lower(btrim(coalesce(p_confirm_slug, ''))) <> lower(o.slug::text) then
    raise exception 'confirmation_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.campaigns where organization_id = p_org and status in ('publishing', 'active')) then
    raise exception 'campaigns_running' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subscriptions where organization_id = p_org
             and stripe_subscription_id is not null and status in ('active', 'trialing', 'past_due')
             and not cancel_at_period_end) then
    raise exception 'subscription_active' using errcode = 'P0001';
  end if;
  insert into public.organization_deletions (organization_id, slug, deleted_by, reason)
  values (p_org, o.slug::text, v_uid, left(p_reason, 500));
  delete from public.organizations where id = p_org;
end;
$$;
grant execute on function public.delete_organization(uuid, text, text) to authenticated;
