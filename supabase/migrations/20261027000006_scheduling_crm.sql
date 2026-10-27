-- =============================================================================
-- Fase 4 — Agenda, consultas, CRM e relatórios.
--
-- Garantias na base de dados:
--  * Dois compromissos ativos do mesmo profissional nunca se sobrepõem
--    (restrição de exclusão, imune a pedidos em simultâneo).
--  * Os horários livres são calculados a partir da disponibilidade real
--    (horário semanal − bloqueios − marcações), no fuso do escritório.
--  * O assistente só marca em horários livres e a marcação só existe depois de
--    gravada com sucesso; não consegue marcar numa conversa assumida por humano.
--  * Relatórios devolvem apenas agregados (sem dados de contactos individuais).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Serviços (consultas que o escritório oferece)
-- -----------------------------------------------------------------------------
create table public.services (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 2 and 120),
  description         text check (description is null or char_length(description) <= 500),
  duration_minutes    int not null default 60 check (duration_minutes between 15 and 240 and duration_minutes % 15 = 0),
  mode                text not null default 'presencial_ou_online'
                      check (mode in ('presencial', 'online', 'presencial_ou_online')),
  min_notice_minutes  int not null default 120 check (min_notice_minutes between 0 and 20160),
  bookable_by_ai      boolean not null default true,
  active              boolean not null default true,
  position            int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Horário semanal de cada profissional (hora local do escritório)
-- -----------------------------------------------------------------------------
create table public.availability_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  weekday          int not null check (weekday between 1 and 7), -- 1 = segunda … 7 = domingo
  start_time       time not null,
  end_time         time not null,
  created_at       timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_lookup on public.availability_rules (organization_id, user_id, weekday);

-- Ausências pontuais (férias, tribunal, formação…)
create table public.availability_blocks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  reason           text check (reason is null or char_length(reason) <= 200),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_blocks_lookup on public.availability_blocks (organization_id, user_id, starts_at);

-- -----------------------------------------------------------------------------
-- Marcações
-- -----------------------------------------------------------------------------
create type public.appointment_status as enum ('booked', 'confirmed', 'cancelled', 'completed', 'no_show');

create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  service_id       uuid references public.services (id) on delete set null,
  professional_id  uuid not null references auth.users (id) on delete restrict,
  conversation_id  uuid references public.conversations (id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.appointment_status not null default 'booked',
  mode             text check (mode is null or mode in ('presencial', 'online')),
  notes            text check (notes is null or char_length(notes) <= 1000),
  source           text not null default 'member' check (source in ('member', 'ai')),
  created_by       uuid references auth.users (id) on delete set null,
  cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Nenhum profissional tem duas marcações ativas ao mesmo tempo.
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('booked', 'confirmed'))
);
create index appointments_org_time on public.appointments (organization_id, starts_at);
create index appointments_contact on public.appointments (contact_id, starts_at desc);
create trigger appointments_touch before update on public.appointments
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Notas internas do contacto (acesso restrito à equipa de atendimento)
-- -----------------------------------------------------------------------------
create table public.contact_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  author_user_id   uuid not null references auth.users (id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at       timestamptz not null default now()
);
create index contact_notes_contact on public.contact_notes (contact_id, created_at desc);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.services            enable row level security;
alter table public.availability_rules  enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.appointments        enable row level security;
alter table public.contact_notes       enable row level security;

revoke all on public.services, public.availability_rules, public.availability_blocks,
  public.appointments, public.contact_notes from anon;

-- Serviços: todos os membros veem; gerir é das definições do escritório.
create policy services_select on public.services for select to authenticated
  using (private.is_member(organization_id));
create policy services_write on public.services for all to authenticated
  using (private.has_permission(organization_id, 'settings.manage'))
  with check (private.has_permission(organization_id, 'settings.manage'));

-- Horários e bloqueios: quem vê a agenda vê-os; cada profissional gere os
-- seus; quem gere definições gere os de todos.
create policy availability_rules_select on public.availability_rules for select to authenticated
  using (private.has_permission(organization_id, 'calendar.read'));
