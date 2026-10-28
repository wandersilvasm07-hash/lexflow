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

## Fase 4 — Gestão ✅ (código, testes e migração) · falta configurar serviços e horários reais

- [x] Agenda: serviços, horário semanal por profissional (vários períodos por dia), ausências, fuso do escritório
- [x] Marcações sem sobreposição garantidas na base de dados (restrição de exclusão; testado com pedidos em simultâneo)
- [x] Horários livres calculados a partir da disponibilidade real; antecedência mínima por serviço
- [x] Assistente propõe só horários livres e marca só com confirmação explícita; só anuncia o que ficou gravado (testado)
- [x] Estados: marcada, confirmada, cancelada (liberta o horário), realizada, falta; marcar fora do horário sem sobreposição
- [x] CRM: ficha do contacto, responsável, próxima ação, etiquetas, notas internas restritas, histórico de conversas e consultas, consentimentos, criação manual
- [x] Exportação CSV com permissão própria, campos mínimos, proteção contra fórmulas e registo de atividade
- [x] Eliminação de contacto (RGPD) com motivo, a partir da ficha
- [x] Relatórios agregados por período (atendimento, contactos, consultas); dashboard com números reais
- [ ] Integração com Google Calendar / Outlook (prevista; fora desta fase)
- [ ] Lembretes de consulta por WhatsApp (exigem modelos aprovados pela Meta)

## Fase 5 — Publicidade 🟡 (código, testes e migração; falta ligar uma conta Meta real)

- [x] Assistente de campanha em 13 passos (ver [ADS.md](ADS.md)); plano, textos, variantes e briefing de imagens pela IA, com estimativas identificadas
- [x] A IA nunca altera o orçamento; limites do escritório verificados na base de dados ao criar, alterar, aprovar e publicar (testado)
- [x] Revisão de conformidade determinística (publicidade enganosa, segredo profissional, angariação, temas políticos/sociais na Meta UE); bloqueios impedem a aprovação
- [x] Pré-visualização; aprovação explícita registada com impressão digital do conteúdo e do orçamento; qualquer alteração anula a aprovação (testado)
- [x] Publicação idempotente e retomável; tudo criado em pausa e ativado no fim; teto de gasto também na Meta; sem duplicação (testado)
- [x] Pausar, retomar, terminar com confirmação do estado real; sincronização diária; alerta de consumo e pausa ao atingir o total
- [x] Imagens privadas (armazenamento com acesso temporário); token da Meta cifrado (AES-256-GCM)
- [x] Relatórios: números da Meta separados dos calculados; atribuição por anúncio clique-para-WhatsApp, com limitações declaradas
- [ ] Criar a app na Meta for Developers, configurar variáveis e testar com uma conta de anúncios real
- [ ] Revisão da app pela Meta (necessária para outros escritórios ligarem as suas contas)
- [ ] Formulários instantâneos da Meta; Google Ads (arquitetura preparada)

## Fase 6 — Comercialização
Planos e limites configuráveis, Stripe, contadores de consumo, onboarding guiado, monitorização de erros, CSP com nonces, backups/PITR, políticas de retenção, exportação/eliminação RGPD, avaliação de transferências internacionais, revisão jurídica de termos e privacidade.
