# Plano de implementação

Regra: não se avança de fase sem testes e critérios de aceitação cumpridos.

## Fase 1 — Fundação ✅ (código) · ⏳ (validação com Supabase real)

- [x] Projeto Next.js + TypeScript + Tailwind, lint, CI
- [x] Migração de fundação: escritórios, membros, papéis, convites, perfis, auditoria, RLS
- [x] Testes de isolamento e permissões contra Postgres real (32 testes; 45 no total com os unitários, mais 18 E2E)
- [x] Autenticação: registo, confirmação de email, login, recuperação, MFA TOTP, política MFA por escritório
- [x] Criação de escritório, troca entre escritórios, endereços reservados
- [x] Equipa: convites com link, papéis, suspender/reativar, remover, sair; último administrador protegido
- [x] Configurações: perfil do escritório (com validação de NIF), segurança, registo de atividade
- [x] Interface: menu lateral com os 12 módulos (filtrado por permissão), cabeçalho com pesquisa, notificações e perfil; responsivo
- [x] Landing pública sem dados inventados, pedido de demonstração com limites anti-abuso
- [x] i18n preparado (pt-PT base), PWA (manifesto)
- [ ] **Falta:** correr o fluxo completo num projeto Supabase real (registo → escritório → convite → aceitar → MFA) e os E2E autenticados
- [ ] **Falta:** SMTP próprio para emails de autenticação; envio automático de convites por email

## Fase 2 — Atendimento 🟡 (código pronto e migrado; falta ligar Meta e chave de IA)

- [x] Base de dados: contactos, contas WhatsApp, conversas, mensagens, webhooks, notas, execuções do agente (RLS + RPC)
- [x] Idempotência: webhooks e mensagens repetidas não duplicam (testado)
- [x] Transferência humana: assumir pausa a IA na base de dados; reativar exige autorização (testado)
- [x] Janela de 24h da Meta aplicada às respostas da equipa (testado)
- [x] Webhook `/api/webhooks/whatsapp`: verificação de assinatura, estados de entrega, processamento assíncrono
- [x] Envio pela Cloud API com tratamento de falhas; modo de simulação identificado
- [x] Agente: prompt operacional, resposta estruturada, classificação, encaminhamento obrigatório determinístico
- [x] Interface: WhatsApp IA (estado, simulador, pausar assistente), caixa de entrada, contactos
- [ ] Credenciais reais: Meta (WhatsApp) e chave do modelo de IA + chave de serviço do Supabase na Vercel
- [ ] Modelos de mensagem (templates) para escrever fora da janela de 24h

Plano original:
1. Migração: contactos, conversas, mensagens, webhooks, notas, `agent_runs` + testes RLS
2. Interface `WhatsAppProvider` com implementação real (Cloud API) e simulação identificada
3. Webhook: verificação de assinatura, idempotência por `event_id`/`message_id`, fila de processamento
4. Caixa de entrada: lista, conversa, assumir/devolver, notas, estado de entrega
5. Agente: prompt operacional (secção 10), perguntas progressivas, resumo, classificação (geral/consulta/complexo/urgente/pedido RGPD), pausa automática ao assumir
6. Critérios: webhooks repetidos não duplicam; transferência suspende IA; falhas de API tratadas; IA não inventa fontes

## Fase 3 — Base jurídica 🟡 (código pronto; falta conteúdo aprovado e revisão do conjunto de teste)

- [x] Documentos com todos os metadados da secção 9 (fonte, referências, publicação, vigência, verificação, versão, estado, revisor, aprovação, próxima revisão, etiquetas, relações)
- [x] Base comum (gerida pela plataforma) separada dos documentos privados de cada escritório (RLS + testes)
- [x] Fluxo editorial na base de dados: rascunho → em revisão → aprovado → desatualizado/arquivado; aprovar exige fonte e datas
- [x] Versões: documento aprovado só muda por nova versão; ao aprovar a nova, a anterior fica desatualizada
- [x] Pesquisa em português (sem acentos) que só devolve aprovados, em vigor e com revisão em dia
- [x] Importação de PDF, DOCX, HTML, texto e de fontes oficiais por endereço (lista fechada de domínios)
- [x] Interface: lista com filtros, ficha, ações editoriais, versões, "Testar pesquisa"
- [x] Assistente pesquisa antes de responder, só cita o que recebeu (fontes inventadas bloqueiam a resposta), regista fontes e versões; caixa de entrada mostra as fontes consultadas
- [x] Conjunto de perguntas de teste (`tests/legal/perguntas-teste.ts`) — **rascunho por rever por advogado**
- [ ] Carregar e aprovar os primeiros documentos oficiais (trabalho de revisão jurídica)
- [ ] Pesquisa semântica (embeddings): coluna `vector` preparada; falta escolher fornecedor de embeddings
- [ ] Guardar o ficheiro original no armazenamento privado (hoje guarda-se o texto extraído e o hash)

## Fase 4 — Gestão
CRM completo, agenda com prevenção de sobreposição na base de dados, IA que só propõe horários livres, relatórios de atendimento, exportações auditadas.

## Fase 5 — Publicidade
Assistente de campanha (13 passos), revisão de conformidade, pré-visualização, aprovação explícita registada, publicação idempotente na Meta, confirmação do estado real, limites e alertas de orçamento, relatórios com atribuição e limitações declaradas.

## Fase 6 — Comercialização
Planos e limites configuráveis, Stripe, contadores de consumo, onboarding guiado, monitorização de erros, CSP com nonces, backups/PITR, políticas de retenção, exportação/eliminação RGPD, avaliação de transferências internacionais, revisão jurídica de termos e privacidade.
