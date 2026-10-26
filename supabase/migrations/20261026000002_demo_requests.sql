-- =============================================================================
-- Pedidos de demonstração (formulário público da landing page).
-- Escrita apenas através da RPC, com validação e limite anti-abuso.
-- Leitura reservada aos administradores da plataforma.
-- =============================================================================

create table public.demo_requests (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (char_length(full_name) between 2 and 120),
  email        extensions.citext not null check (char_length(email::text) between 3 and 254),
  firm_name    text check (firm_name is null or char_length(firm_name) <= 160),
  phone        text check (phone is null or char_length(phone) <= 32),
  message      text check (message is null or char_length(message) <= 2000),
  consent_at   timestamptz not null,
  status       text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at   timestamptz not null default now()
);

create index demo_requests_email_created_idx on public.demo_requests (email, created_at desc);

alter table public.demo_requests enable row level security;
revoke all on public.demo_requests from anon, authenticated;
grant select on public.demo_requests to authenticated;

create policy demo_requests_platform_admin on public.demo_requests for select to authenticated
  using (private.is_platform_admin());

create or replace function public.submit_demo_request(
  p_full_name text, p_email text, p_firm_name text, p_phone text, p_message text, p_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not coalesce(p_consent, false) then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  -- Limite: 3 pedidos por email em 24 horas, 200 por hora no total.
  if (select count(*) from public.demo_requests
       where email = v_email::extensions.citext and created_at > now() - interval '24 hours') >= 3
     or (select count(*) from public.demo_requests where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.demo_requests (full_name, email, firm_name, phone, message, consent_at)
  values (
    btrim(p_full_name), v_email,
    nullif(btrim(coalesce(p_firm_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_message, '')), ''),
    now()
  );
end;
$$;

revoke execute on function public.submit_demo_request(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_demo_request(text, text, text, text, text, boolean) to anon, authenticated;
