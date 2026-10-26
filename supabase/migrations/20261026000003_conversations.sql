-- =============================================================================
-- Fase 2 — Atendimento: contactos, WhatsApp, conversas, mensagens.
--
-- Regras garantidas na base de dados (não só na aplicação):
--  * Mensagens e eventos de webhook repetidos não são duplicados.
--  * Quando um profissional assume a conversa, a IA não consegue responder.
--  * Membros só respondem dentro da janela de serviço de 24h da Meta.
--  * A ingestão de mensagens (webhook) só é possível com a chave de serviço.
-- =============================================================================

-- Nova permissão: eliminar contactos (pedidos RGPD). Admin e advogado.
insert into public.role_permissions (role, permission) values
  ('org_admin', 'contacts.delete'),
  ('lawyer', 'contacts.delete');

create type public.contact_status as enum (
  'new', 'in_progress', 'awaiting_info', 'consultation_proposed',
  'consultation_booked', 'converted', 'closed'
);
create type public.contact_source as enum ('whatsapp', 'ads', 'form', 'referral', 'manual');
create type public.conversation_mode as enum ('ai', 'human');
create type public.conversation_status as enum ('open', 'waiting', 'closed');
create type public.conversation_category as enum (
  'general', 'consultation', 'complex', 'urgent', 'data_request'
);
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_author as enum ('contact', 'ai', 'member', 'system');
create type public.message_status as enum ('received', 'queued', 'sent', 'delivered', 'read', 'failed');

-- -----------------------------------------------------------------------------
-- Contactos (potenciais clientes)
-- -----------------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  full_name        text check (full_name is null or char_length(full_name) <= 160),
  phone_e164       text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email            extensions.citext check (email is null or char_length(email::text) <= 254),
  locale           text check (locale is null or char_length(locale) <= 10),
  source           public.contact_source not null default 'manual',
  source_campaign  text check (source_campaign is null or char_length(source_campaign) <= 120),
  status           public.contact_status not null default 'new',
  service_interest text check (service_interest is null or char_length(service_interest) <= 160),
  assigned_to      uuid references auth.users (id) on delete set null,
  next_action      text check (next_action is null or char_length(next_action) <= 300),
  next_action_at   timestamptz,
  tags             text[] not null default '{}',
  -- Consentimentos registados: { "marketing": {"granted": true, "at": "...", "channel": "whatsapp"} }
  consents         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

create index contacts_org_status_idx on public.contacts (organization_id, status, created_at desc);
create trigger contacts_touch before update on public.contacts
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Contas WhatsApp (uma por escritório nesta fase)
-- O token de acesso NÃO fica aqui: guarda-se no cofre (Supabase Vault) e só a
-- referência é registada. `mode = simulation` é sempre visível na interface.
-- -----------------------------------------------------------------------------
create table public.whatsapp_accounts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null unique references public.organizations (id) on delete cascade,
  mode              text not null default 'simulation' check (mode in ('live', 'simulation')),
  phone_number_id   text unique check (phone_number_id is null or phone_number_id ~ '^[0-9A-Za-z_-]{3,64}$'),
  display_phone     text check (display_phone is null or char_length(display_phone) <= 32),
  waba_id           text check (waba_id is null or char_length(waba_id) <= 64),
  token_secret_id   uuid,
  status            text not null default 'pending'
                    check (status in ('pending', 'connected', 'error', 'disconnected')),
  agent_enabled     boolean not null default false,
  last_error        text,
  connected_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Uma conta "live" só pode estar ligada com número e token reais.
  check (mode = 'simulation' or status <> 'connected' or (phone_number_id is not null and token_secret_id is not null))
);

