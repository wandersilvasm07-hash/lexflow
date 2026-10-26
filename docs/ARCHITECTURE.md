# Arquitetura

## Decisões de stack

| Camada | Escolha | Porquê |
|---|---|---|
| Aplicação | Next.js 16 (App Router), React 19, TypeScript | Uma só base de código para landing, app e API; Server Actions evitam expor lógica no browser. |
| Interface | Tailwind CSS 4, componentes próprios, ícones Lucide | Componentes pequenos e acessíveis, sem dependência de uma biblioteca de UI pesada. |
| Base de dados | PostgreSQL (Supabase) | Row Level Security nativo para isolar escritórios; `pgvector` para a pesquisa semântica da Fase 3. |
| Autenticação | Supabase Auth | Email + palavra-passe, confirmação de email, recuperação, MFA TOTP, sessões em cookies httpOnly. |
| Ficheiros (Fase 3) | Supabase Storage (buckets privados) | Políticas de acesso iguais às tabelas (por escritório). |
| IA (Fases 2–3) | API de modelo de linguagem com ferramentas (ex.: Claude) | Uso de ferramentas para pesquisa na base jurídica, agenda e encaminhamento. |
| Pagamentos (Fase 6) | Stripe Billing | Subscrições sem guardar cartões. |
| Testes | Vitest (unidade + base de dados real), Playwright (E2E, desktop e telemóvel) | Os testes de isolamento correm contra o SQL de produção. |
| Fontes | Schibsted Grotesk, auto-alojada (`@fontsource`) | Sem pedidos ao Google Fonts a partir do browser dos clientes (RGPD). |

Supabase foi escolhido sobre "Postgres próprio + Auth.js" porque junta base de dados, autenticação com MFA, storage com políticas e região UE num só serviço gerido — menos infraestrutura para manter numa fase inicial. O código da aplicação usa apenas a chave **pública**: toda a proteção de dados está no RLS e nas funções RPC, por isso uma mudança futura de alojamento não altera o modelo de segurança.

## Modelo de segurança (multi-escritório)

Três camadas, cada uma suficiente por si:

1. **Base de dados (barreira real).** RLS em todas as tabelas. Operações com regras de negócio (criar escritório, convidar, mudar papel, remover membro) são funções `security definer` que verificam permissão, escrevem atomicamente e auditam. Funções auxiliares (`private.has_permission`, etc.) vivem num esquema não exposto pela API.
2. **Servidor da aplicação.** `src/lib/auth/dal.ts` resolve o escritório pelo endereço e confirma a membership; `orgAction()` verifica a permissão antes de qualquer escrita. Um escritório a que o utilizador não pertence devolve 404 (não revela que existe).
3. **Interface.** Esconde o que o utilizador não pode fazer. Conveniência, não segurança.

A matriz papel → permissões existe em `src/lib/authz/permissions.ts` e na tabela `role_permissions`; um teste falha se divergirem.

Separação atendimento/publicidade: o papel *Gestor de marketing* não tem `conversations.read` nem `contacts.read`. Os relatórios de marketing trabalham com agregados.

Administradores da plataforma veem metadados de escritórios (para suporte), **não** dados de clientes.

## Estrutura de pastas

```
src/
  app/
    (marketing)/          landing, privacidade, termos, pedido de demonstração
    (auth)/               entrar, registar, recuperar/redefinir palavra-passe, MFA
    auth/confirm/         destino dos links de email (verifyOtp / PKCE)
    convite/[token]/      aceitar convite
    app/
      (simple)/           escolha/criação de escritório, conta, segurança da conta
      [org]/              área do escritório (shell com menu lateral)
        equipa/           membros, convites, papéis
        configuracoes/    perfil, segurança, registo de atividade
        whatsapp/ …       módulos das fases seguintes (página explicativa)
  components/
    ui/                   botões, campos, painéis, tabelas, alertas
    shell/                menu lateral, cabeçalho, navegação, placeholders
  config/app.ts           nome do produto (provisório)
  i18n/                   dicionários (pt-PT base; pronto para pt-BR, en, fr)
  lib/
    auth/                 camada de acesso a dados e wrapper de Server Actions
    authz/                papéis e permissões
    supabase/             clientes (servidor, browser)
    data/                 consultas reutilizáveis
    validation.ts         esquemas zod, NIF, slugs, redirecionamentos seguros
  proxy.ts                renovação de sessão + redirecionamento otimista
supabase/migrations/      SQL versionado (fonte de verdade do esquema)
tests/
  db/                     RLS/RPC contra Postgres real (shim do Supabase)
  e2e/                    Playwright
docs/                     este documento, esquema, credenciais, plano
```

### Organização por domínio (fases seguintes)

Cada módulo novo segue o mesmo padrão: `src/app/app/[org]/<módulo>/` (páginas e Server Actions finas) + `src/lib/<domínio>/` (regras, integrações) + migração própria + testes de RLS. Integrações externas ficam atrás de uma interface (`WhatsAppProvider`, `AdsProvider`) com uma implementação real e uma de **simulação identificada como tal**, escolhida por configuração — nunca em produção.

## Cache e renderização

`cacheComponents` está ativo. Dados de escritório **nunca** usam `use cache`: são sempre lidos no pedido, com a sessão do utilizador, para impedir qualquer fuga entre escritórios por cache partilhada. Só conteúdo público (landing, páginas legais) é pré-renderizado.

## Ambientes

| | Desenvolvimento | Testes | Produção |
|---|---|---|---|
| Supabase | projeto `lexflow-dev` (ou CLI local) | Postgres local + shim (`tests/db`) | projeto `lexflow-prod`, região UE |
| Variáveis | `.env.local` | `TEST_DATABASE_URL` | variáveis do alojamento |
| Integrações | simulação identificada | simulação | credenciais reais |
