# Segurança, RGPD e operação (Fase 6)

## O que está implementado

| Requisito (secção 17) | Como |
|---|---|
| Minimização de dados | Só se recolhe o necessário ao atendimento; o assistente não pede documentos de identificação por WhatsApp; exportações de contactos com campos mínimos. |
| Controlo de acesso por função | Matriz de permissões (`src/lib/authz/permissions.ts`) espelhada na base de dados e verificada no servidor (RLS + RPC). |
| Isolamento entre escritórios | RLS em todas as tabelas; testes de isolamento (`tests/db`). |
| Encriptação | Em trânsito: HTTPS/HSTS. Em repouso: discos encriptados do Supabase; tokens da Meta cifrados adicionalmente (AES-256-GCM, `ADS_TOKEN_KEY`). |
| Proteção de credenciais | Chaves só em variáveis de ambiente do servidor; nunca na base de dados em claro nem no browser. |
| Auditoria | `audit_logs` (só acrescenta): equipa, configurações, exportações, faturação, limites, campanhas, eliminações. |
| Políticas de retenção | Por escritório (6–120 meses, por omissão 24): conversas fechadas sem atividade são apagadas diariamente (`apply_retention`, cron `/api/cron/maintenance`). Registos técnicos de webhooks: 30 dias. |
| Exportação e eliminação | Contacto: eliminação a pedido do titular (ficha do contacto). Escritório: exportação completa em JSON e eliminação definitiva com confirmação do endereço (Configurações › Dados e privacidade); fica registo mínimo em `organization_deletions`. |
| Separação atendimento / publicidade | O papel "gestor de marketing" não acede a conversas nem contactos; os relatórios de marketing só têm números agregados. |
| Informação sobre IA | O assistente informa uma vez, na primeira resposta, que o atendimento tem apoio de IA (Regulamento IA, art. 50.º). |
| Sem treino com conversas | A API comercial da Anthropic não usa os dados dos clientes para treinar modelos (a alteração de 2025 aplica-se só aos planos de consumo). |
| Cabeçalhos de segurança | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (`next.config.ts`). A CSP permite os scripts inline do Next.js porque os nonces são incompatíveis com a pré-renderização parcial usada. |
| Monitorização | Erros do servidor registados em formato estruturado (`src/instrumentation.ts`, procurar "[erro]" nos registos da Vercel); verificação de saúde em `/api/health` para um serviço de monitorização externo. |
| Região | Funções da Vercel em Dublin (`dub1`), junto da base de dados (Supabase, Irlanda). |

## Subcontratantes

| Serviço | Tratamento | Localização |
|---|---|---|
| Supabase | Base de dados, autenticação, ficheiros | UE (Irlanda) |
| Vercel | Alojamento | Funções na UE; distribuição global de conteúdos estáticos |
| Anthropic | Modelo de IA | EUA — **transferência internacional**: confirmar e assinar o DPA da Anthropic antes de produção |
| Meta | WhatsApp Business, anúncios | UE/EUA |
| Stripe | Pagamentos | UE/EUA |

## Por fazer antes de produção (decisões e contratos)

1. **Backups**: o plano gratuito do Supabase não tem cópias automáticas. Passar ao plano Pro (cópias diárias) e ativar PITR (recuperação a um momento) antes de dados reais.
2. **Acordos de tratamento de dados (DPA)** com Supabase, Vercel, Anthropic, Meta e Stripe; avaliação das transferências internacionais (Anthropic, Meta).
3. **Revisão jurídica** dos Termos, Política de Privacidade e do contrato de subcontratação com os escritórios (o Patrono é subcontratante dos escritórios, que são responsáveis pelo tratamento dos dados dos seus clientes; o sigilo profissional do advogado agrava o dever de confidencialidade).
4. **Faturação certificada**: em Portugal, as faturas têm de ser emitidas por software certificado pela AT. Os recibos do Stripe não substituem a fatura: emitir faturas por software certificado (manualmente ou por integração, ex.: InvoiceXpress, Moloni, Vendus).
5. **Gestão de incidentes**: designar responsável; prazo de 72 h para notificar a CNPD em caso de violação de dados; registo de incidentes.
6. **Monitorização externa**: apontar um serviço (ex.: UptimeRobot, Better Stack) a `/api/health` e configurar alertas por email.