create trigger whatsapp_accounts_touch before update on public.whatsapp_accounts
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Conversas
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  contact_id           uuid not null references public.contacts (id) on delete cascade,
  whatsapp_account_id  uuid references public.whatsapp_accounts (id) on delete set null,
  mode                 public.conversation_mode not null default 'ai',
  status               public.conversation_status not null default 'open',
  category             public.conversation_category,
  is_urgent            boolean not null default false,
  assigned_to          uuid references auth.users (id) on delete set null,
  ai_summary           text check (ai_summary is null or char_length(ai_summary) <= 4000),
  handoff_reason       text check (handoff_reason is null or char_length(handoff_reason) <= 500),
  last_message_at      timestamptz,
  last_inbound_at      timestamptz,
  unread_count         int not null default 0 check (unread_count >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index conversations_inbox_idx
  on public.conversations (organization_id, status, last_message_at desc nulls last);
-- No máximo uma conversa aberta por contacto.
create unique index conversations_one_open_per_contact
  on public.conversations (contact_id) where status <> 'closed';

create trigger conversations_touch before update on public.conversations
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Mensagens
-- -----------------------------------------------------------------------------
create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  direction            public.message_direction not null,
  author               public.message_author not null,
  author_user_id       uuid references auth.users (id) on delete set null,
  body                 text check (body is null or char_length(body) <= 4096),
  media                jsonb,
  provider_message_id  text,
  status               public.message_status not null,
  error_code           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((author = 'member') = (author_user_id is not null))
);

-- Idempotência: o mesmo id do fornecedor nunca entra duas vezes.
create unique index messages_provider_id_unique
  on public.messages (provider_message_id) where provider_message_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create trigger messages_touch before update on public.messages
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Eventos de webhook (deduplicação). Não guarda o conteúdo: só o hash.
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id            bigint generated always as identity primary key,
  provider      text not null check (provider in ('whatsapp', 'meta_ads', 'stripe')),
  event_id      text not null,
  payload_hash  text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  unique (provider, event_id)
);

-- -----------------------------------------------------------------------------
-- Notas internas (nunca enviadas ao cliente)
-- -----------------------------------------------------------------------------
create table public.internal_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  author_user_id   uuid not null references auth.users (id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 4000),
  created_at       timestamptz not null default now()
);
create index internal_notes_conversation_idx on public.internal_notes (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- Execuções do agente de IA: rasto para revisão (fontes e versões usadas).
-- -----------------------------------------------------------------------------
create table public.agent_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  model            text not null,
  decision         text not null check (decision in ('answered', 'asked', 'handoff', 'refused', 'error')),
  category         public.conversation_category,
  sources          jsonb not null default '[]'::jsonb,
  input_tokens     int,
  output_tokens    int,
  error            text,
  created_at       timestamptz not null default now()
);
create index agent_runs_conversation_idx on public.agent_runs (conversation_id, created_at desc);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.contacts           enable row level security;
alter table public.whatsapp_accounts  enable row level security;
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.webhook_events     enable row level security;
alter table public.internal_notes     enable row level security;
alter table public.agent_runs         enable row level security;

revoke all on public.contacts, public.whatsapp_accounts, public.conversations, public.messages,
  public.webhook_events, public.internal_notes, public.agent_runs from anon;

-- Contactos
create policy contacts_select on public.contacts for select to authenticated
  using (private.has_permission(organization_id, 'contacts.read'));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (private.has_permission(organization_id, 'contacts.write'));
create policy contacts_update on public.contacts for update to authenticated
  using (private.has_permission(organization_id, 'contacts.write'))
  with check (private.has_permission(organization_id, 'contacts.write'));
revoke delete on public.contacts from authenticated; -- eliminação via RPC auditada

-- WhatsApp: membros do escritório veem o estado (para o aviso de simulação);
-- alterações só por RPC.
create policy whatsapp_accounts_select on public.whatsapp_accounts for select to authenticated
  using (private.is_member(organization_id));
revoke insert, update, delete on public.whatsapp_accounts from authenticated;
-- A referência ao segredo não é legível: concede-se leitura coluna a coluna.
revoke select on public.whatsapp_accounts from authenticated;
grant select (id, organization_id, mode, phone_number_id, display_phone, waba_id, status,
              agent_enabled, last_error, connected_at, created_at, updated_at)
  on public.whatsapp_accounts to authenticated;