create policy availability_rules_write on public.availability_rules for all to authenticated
  using (private.has_permission(organization_id, 'settings.manage')
         or (user_id = (select auth.uid()) and private.has_permission(organization_id, 'calendar.write')))
  with check (private.has_permission(organization_id, 'settings.manage')
         or (user_id = (select auth.uid()) and private.has_permission(organization_id, 'calendar.write')));

create policy availability_blocks_select on public.availability_blocks for select to authenticated
  using (private.has_permission(organization_id, 'calendar.read'));
create policy availability_blocks_write on public.availability_blocks for all to authenticated
  using (private.has_permission(organization_id, 'settings.manage')
         or (user_id = (select auth.uid()) and private.has_permission(organization_id, 'calendar.write')))
  with check (private.has_permission(organization_id, 'settings.manage')
         or (user_id = (select auth.uid()) and private.has_permission(organization_id, 'calendar.write')));

-- Marcações: leitura com calendar.read; escrita só por RPC (validações).
create policy appointments_select on public.appointments for select to authenticated
  using (private.has_permission(organization_id, 'calendar.read'));
revoke insert, update, delete on public.appointments from authenticated;

-- Notas de contacto: equipa de atendimento.
create policy contact_notes_select on public.contact_notes for select to authenticated
  using (private.has_permission(organization_id, 'contacts.read'));
create policy contact_notes_insert on public.contact_notes for insert to authenticated
  with check (
    author_user_id = (select auth.uid())
    and private.has_permission(organization_id, 'contacts.write')
    and exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = contact_notes.organization_id)
  );
revoke update, delete on public.contact_notes from authenticated;

-- Contactos: colunas protegidas (escritório, telefone de origem, datas) não se
-- alteram por update direto.
revoke update on public.contacts from authenticated;
grant update (full_name, email, locale, status, service_interest, assigned_to, next_action,
              next_action_at, tags, consents, source_campaign)
  on public.contacts to authenticated;

-- =============================================================================
-- Disponibilidade
-- =============================================================================

-- Profissional elegível: membro ativo que pode responder a clientes.
create or replace function private.is_professional(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
      and rp.permission = 'calendar.write'
      and m.role in ('org_admin', 'lawyer')
  );
$$;

