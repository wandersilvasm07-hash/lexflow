-- =============================================================================
-- Fase 2 — Modo de simulação do WhatsApp.
-- Permite experimentar a caixa de entrada sem credenciais da Meta. Só funciona
-- quando a conta do escritório está em modo 'simulation' (nunca em 'live'), e
-- todas as mensagens ficam associadas a essa conta, identificada na interface.
-- =============================================================================

-- Simular uma mensagem recebida de um contacto.
create or replace function public.simulate_inbound_message(
  p_org uuid, p_from_e164 text, p_body text, p_profile_name text default null
)
returns table (conversation_id uuid, message_id uuid, agent_should_reply boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_permission(p_org, 'whatsapp.manage');
  v_acc public.whatsapp_accounts%rowtype;
  r record;
begin
  select * into v_acc from public.whatsapp_accounts where organization_id = p_org;
  if v_acc.id is null then
    raise exception 'whatsapp_not_configured' using errcode = 'P0001';
  end if;
  if v_acc.mode <> 'simulation' then
    raise exception 'simulation_only' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'invalid_message' using errcode = 'P0001';
  end if;

  select * into r from public.ingest_inbound_message(
    v_acc.phone_number_id, p_from_e164, 'sim.' || gen_random_uuid()::text, p_body, now(), p_profile_name
  );
  return query select r.conversation_id, r.message_id, r.agent_should_reply;
end;
$$;

-- Em simulação não há envio real: marca a mensagem como "enviada (simulação)".
create or replace function public.mark_simulated_sent(p_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages%rowtype;
  v_mode text;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_msg.organization_id, 'conversations.reply');
  select a.mode into v_mode
    from public.conversations c join public.whatsapp_accounts a on a.id = c.whatsapp_account_id
   where c.id = v_msg.conversation_id;
  if v_mode is distinct from 'simulation' then
    raise exception 'simulation_only' using errcode = 'P0001';
  end if;
  update public.messages
     set status = 'sent', provider_message_id = coalesce(provider_message_id, 'sim.' || gen_random_uuid()::text)
   where id = p_message and direction = 'outbound' and status = 'queued';
end;
$$;

revoke execute on function public.simulate_inbound_message(uuid, text, text, text) from public, anon;
revoke execute on function public.mark_simulated_sent(uuid) from public, anon;
grant execute on function public.simulate_inbound_message(uuid, text, text, text) to authenticated;
grant execute on function public.mark_simulated_sent(uuid) to authenticated;
