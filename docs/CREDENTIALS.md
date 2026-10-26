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