-- Horários livres. Devolve no máximo p_limit inícios possíveis.
create or replace function private.free_slots(
  p_org uuid, p_service uuid, p_from timestamptz, p_to timestamptz,
  p_professional uuid default null, p_limit int default 200
)
returns table (professional_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with
  svc as (
    select s.duration_minutes, s.min_notice_minutes
    from public.services s
    where s.id = p_service and s.organization_id = p_org and s.active
  ),
  org as (select o.timezone as tz from public.organizations o where o.id = p_org),
  bounds as (
    select greatest(p_from, now() + make_interval(mins => svc.min_notice_minutes)) as lo,
           least(p_to, now() + interval '90 days') as hi,
           svc.duration_minutes as dur
    from svc
  ),
  days as (
    select d::date as day
    from bounds, org,
         generate_series((bounds.lo at time zone org.tz)::date, (bounds.hi at time zone org.tz)::date, interval '1 day') d
  ),
  candidates as (
    -- Hora local (sem fuso) convertida para instante real no fuso do escritório,
    -- o que trata corretamente as mudanças de hora de verão/inverno.
    select r.user_id as professional_id,
           (t.local_start at time zone org.tz) as starts_at,
           ((t.local_start + make_interval(mins => bounds.dur)) at time zone org.tz) as ends_at
    from days
    cross join org
    cross join bounds
    join public.availability_rules r
      on r.organization_id = p_org
     and r.weekday = extract(isodow from days.day)::int
     and (p_professional is null or r.user_id = p_professional)
    cross join lateral generate_series(
      days.day + r.start_time,
      days.day + r.end_time - make_interval(mins => bounds.dur),
      make_interval(mins => least(bounds.dur, 30))
    ) as t(local_start)
    where r.end_time - r.start_time >= make_interval(mins => bounds.dur)
  )
  select distinct c.professional_id, c.starts_at, c.ends_at
  from candidates c, bounds
  where c.starts_at >= bounds.lo
    and c.ends_at <= bounds.hi
    and private.is_professional(p_org, c.professional_id)
    and not exists (
      select 1 from public.availability_blocks b
      where b.organization_id = p_org and b.user_id = c.professional_id
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)'))
    and not exists (
      select 1 from public.appointments a
      where a.professional_id = c.professional_id and a.status in ('booked', 'confirmed')
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)'))
  order by c.starts_at, c.professional_id
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

create or replace function public.available_slots(
  p_org uuid, p_service uuid, p_from timestamptz, p_to timestamptz, p_professional uuid default null
)
returns table (professional_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_org, 'calendar.read');
  return query select * from private.free_slots(p_org, p_service, p_from, p_to, p_professional, 300);
end;
$$;

-- =============================================================================
-- Marcações (equipa)
-- =============================================================================
create or replace function private.insert_appointment(
  p_org uuid, p_contact uuid, p_service uuid, p_professional uuid, p_starts_at timestamptz,
  p_mode text, p_notes text, p_source text, p_actor uuid, p_conversation uuid, p_require_free boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dur int;
  v_ends timestamptz;
  v_id uuid;
begin
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select duration_minutes into v_dur from public.services
   where id = p_service and organization_id = p_org and active;
  if v_dur is null then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;
  if not private.is_professional(p_org, p_professional) then
    raise exception 'invalid_professional' using errcode = 'P0001';
  end if;
  if p_starts_at < now() then
    raise exception 'slot_in_past' using errcode = 'P0001';
  end if;
  v_ends := p_starts_at + make_interval(mins => v_dur);

  if p_require_free and not exists (
    select 1 from private.free_slots(p_org, p_service, p_starts_at, v_ends, p_professional, 5) f
    where f.starts_at = p_starts_at and f.professional_id = p_professional
  ) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  begin
    insert into public.appointments (organization_id, contact_id, service_id, professional_id, conversation_id,
                                     starts_at, ends_at, mode, notes, source, created_by)
    values (p_org, p_contact, p_service, p_professional, p_conversation, p_starts_at, v_ends,
            nullif(p_mode, ''), nullif(left(btrim(coalesce(p_notes, '')), 1000), ''), p_source, p_actor)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;

  update public.contacts set status = 'consultation_booked'
   where id = p_contact and status in ('new', 'in_progress', 'awaiting_info', 'consultation_proposed');

  perform private.write_audit(p_org, p_actor, 'appointment.booked', 'appointment', v_id::text,
    jsonb_build_object('source', p_source, 'starts_at', p_starts_at, 'professional_id', p_professional));
  return v_id;
end;
$$;

-- A equipa pode marcar fora do horário configurado (p_outside_hours), mas
-- nunca em sobreposição com outra marcação do mesmo profissional.
create or replace function public.book_appointment(
  p_org uuid, p_contact uuid, p_service uuid, p_professional uuid, p_starts_at timestamptz,
  p_mode text default null, p_notes text default null, p_outside_hours boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'calendar.write');
begin
  return private.insert_appointment(p_org, p_contact, p_service, p_professional, p_starts_at,
    p_mode, p_notes, 'member', v_uid, null, not coalesce(p_outside_hours, false));
end;
$$;

create or replace function public.set_appointment_status(
  p_appointment uuid, p_status public.appointment_status, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments%rowtype;
  v_uid uuid;
begin
  select * into v from public.appointments where id = p_appointment for update;
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_uid := private.require_permission(v.organization_id, 'calendar.write');

  if v.status = p_status then return; end if;
  if v.status in ('cancelled', 'completed', 'no_show') then
    raise exception 'appointment_closed' using errcode = 'P0001';
  end if;
  if p_status = 'booked' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if p_status in ('completed', 'no_show') and v.starts_at > now() then
    raise exception 'appointment_not_started' using errcode = 'P0001';
  end if;

  update public.appointments
     set status = p_status,
         cancelled_reason = case when p_status = 'cancelled' then nullif(left(btrim(coalesce(p_reason, '')), 300), '') end
   where id = v.id;

  if p_status = 'completed' then
    update public.contacts set status = 'converted'
     where id = v.contact_id and status = 'consultation_booked';
  end if;

  perform private.write_audit(v.organization_id, v_uid, 'appointment.status_changed', 'appointment', v.id::text,
    jsonb_build_object('from', v.status, 'to', p_status));
end;
$$;

-- =============================================================================
-- Assistente (chave de serviço)
-- =============================================================================

-- Próximos horários livres para propor ao contacto.
create or replace function public.agent_free_slots(p_org uuid, p_service uuid default null, p_limit int default 6)
returns table (service_id uuid, service_name text, professional_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with svc as (
    select s.id, s.name from public.services s
    where s.organization_id = p_org and s.active and s.bookable_by_ai
      and (p_service is null or s.id = p_service)
    order by s.position, s.created_at
    limit 1
  ),
  slots as (
    select f.*, row_number() over (partition by f.starts_at order by f.professional_id) as rn
    from svc, private.free_slots(p_org, svc.id, now(), now() + interval '21 days', null, 300) f
  )
  -- Um profissional por horário; o contacto escolhe a hora, não a pessoa.
  select svc.id, svc.name, s.professional_id, s.starts_at, s.ends_at
  from svc, slots s
  where s.rn = 1
  order by s.starts_at
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- Marcar a partir de uma conversa. Só em horário livre; recusa se um humano
-- tiver assumido a conversa ou se o serviço não puder ser marcado pela IA.
create or replace function public.agent_book_appointment(
  p_conversation uuid, p_service uuid, p_starts_at timestamptz, p_full_name text default null
)
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz, professional_name text, service_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype := private.lock_conversation(p_conversation);
  v_prof uuid;
  v_id uuid;
begin
  if v_conv.mode <> 'ai' or v_conv.status = 'closed' then
    raise exception 'conversation_taken_over' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.services where id = p_service and organization_id = v_conv.organization_id
                 and active and bookable_by_ai) then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  select f.professional_id into v_prof
    from private.free_slots(v_conv.organization_id, p_service, p_starts_at, p_starts_at + interval '4 hours', null, 50) f
   where f.starts_at = p_starts_at
   order by (select count(*) from public.appointments a
              where a.professional_id = f.professional_id and a.status in ('booked', 'confirmed')
                and a.starts_at::date = p_starts_at::date)
   limit 1;
  if v_prof is null then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_full_name, '')), '') is not null then
    update public.contacts set full_name = left(btrim(p_full_name), 160)
     where id = v_conv.contact_id and full_name is null;
  end if;

  v_id := private.insert_appointment(v_conv.organization_id, v_conv.contact_id, p_service, v_prof, p_starts_at,
    null, null, 'ai', null, v_conv.id, true);

  update public.conversations set category = 'consultation' where id = v_conv.id;

  return query
    select a.id, a.starts_at, a.ends_at, coalesce(p.full_name, 'a equipa do escritório'), s.name
    from public.appointments a
    left join public.profiles p on p.id = a.professional_id
    left join public.services s on s.id = a.service_id
    where a.id = v_id;
