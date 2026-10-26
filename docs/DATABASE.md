# Esquema da base de dados

O SQL em `supabase/migrations/` é a fonte de verdade. Este documento resume o que existe (Fase 1) e o desenho previsto para as fases seguintes, para que as migrações futuras encaixem sem refazer a fundação.

## Fase 1 — implementado

| Tabela | Conteúdo | Escrita |
|---|---|---|
| `profiles` | nome e idioma do utilizador (1:1 com `auth.users`) | o próprio (update); criação por trigger |
| `organizations` | escritório: nome, endereço (`slug`), denominação, NIF, contactos, fuso, `require_mfa` | RPC `create_organization`; update de colunas permitidas com `org.update` |
| `memberships` | utilizador ↔ escritório, papel, estado (ativo/suspenso) | apenas RPC |
| `role_permissions` | matriz papel → permissão | só migrações |
| `invitations` | convites com **hash** do token, papel, validade (7 dias) | apenas RPC |
| `audit_logs` | ações importantes; só acréscimo (triggers bloqueiam update/delete/truncate) | RPC internas e `log_audit_event` |
| `platform_admins` | equipa que opera o SaaS | só migrações/consola |
| `demo_requests` | pedidos de demonstração da landing | RPC `submit_demo_request` (anónimo, com limites) |

RPCs: `create_organization`, `create_invitation`, `revoke_invitation`, `get_invitation_preview`, `accept_invitation`, `change_member_role`, `set_member_status`, `remove_member`, `log_audit_event`, `my_permissions`, `list_members`, `submit_demo_request`.

Garantias testadas (`tests/db`): isolamento entre escritórios em leitura e escrita, colunas protegidas, último administrador, convites (email certo, uso único, expiração, revogação, token não guardado), membros suspensos perdem acesso, auditoria imutável, endereços reservados, matriz de permissões igual no código e na base de dados.

## Fases seguintes — desenho

Todas as tabelas de escritório têm `organization_id` + RLS `private.has_permission(organization_id, '<perm>')`.

### Fase 2 — Atendimento
- `whatsapp_accounts` (org, phone_number_id, waba_id, estado, `mode` real|simulação, referência ao segredo no cofre — nunca o token em claro)
- `contacts` (org, nome?, telefone, idioma, origem, estado comercial, serviço, responsável, próxima ação, consentimentos)
- `conversations` (org, contact, canal, estado: ia|humano|pendente|encerrada, `assigned_to`, `agent_paused_at`, resumo IA, motivo de encaminhamento, urgência)
- `messages` (conversation, direção, autor: cliente|ia|membro, conteúdo, `provider_message_id` **único** para idempotência, estado de entrega)
- `webhook_events` (provider, `event_id` único, payload mínimo, processed_at) — impede processamento duplicado
- `internal_notes` (conversation, autor, texto) — nunca enviadas ao cliente
- `agent_runs` (conversation, modelo, fontes/versões consultadas, decisão, tokens) — rasto para revisão

### Fase 3 — Base jurídica
- `knowledge_documents` (`organization_id` **nulo = base comum**, categoria, título, jurisdição, fonte oficial, referências, datas de publicação/vigência/fim/verificação/revisão, versão, estado editorial, revisor, aprovado_em)
- `knowledge_chunks` (document, posição, texto, `embedding vector(…)`, metadados) com índice HNSW
- `knowledge_relations` (documento ↔ conceito/etiqueta)
- Pesquisa por RPC que filtra **antes** da similaridade: estado `aprovado`, vigência na data atual, e `organization_id is null or organization_id = :org`. Testes garantem que documentos privados nunca aparecem a outro escritório.

### Fase 4 — Gestão
- `services` (catálogo de serviços do escritório), `availability_rules`, `availability_blocks`, `appointments` (com restrição de exclusão `tstzrange` para impedir sobreposição por profissional), `contact_tags`, `exports` (auditadas)

### Fase 5 — Publicidade
- `ad_accounts`, `campaigns` (estado pedido vs. estado confirmado na plataforma), `campaign_versions`, `campaign_approvals` (quem aprovou, quando, orçamento aprovado), `budget_limits`, `ad_metrics_daily` (origem: plataforma) separado de métricas calculadas
- Chave de idempotência por publicação para evitar campanhas duplicadas

### Fase 6 — Comercialização
- `plans` e `plan_limits` (configuráveis, sem valores no código), `subscriptions` (id do Stripe), `usage_counters` (IA, mensagens, campanhas por período), `invoices` (referências do Stripe)
- Políticas de retenção por tabela, rotinas de exportação/eliminação RGPD