-- Conversas e mensagens: leitura com conversations.read; escrita só por RPC.
create policy conversations_select on public.conversations for select to authenticated
  using (private.has_permission(organization_id, 'conversations.read'));
revoke insert, update, delete on public.conversations from authenticated;

create policy messages_select on public.messages for select to authenticated
  using (private.has_permission(organization_id, 'conversations.read'));
revoke insert, update, delete on public.messages from authenticated;

-- Webhooks: só a chave de serviço.
revoke all on public.webhook_events from authenticated;

-- Notas internas
create policy internal_notes_select on public.internal_notes for select to authenticated
  using (private.has_permission(organization_id, 'conversations.read'));
create policy internal_notes_insert on public.internal_notes for insert to authenticated
  with check (
    author_user_id = (select auth.uid())
    and private.has_permission(organization_id, 'conversations.reply')
    and exists (select 1 from public.conversations c
                where c.id = conversation_id and c.organization_id = internal_notes.organization_id)
  );
revoke update, delete on public.internal_notes from authenticated;

-- Execuções do agente
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (private.has_permission(organization_id, 'conversations.read'));
revoke insert, update, delete on public.agent_runs from authenticated;

-- =============================================================================
-- Helpers internos
-- =============================================================================
create or replace function private.lock_conversation(p_conversation uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.conversations%rowtype;
begin
  select * into v from public.conversations where id = p_conversation for update;
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function private.system_message(p_conv public.conversations, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (organization_id, conversation_id, direction, author, body, status)
  values (p_conv.organization_id, p_conv.id, 'outbound', 'system', p_body, 'sent');
$$;

revoke all on function private.lock_conversation(uuid) from public, anon, authenticated;
revoke all on function private.system_message(public.conversations, text) from public, anon, authenticated;

-- =============================================================================
-- Ingestão (apenas service_role — chamada pelo webhook no servidor)
-- =============================================================================

-- Regista um evento de webhook. Devolve false se já tinha sido recebido.
create or replace function public.register_webhook_event(p_provider text, p_event_id text, p_payload_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.webhook_events (provider, event_id, payload_hash)
  values (p_provider, p_event_id, p_payload_hash)
  on conflict (provider, event_id) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- Mensagem recebida de um contacto. Idempotente pelo id da mensagem no WhatsApp.
create or replace function public.ingest_inbound_message(
  p_phone_number_id text,
  p_from_e164 text,
  p_provider_message_id text,
  p_body text,
  p_sent_at timestamptz,
  p_profile_name text default null
)
returns table (conversation_id uuid, message_id uuid, duplicate boolean, agent_should_reply boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.whatsapp_accounts%rowtype;
  v_contact uuid;
  v_conv public.conversations%rowtype;
  v_msg uuid;
  v_at timestamptz := least(coalesce(p_sent_at, now()), now());
begin
  if p_provider_message_id is null or p_provider_message_id = '' then
    raise exception 'missing_message_id' using errcode = 'P0001';
  end if;

  -- Repetido? Não faz nada e indica-o.
  select m.id, m.conversation_id into v_msg, conversation_id
    from public.messages m where m.provider_message_id = p_provider_message_id;
  if v_msg is not null then
    return query select conversation_id, v_msg, true, false;
    return;
  end if;

  select * into v_acc from public.whatsapp_accounts where phone_number_id = p_phone_number_id;
  if v_acc.id is null then
    raise exception 'unknown_phone_number' using errcode = 'P0002';
  end if;

  insert into public.contacts (organization_id, phone_e164, full_name, source)
  values (v_acc.organization_id, p_from_e164, nullif(left(btrim(coalesce(p_profile_name, '')), 160), ''), 'whatsapp')
  on conflict (organization_id, phone_e164) do update set updated_at = now()
  returning id into v_contact;

  select * into v_conv from public.conversations c
   where c.contact_id = v_contact and c.status <> 'closed'
   for update;

  if v_conv.id is null then
    insert into public.conversations (organization_id, contact_id, whatsapp_account_id, mode)
    values (v_acc.organization_id, v_contact, v_acc.id, 'ai')
    returning * into v_conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, author, body,
                               provider_message_id, status, created_at)
  values (v_acc.organization_id, v_conv.id, 'inbound', 'contact', left(p_body, 4096),
          p_provider_message_id, 'received', v_at)
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_msg;

  if v_msg is null then -- corrida entre dois webhooks: o outro ganhou
    return query select v_conv.id, null::uuid, true, false;
    return;
  end if;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, v_at), v_at),
         last_inbound_at = greatest(coalesce(last_inbound_at, v_at), v_at),
         unread_count = unread_count + 1,
         status = case when status = 'waiting' then 'open'::public.conversation_status else status end
   where id = v_conv.id;

  return query select v_conv.id, v_msg, false,
    (v_conv.mode = 'ai' and v_acc.agent_enabled and v_acc.status = 'connected');
end;
$$;

-- Resposta do agente. Recusa se um profissional tiver assumido a conversa.
create or replace function public.record_ai_reply(
  p_conversation uuid,
  p_body text,
  p_model text,
  p_decision text,
  p_category public.conversation_category default null,
  p_sources jsonb default '[]'::jsonb,
  p_summary text default null,
  p_handoff_reason text default null,
  p_input_tokens int default null,
  p_output_tokens int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_acc public.whatsapp_accounts%rowtype;
  v_msg uuid;
begin
  if v_conv.mode = 'human' then
    raise exception 'conversation_taken_over' using errcode = 'P0001';
  end if;
  if v_conv.status = 'closed' then
    raise exception 'conversation_closed' using errcode = 'P0001';
  end if;
  select * into v_acc from public.whatsapp_accounts where id = v_conv.whatsapp_account_id;
  if v_acc.id is null or not v_acc.agent_enabled then
    raise exception 'agent_disabled' using errcode = 'P0001';
  end if;

  insert into public.agent_runs (organization_id, conversation_id, model, decision, category, sources,
                                 input_tokens, output_tokens)
  values (v_conv.organization_id, v_conv.id, p_model, p_decision, p_category,
          coalesce(p_sources, '[]'::jsonb), p_input_tokens, p_output_tokens);

  if p_body is not null and p_body <> '' then
    insert into public.messages (organization_id, conversation_id, direction, author, body, status)
    values (v_conv.organization_id, v_conv.id, 'outbound', 'ai', left(p_body, 4096), 'queued')
    returning id into v_msg;
  end if;

  update public.conversations
     set ai_summary = coalesce(p_summary, ai_summary),
         category = coalesce(p_category, category),
         is_urgent = is_urgent or coalesce(p_category = 'urgent', false),
         last_message_at = case when v_msg is not null then now() else last_message_at end,
         -- Encaminhamento: a IA passa a conversa para humanos e deixa de responder.
         mode = case when p_decision = 'handoff' then 'human'::public.conversation_mode else mode end,
         handoff_reason = case when p_decision = 'handoff' then p_handoff_reason else handoff_reason end
   where id = v_conv.id;

  return v_msg;
end;
$$;

-- Atualização do estado de entrega (webhook de estados). Nunca retrocede.
create or replace function public.update_message_status(
  p_provider_message_id text, p_status public.message_status, p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank int := array_position(array['queued','sent','delivered','read']::text[], p_status::text);
  n int;
begin
  update public.messages m
     set status = p_status,
         error_code = coalesce(p_error_code, m.error_code)
   where m.provider_message_id = p_provider_message_id
     and m.direction = 'outbound'
     and (p_status = 'failed'
          or coalesce(array_position(array['queued','sent','delivered','read']::text[], m.status::text), 0) < coalesce(v_rank, 0));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Associa o id do fornecedor a uma mensagem enviada por nós (após a chamada à API).
create or replace function public.mark_message_sent(p_message uuid, p_provider_message_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
     set provider_message_id = p_provider_message_id, status = 'sent'
   where id = p_message and direction = 'outbound' and status = 'queued';
$$;

create or replace function public.mark_message_failed(p_message uuid, p_error_code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages set status = 'failed', error_code = left(p_error_code, 120)
   where id = p_message and direction = 'outbound' and status in ('queued', 'sent');
$$;

revoke execute on function
  public.register_webhook_event(text, text, text),
  public.ingest_inbound_message(text, text, text, text, timestamptz, text),
  public.record_ai_reply(uuid, text, text, text, public.conversation_category, jsonb, text, text, int, int),
  public.update_message_status(text, public.message_status, text),
  public.mark_message_sent(uuid, text),
  public.mark_message_failed(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.register_webhook_event(text, text, text),
  public.ingest_inbound_message(text, text, text, text, timestamptz, text),
  public.record_ai_reply(uuid, text, text, text, public.conversation_category, jsonb, text, text, int, int),
  public.update_message_status(text, public.message_status, text),
  public.mark_message_sent(uuid, text),
  public.mark_message_failed(uuid, text)
to service_role;

-- =============================================================================
-- Ações da equipa (utilizadores autenticados, com permissão verificada)
-- =============================================================================

-- Assumir a conversa: a IA para imediatamente.
create or replace function public.take_over_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_uid uuid := private.require_permission(v_conv.organization_id, 'conversations.reply');
begin
  update public.conversations
     set mode = 'human', assigned_to = coalesce(assigned_to, v_uid), unread_count = 0,
         status = case when status = 'closed' then status else 'open'::public.conversation_status end
   where id = v_conv.id;
  if v_conv.mode <> 'human' then
    perform private.system_message(v_conv, 'Conversa assumida por um profissional. O assistente automático foi pausado.');
  end if;
  perform private.write_audit(v_conv.organization_id, v_uid, 'conversation.taken_over', 'conversation', v_conv.id::text);
end;
$$;

-- Devolver ao assistente: exige autorização (conversations.assign).
create or replace function public.return_conversation_to_ai(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_uid uuid := private.require_permission(v_conv.organization_id, 'conversations.assign');
begin
  if v_conv.mode = 'ai' then return; end if;
  update public.conversations set mode = 'ai', handoff_reason = null where id = v_conv.id;
  perform private.system_message(v_conv, 'Assistente automático reativado.');
  perform private.write_audit(v_conv.organization_id, v_uid, 'conversation.returned_to_ai', 'conversation', v_conv.id::text);
end;
$$;

create or replace function public.assign_conversation(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_uid uuid := private.require_permission(v_conv.organization_id, 'conversations.assign');
begin
  if p_user is not null and not exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = v_conv.organization_id and m.user_id = p_user
      and m.status = 'active' and rp.permission = 'conversations.reply'
  ) then
    raise exception 'invalid_assignee' using errcode = 'P0001';
  end if;
  update public.conversations set assigned_to = p_user where id = v_conv.id;
  perform private.write_audit(v_conv.organization_id, v_uid, 'conversation.assigned', 'conversation',
    v_conv.id::text, jsonb_build_object('assigned_to', p_user));
end;
$$;

create or replace function public.set_conversation_status(p_conversation uuid, p_status public.conversation_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_uid uuid := private.require_permission(v_conv.organization_id, 'conversations.reply');
begin
  update public.conversations set status = p_status where id = v_conv.id;
  perform private.write_audit(v_conv.organization_id, v_uid, 'conversation.status_changed', 'conversation',
    v_conv.id::text, jsonb_build_object('status', p_status));
exception
  when unique_violation then
    raise exception 'contact_has_open_conversation' using errcode = 'P0001';
end;
$$;

-- Mensagem de um membro: só com a conversa assumida e dentro da janela de 24h.
-- Fica "queued"; o servidor envia pela API e marca como enviada/falhada.
create or replace function public.send_member_message(p_conversation uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_uid uuid := private.require_permission(v_conv.organization_id, 'conversations.reply');
  v_msg uuid;
begin
  if btrim(coalesce(p_body, '')) = '' or char_length(p_body) > 4096 then
    raise exception 'invalid_message' using errcode = 'P0001';
  end if;
  if v_conv.mode <> 'human' then
    raise exception 'take_over_first' using errcode = 'P0001';
  end if;
  if v_conv.status = 'closed' then
    raise exception 'conversation_closed' using errcode = 'P0001';
  end if;
  if v_conv.last_inbound_at is null or v_conv.last_inbound_at < now() - interval '24 hours' then
    raise exception 'outside_service_window' using errcode = 'P0001';
  end if;

  insert into public.messages (organization_id, conversation_id, direction, author, author_user_id, body, status)
  values (v_conv.organization_id, v_conv.id, 'outbound', 'member', v_uid, p_body, 'queued')
  returning id into v_msg;

  update public.conversations set last_message_at = now(), unread_count = 0 where id = v_conv.id;
  return v_msg;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
begin
  perform private.require_permission(v_conv.organization_id, 'conversations.read');
  update public.conversations set unread_count = 0 where id = v_conv.id;
end;
$$;

-- Ativar/pausar o assistente para todo o escritório.
create or replace function public.set_agent_enabled(p_org uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'whatsapp.manage');
  n int;
begin
  update public.whatsapp_accounts set agent_enabled = p_enabled where organization_id = p_org;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'whatsapp_not_configured' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_org, v_uid, 'whatsapp.agent_toggled', 'organization', p_org::text,
    jsonb_build_object('enabled', p_enabled));
end;
$$;

-- Criar o ambiente de simulação (sem credenciais da Meta). Sempre identificado.
create or replace function public.enable_whatsapp_simulation(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'whatsapp.manage');
  v_id uuid;
begin
  insert into public.whatsapp_accounts (organization_id, mode, phone_number_id, display_phone, status)
  values (p_org, 'simulation', 'sim_' || replace(p_org::text, '-', ''), 'Simulação', 'connected')
  on conflict (organization_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'whatsapp_already_configured' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_org, v_uid, 'whatsapp.simulation_enabled', 'whatsapp_account', v_id::text);
  return v_id;
end;
$$;

-- Eliminar um contacto e todo o histórico (pedido de eliminação RGPD).
create or replace function public.erase_contact(p_contact uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid;
begin
  select organization_id into v_org from public.contacts where id = p_contact;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v_org, 'contacts.delete');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  delete from public.contacts where id = p_contact; -- conversas, mensagens e notas em cascata
  -- A auditoria regista a eliminação sem guardar dados do contacto.
  perform private.write_audit(v_org, v_uid, 'contact.erased', 'contact', p_contact::text,
    jsonb_build_object('reason', left(p_reason, 200)));
end;
$$;

revoke execute on function
  public.take_over_conversation(uuid),
  public.return_conversation_to_ai(uuid),
  public.assign_conversation(uuid, uuid),
  public.set_conversation_status(uuid, public.conversation_status),
  public.send_member_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.set_agent_enabled(uuid, boolean),
  public.enable_whatsapp_simulation(uuid),
  public.erase_contact(uuid, text)
from public, anon;
grant execute on function
  public.take_over_conversation(uuid),
  public.return_conversation_to_ai(uuid),
  public.assign_conversation(uuid, uuid),
  public.set_conversation_status(uuid, public.conversation_status),
  public.send_member_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.set_agent_enabled(uuid, boolean),
  public.enable_whatsapp_simulation(uuid),
  public.erase_contact(uuid, text)
to authenticated;
