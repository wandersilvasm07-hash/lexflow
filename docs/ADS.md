# Publicidade (Fase 5)

## Fluxo (13 passos)

| Passo | Onde | Notas |
|---|---|---|
| 1–5 Serviço, objetivo, localização/idiomas, orçamento, destino | Tráfego Pago IA › Nova campanha | Destinos disponíveis: WhatsApp e página de destino. Formulário da Meta e objetivo "Pedidos de contacto" ainda não. |
| 6–7 Plano e anúncios | Ficha da campanha | A IA (`src/lib/ads/generate.ts`) propõe objetivo, estrutura, público, localizações, orçamento sugerido (texto), justificação, estimativas identificadas e 2–3 variantes com briefing de imagem. **Nunca altera o orçamento.** |
| 8 Conformidade | Ficha | `src/lib/ads/compliance.ts`, regras determinísticas. "Impede" bloqueia a aprovação na base de dados. |
| 9 Pré-visualização | Ficha | Aproximação do feed. |
| 10 Aprovação | Ficha | Três declarações explícitas. Fica em `campaign_approvals`: quem, quando, texto aceite, `content_hash` (SHA-256 do conteúdo + orçamento + datas + destino) e valores. Qualquer alteração depois anula a aprovação. |
| 11 Publicação | Ficha | `request_campaign_publish` é idempotente (`publish_key`); `src/lib/ads/publish.ts` guarda cada ID criado na Meta e retoma onde parou. Tudo é criado em PAUSA e só é ativado no fim; o estado mostrado é o confirmado pela Meta. |
| 12 Resultados | Ficha e Relatórios | Métricas diárias da Meta (`campaign_metrics_daily`), sincronizadas diariamente (cron) e a pedido. |
| 13 Melhorias | Ficha | Sugestões da IA só com ≥ 3 dias de dados reais; nada é aplicado automaticamente. |

## Controlo financeiro

- Limites por escritório (`ad_budget_settings`): diário por campanha, total por campanha, diário de todas as campanhas juntas, % de alerta. Só `settings.manage` altera; auditado.
- Verificados na base de dados ao criar, alterar, aprovar **e** publicar (se os limites baixarem depois da aprovação, a publicação é recusada).
- Na Meta: `spend_cap` da campanha = orçamento total; orçamento diário no conjunto de anúncios; data de fim quando definida.
- Alerta quando o gasto real chega à % definida; ao atingir o total, a campanha é pausada e fica registado.
- Sem duplicação: não se aprova uma campanha com o mesmo conteúdo de outra aprovada ou em curso; publicar duas vezes não cria nada de novo.
- Permissões: `campaigns.write` prepara; `campaigns.publish` (administrador e advogado) aprova, publica, pausa e liga a conta.
- Registo de alterações: `campaign_events` (só acrescenta).

## Regras de conteúdo (base, outubro de 2026)

- O art. 94.º do Estatuto da Ordem dos Advogados (publicidade) foi revogado pela Lei n.º 6/2024. Continuam a aplicar-se a proibição de angariação de clientes (art. 90.º, n.º 2, al. h), a dignidade da profissão e o segredo profissional (não divulgar casos nem clientes).
- Regime geral da publicidade: proibida a publicidade enganosa (promessas de resultados, taxas de sucesso, superlativos sem prova).
- Meta: desde 6/10/2025 não entrega na UE anúncios sobre temas sociais, eleitorais ou políticos. Anúncios centrados no serviço jurídico não deviam ser afetados, mas a classificação é da Meta. Anúncios não podem afirmar características pessoais de quem os vê.
- A verificação automática não substitui a revisão por um advogado; a aprovação pede essa confirmação expressa.

## Atribuição

Um contacto é atribuído a uma campanha quando a primeira mensagem chega por um anúncio "clique para WhatsApp" (o webhook traz `referral.source_id` = ID do anúncio). Contactos que viram o anúncio e escreveram mais tarde por outro caminho não são atribuídos. Os relatórios separam números da Meta e números calculados pelo Patrono.

## Estado da integração com a Meta

O código da ligação (OAuth), publicação, mudança de estado e métricas está escrito e testado com respostas simuladas da API (`src/lib/ads/meta.test.ts`). **Ainda não foi testado com uma conta de anúncios real.** Variáveis necessárias: ver `docs/CREDENTIALS.md`.
