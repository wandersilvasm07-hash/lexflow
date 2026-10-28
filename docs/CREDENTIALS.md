# Credenciais e serviços externos

| Serviço | Fase | O que é preciso | Onde fica |
|---|---|---|---|
| Supabase (dev) | 1 | Projeto em região UE; URL e chave **publicável** | `.env.local` |
| Supabase (prod) | 6 | Projeto separado, plano pago (backups/PITR), região UE | variáveis do alojamento |
| Alojamento | 1 | Vercel (recomendado) ligado ao repositório | — |
| Email transacional | 1–2 | SMTP próprio no Supabase (ex.: Resend, Postmark). O SMTP de testes do Supabase tem limites muito baixos | painel Supabase › Auth › SMTP |
| WhatsApp Business Platform | 2 | Conta Meta Business **verificada**, app Meta, número dedicado, `access token` de sistema, `app secret`, `verify token` | cofre de segredos (Supabase Vault) / variáveis de servidor |
| Modelo de linguagem | 2–3 | Chave de API (ex.: Anthropic), com retenção zero de dados quando disponível | variável de servidor |
| Meta Ads | 5 | Conta de anúncios, página do escritório, app com `ads_management` aprovado | por escritório, cifrado |
| Google Ads | posterior | Developer token, OAuth | — |
| Stripe | 6 | Conta, produtos/preços, webhook secret | variáveis de servidor |

## Regras

- Chaves secretas **nunca** com prefixo `NEXT_PUBLIC_`.
- Tokens de terceiros por escritório (Meta) guardados cifrados, nunca devolvidos ao browser.
- Sem credencial → o módulo funciona em **modo de simulação identificado na interface** ou mostra o que falta. Nunca afirma estar ligado.

## Configuração de email do Supabase (Fase 1)

Em *Authentication › URL Configuration*: `Site URL` = URL da app; adicionar `https://<app>/auth/confirm` aos Redirect URLs.

Em *Authentication › Email Templates*, usar links com `token_hash` (funciona em qualquer browser/dispositivo):

- Confirmar registo: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app`
- Recuperar palavra-passe: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-palavra-passe`

Em *Authentication › Sign In / Providers*: ativar "Confirm email". Em *Multi-Factor*: ativar TOTP.

## Variáveis de servidor da Fase 2 (Vercel › Settings › Environment Variables)

| Variável | Para quê | Obrigatória para |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase (`sb_secret_…`), só no servidor | Assistente de IA e webhook |
| `ANTHROPIC_API_KEY` | Modelo de linguagem do assistente | Assistente de IA |
| `ANTHROPIC_MODEL` | Opcional; por defeito `claude-sonnet-5-5` | — |
| `WHATSAPP_APP_SECRET` | Verificar a assinatura dos webhooks da Meta | WhatsApp real |
| `WHATSAPP_VERIFY_TOKEN` | Texto à escolha, igual ao configurado na Meta | WhatsApp real |
| `WHATSAPP_ACCESS_TOKEN` | Token de sistema da app Meta | WhatsApp real |
| `WHATSAPP_GRAPH_VERSION` | Opcional; versão da Graph API | — |

Sem estas variáveis a aplicação continua a funcionar: o modo de simulação mostra as conversas, e a interface indica claramente o que falta.

## Variáveis da Fase 5 — publicidade (Vercel › Settings › Environment Variables)

| Variável | Para quê | Obrigatória para |
|---|---|---|
| `META_APP_ID` | Identificador da app na Meta for Developers (produto "Marketing API" + "Facebook Login for Business") | Ligar contas de anúncios |
| `META_APP_SECRET` | Segredo da mesma app | Ligar contas de anúncios |
| `ADS_TOKEN_KEY` | Chave de cifra dos tokens da Meta: 32 bytes em base64 (`openssl rand -base64 32`) | Ligar contas de anúncios |
| `CRON_SECRET` | Protege a sincronização diária `/api/cron/ads-sync` (a Vercel envia-o automaticamente) | Métricas e alertas automáticos |
| `META_GRAPH_VERSION` | Opcional; versão da Graph API | — |

Na app da Meta: URL de redirecionamento OAuth válido `https://<app>/api/meta/oauth/callback`; permissões `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` (exigem revisão da app pela Meta para uso por outros escritórios).

Sem estas variáveis, as campanhas podem ser preparadas, revistas e aprovadas; a publicação fica indisponível e a interface diz porquê.
