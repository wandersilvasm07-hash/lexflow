# Patrono

Plataforma SaaS para escritórios de advocacia em Portugal: atendimento por WhatsApp com IA especializada em imigração, gestão de contactos e consultas, base jurídica com fontes e campanhas publicitárias assistidas — com controlo humano em todos os pontos críticos.

> Nome do produto: **Patrono** (definido em `src/config/app.ts`). O repositório mantém o nome técnico `lexflow`.

**Estado:** Fase 1 (fundação) implementada e testada. Ver [docs/ROADMAP.md](docs/ROADMAP.md).

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, modelo de segurança, estrutura de pastas |
| [docs/DATABASE.md](docs/DATABASE.md) | Esquema atual e desenho das fases seguintes |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Serviços externos, credenciais, configuração de email |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Plano por fases e critérios de aceitação |

## Requisitos

- Node.js 22+
- Um projeto [Supabase](https://supabase.com) (região UE) — ou a [CLI do Supabase](https://supabase.com/docs/guides/local-development) com Docker
- PostgreSQL 15+ local para os testes de base de dados (opcional; o CI usa um contentor)

## Instalação

```bash
npm install
cp .env.example .env.local   # e preencher NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

## Migrações

As migrações estão em `supabase/migrations/` e aplicam-se por ordem.

**Com a CLI do Supabase:**
```bash
npx supabase link --project-ref <ref-do-projeto>
npx supabase db push
```

**Sem CLI:** abrir *SQL Editor* no painel do Supabase e executar cada ficheiro de `supabase/migrations/` por ordem.

Depois, configurar o Auth conforme [docs/CREDENTIALS.md](docs/CREDENTIALS.md#configuração-de-email-do-supabase-fase-1) (redirect URLs, modelos de email, TOTP).

Para dar acesso de administrador da plataforma a alguém (SQL Editor):
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'email@exemplo.pt';
```

## Executar

```bash
npm run dev        # http://localhost:3000
npm run build && npm run start
```

Sem as variáveis do Supabase, as páginas públicas funcionam e as áreas autenticadas mostram um aviso claro de configuração em falta.

## Testes

```bash
npm run test:unit   # validação, permissões, mensagens de erro
npm run db:test:up  # arranca Postgres local na porta 54322 (ou defina TEST_DATABASE_URL)
npm run test:db     # RLS e RPCs contra o SQL real das migrações
npm run test:e2e    # Playwright, desktop e telemóvel (faz build/start automaticamente via webServer)
npm run check       # lint + tipos + testes + build
```

Os testes de base de dados recriam a base `lexflow_test`, aplicam um *shim* mínimo do Supabase (`tests/db/supabase-shim.sql`: papéis `anon`/`authenticated`, `auth.users`, `auth.uid()`) e depois **todas as migrações de produção**. Cada teste executa como um utilizador concreto, tal como o PostgREST faz no Supabase.

Para usar um Chromium já instalado no Playwright: `PLAYWRIGHT_CHROMIUM_PATH=/caminho/chrome npm run test:e2e`.

## Estrutura

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#estrutura-de-pastas).

## Princípios que o código segue

- Autorização sempre no servidor e na base de dados; a interface só esconde.
- Nenhum dado fictício apresentado como real: módulos por implementar dizem-no e explicam o que falta.
- Nenhuma integração é dada como ligada sem o estar.
- Segredos nunca no frontend; tokens de convite guardados apenas como hash.
- Registo de atividade imutável para ações importantes.