end;
$$;

-- =============================================================================
-- Relatórios (só agregados)
-- =============================================================================
create or replace function public.report_overview(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_permission(p_org, 'reports.read');
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'conversations_new', (select count(*) from public.conversations
                          where organization_id = p_org and created_at >= p_from and created_at < p_to),
    'conversations_ai_attended', (select count(distinct conversation_id) from public.agent_runs
                                  where organization_id = p_org and created_at >= p_from and created_at < p_to
                                    and decision in ('answered', 'asked', 'handoff')),
    'conversations_handed_off', (select count(distinct x.id) from (
                                   select conversation_id as id from public.agent_runs
                                    where organization_id = p_org and decision = 'handoff'
                                      and created_at >= p_from and created_at < p_to
                                   union
                                   select entity_id::uuid from public.audit_logs
                                    where organization_id = p_org and action = 'conversation.taken_over'
                                      and created_at >= p_from and created_at < p_to) x),
    'conversations_urgent', (select count(*) from public.conversations
                             where organization_id = p_org and is_urgent and created_at >= p_from and created_at < p_to),
    'conversations_pending_now', (select count(*) from public.conversations
                                  where organization_id = p_org and status <> 'closed' and unread_count > 0),
    'contacts_new', (select count(*) from public.contacts
                     where organization_id = p_org and created_at >= p_from and created_at < p_to),
    'contacts_by_source', coalesce((select jsonb_object_agg(source, n) from (
                                      select source::text, count(*) as n from public.contacts
                                       where organization_id = p_org and created_at >= p_from and created_at < p_to
                                       group by source) s), '{}'::jsonb),
    'contacts_by_status', coalesce((select jsonb_object_agg(status, n) from (
                                      select status::text, count(*) as n from public.contacts
                                       where organization_id = p_org and created_at >= p_from and created_at < p_to
                                       group by status) s), '{}'::jsonb),
    'appointments_booked', (select count(*) from public.appointments
                            where organization_id = p_org and created_at >= p_from and created_at < p_to),
    'appointments_booked_by_ai', (select count(*) from public.appointments
                                  where organization_id = p_org and source = 'ai'
                                    and created_at >= p_from and created_at < p_to),
    'appointments_held', (select count(*) from public.appointments
                          where organization_id = p_org and status = 'completed'
                            and starts_at >= p_from and starts_at < p_to),
    'appointments_no_show', (select count(*) from public.appointments
                             where organization_id = p_org and status = 'no_show'
                               and starts_at >= p_from and starts_at < p_to),
    'appointments_cancelled', (select count(*) from public.appointments
                               where organization_id = p_org and status = 'cancelled'
                                 and starts_at >= p_from and starts_at < p_to),
    'appointments_by_service', coalesce((select jsonb_object_agg(name, n) from (
                                           select coalesce(s.name, 'Sem serviço') as name, count(*) as n
                                           from public.appointments a
                                           left join public.services s on s.id = a.service_id
                                           where a.organization_id = p_org
                                             and a.created_at >= p_from and a.created_at < p_to
                                           group by 1) x), '{}'::jsonb),
    'generated_at', now()
  ) into v;
  return v;
end;
$$;

-- =============================================================================
-- Permissões de execução
-- =============================================================================
revoke all on function
  private.is_professional(uuid, uuid),
  private.free_slots(uuid, uuid, timestamptz, timestamptz, uuid, int),
  private.insert_appointment(uuid, uuid, uuid, uuid, timestamptz, text, text, text, uuid, uuid, boolean)
from public, anon, authenticated;

revoke execute on function
  public.available_slots(uuid, uuid, timestamptz, timestamptz, uuid),
  public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, text, boolean),
  public.set_appointment_status(uuid, public.appointment_status, text),
  public.report_overview(uuid, timestamptz, timestamptz),
  public.agent_free_slots(uuid, uuid, int),
  public.agent_book_appointment(uuid, uuid, timestamptz, text)
from public, anon;
grant execute on function
  public.available_slots(uuid, uuid, timestamptz, timestamptz, uuid),
  public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, text, boolean),
  public.set_appointment_status(uuid, public.appointment_status, text),
  public.report_overview(uuid, timestamptz, timestamptz)
to authenticated;
revoke execute on function
  public.agent_free_slots(uuid, uuid, int),
  public.agent_book_appointment(uuid, uuid, timestamptz, text)
from authenticated;
grant execute on function
  public.agent_free_slots(uuid, uuid, int),
  public.agent_book_appointment(uuid, uuid, timestamptz, text)
to service_role;
