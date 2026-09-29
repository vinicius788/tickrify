# Tickrify: CLAUDE.md

> **Reorganizado em 25/09/2026.** O diario cronologico completo (4.267 linhas, de
> jun a 24/09/2026) esta arquivado sem cortes em
> `_local/CLAUDE-historico-ate-2026-09-25.md` (gitignored) e no historico do git.
> Aqui ficou so o que se usa: regras, estado atual, pendencias com data e um
> resumo do que ja passou.
>
> **Como manter este arquivo:**
> - Ao fechar um item, tire a linha da secao 6 (Pendencias) e ponha uma linha no
>   Historico resumido (secao 7), no MESMO commit.
> - Nada de sprint nova de 80 linhas embaixo. Detalhe longo vai para `_local/`;
>   aqui entra o resumo e a regra que nasceu dele.
> - Estado de ambiente (env var, painel, configuracao de terceiro) so vale se foi
>   LIDO no painel, nunca lembrado de uma sessao anterior. Este arquivo ja
>   afirmou errado tres vezes (`CLERK_SECRET_KEY`, `ENABLE_QUICK_GROUNDING`,
>   `RESEND_API_KEY`).
> - Ao receber auditoria, relatorio ou plano (de fora ou de outra sessao), cruze
>   com as secoes 3, 5 e 6 ANTES de abrir codigo. Isso ja custou duas sessoes
>   inteiras reconferindo trabalho pronto (17/08 e 26/08).

**Sumario:** 1. Regras de trabalho · 2. O produto · 3. Estado atual ·
4. Regras tecnicas que nasceram de bug real · 5. SEO/GEO · 6. Pendencias abertas ·
7. Historico resumido · 8. Opcional (contexto antigo)

---

## 1. Regras de trabalho do Claude (ler antes de tudo)

### 1.1 Nao encher o repo de arquivo (28/07/2026, permanente)

1. Nenhuma sessao cria arquivo novo no repositorio, a nao ser **codigo que roda**
   (`.ts`, `.tsx`, `.sql`, config, migracao). Arquivo que nao e codigo: **nao
   crie, pergunte.**
2. Documento (plano, relatorio, prompt, thread, roteiro, analise, handoff) vai
   para `_local/` (gitignored) ou e entregue no chat. Nunca no git.
3. Nada de `RESUMO.md`, `HANDOFF.md`, `PLANO_X.md`, `NOTES.md`, README novo. O
   contexto do projeto mora AQUI; atualize este arquivo em vez de criar outro.
4. Arquivo de codigo novo precisa de justificativa dita antes de criar (por que
   nao cabe num existente). Preferir editar a criar.
5. O `.gitignore` bloqueia `.md`/`.png`/`.csv`/`.xlsx`/`.pdf` na raiz, `_local/`,
   `marketing-sprint/`, `handoff/`, `planos/`, `relatorios/`, `prompts/` e
   `*.docx`/`*.xlsx`/`*.pptx`/`*.pdf` em qualquer pasta. Se precisar desligar
   uma dessas regras, voce esta fazendo a coisa errada.

`docs/` fica so com doc tecnica (ENV_VARIABLES, PROMPTS, runbooks).

### 1.2 Nao deixar codigo morto para tras (21/09/2026, permanente)

Vale para TODA mudanca, grande ou pequena:

1. **Quem tira o uso, tira o codigo.** Removeu tela, rota, botao ou chamada? Na
   MESMA mudanca remova o que so existia para ela: endpoint, metodo de service,
   hook, tipo, DTO, chave de i18n (nos 6 idiomas), mock de teste, dependencia,
   variavel de ambiente documentada. Nada de "fica para depois".
2. Nada de casca "para nao quebrar import". Export que so sobrevive por causa de
   um mock ou comentario: apague os dois juntos.
3. Codigo comentado, feature flag sem leitor, `console.log` de depuracao e helper
   duplicado nao entram em commit. Log de operacao (linha de boot, `[funnel]`,
   `[Metrics]`, `[Cost]`) e intencional e fica.
4. **Antes de apagar, confirme** ("parece nao usado" nao basta): busca no repo
   INTEIRO (frontend, backend, worker, scripts, `public/`, `.github/workflows`,
   Dockerfile/entrypoint, imports dinamicos); rota de backend: quem chama de FORA
   (Stripe, crons, Actions, operacao manual); dependencia: se nao e peer/runtime
   de outra e se config (postcss, nest-cli) nao a usa sem import. Depois:
   typecheck, lint, testes e build dos DOIS lados; mexeu em dependencia ou infra,
   teste de Docker (1.3).
5. Env var sem uso no codigo: listar para o dono remover no painel. Claude nao
   remove (e config de producao).

### 1.3 Portoes e limites do ambiente

- **Portao real: `pnpm check` na raiz** (frontend: `tsc -b --force` + `vitest run
  --environment jsdom` + build). Backend: `pnpm test` na raiz (jest) e
  `tsc --noEmit` em `apps/backend`. **O build do Render NAO e portao de tipo:** em
  14/09 (`a9ab59b`) um backend que nao compilava foi para producao e ficou ~3h no
  ar. Nao existe rede de seguranca depois do commit.
- O dono nao roda build local: o codigo tem que estar certo na primeira. Rodar o
  typecheck do frontend antes de entregar, sempre.
- **Na VM do Claude (maquina do dono):** funcionam `./node_modules/.bin/tsc`,
  `eslint` e `vitest run --environment jsdom` (nunca `vitest` cru: sem jsdom, 17
  testes falham com "window is not defined"). NAO funcionam `vite build` (binario
  nativo do rollup/esbuild e darwin-arm64), `prisma generate` e `npx` (sem rede,
  403). A pasta montada nao deixa apagar arquivo.
- Erro de tipo de coluna nova no backend = Prisma Client desatualizado. O dono
  resolve com `npx prisma generate` em `apps/backend`; o Render ja roda antes do
  `nest build`.
- **Validar `prerender.mjs`/`geo-body.mjs` sem `vite build`:** copiar `scripts/`,
  `src/lib/seo-routes.json` e um `index.html` para pasta temporaria fora do repo
  e rodar `node scripts/prerender.mjs` duas vezes seguidas (conferir que nao
  contamina). O aviso "bloco #root nao reconhecido" com o `index.html` FONTE e
  esperado.
- **Mexeu em dependencia ou infra:** imagem Docker de `git archive HEAD` +
  Postgres/Redis descartaveis, `RUN_MIGRATIONS_ON_START=true`, `sslmode=disable`
  so no teste, e TODAS as env que criam cliente no construtor com valor falso
  (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`). Subir dependencia
  exige conferir `engines.node` contra o `FROM node:20-alpine` (21/09: o
  supabase-js 2.116 derrubou o boot; fixado em 2.100.1).

### 1.4 Git na maquina do dono

- O dono roda `git add/commit/push`. Comando de terminal sempre em UMA linha,
  marcado como comando.
- O sandbox nao apaga arquivo: comando git que toca o index deixa
  `.git/index.lock` (0 byte) e o proximo commit do dono quebra. Evitar
  `git status`/`git diff`; usar `git --no-optional-locks status --porcelain`, e
  avisar (`rm -f ~/dev/tickrify/.git/index.lock`). Ler arquivo com grep/sed nao
  cria lock.
- Nunca `git add -A` sem olhar o que vai junto: trabalho parado de outra sessao
  entra sem portao (ja aconteceu duas vezes).
- Push rejeitado sem ninguem ter feito nada = o `calendar-mirror.yml` commitou o
  espelho. `git pull --rebase --autostash origin main && git push`.
- Commits parados sem push: `git rev-list --count origin/main..main`.
- Commits pequenos e reversiveis. Nunca registrar chave ou segredo em doc, commit
  ou log (o dono cola direto no Render/servico).

### 1.5 Producao, paineis e dados

- Escrever no banco de producao esta fora do alcance do Claude: entregar SQL
  pronto para o SQL Editor do Supabase, com o id preenchido e o comando de
  desfazer junto.
- Nada que altera producao, cobranca, ou que e publico/irreversivel sem o dono
  confirmar na hora (salvar env no Render dispara redeploy; algumas opcoes da
  Stripe sao de mao unica).
- **Ler o bundle em producao:** WebFetch le so ~185 KB e responde "ausente" para
  tudo. Usar
  `curl -s "https://tickrify.com/assets/$(curl -s https://tickrify.com | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)" | grep -c "<string>"`,
  sempre com uma string de controle. Botao "sumido" em producao costuma ser cache
  do navegador (`Cmd+Shift+R`).
- Formulario React que resiste a automacao (ex.: Bing Webmaster): clicar via JS e
  preencher com o setter nativo do `HTMLInputElement` + eventos `input`/`change`
  com `bubbles: true`.
- `resize_window` do navegador nao muda o `innerWidth`: testar responsividade com
  iframe de largura fixa.
- **PageSpeed mobile varia ~17 pontos entre runs iguais.** Rodar 3 e olhar o que
  nao se move (a tabela de recursos bloqueantes). A API anonima da 429; usar a
  interface `pagespeed.web.dev`.
- Rotulo copiado de painel (ex.: conversao do Google Ads): extrair do DOM, nunca
  ler do screenshot (`l` minusculo vs `1`).

---

## 2. O produto

- **Tickrify:** SaaS freemium de analise de grafico com IA para traders. Sobe o
  print, a IA devolve leitura estruturada (entry, stop, alvos, confianca,
  confluencia, risco, cenarios) ou WAIT. North Star = assinantes pagos / MRR.
- **Posicionamento:** global, em ingles. "A second opinion, not signals." A IA le
  o grafico frio: quem chega com tese ganha segunda opiniao, quem chega sem ganha
  a primeira. A decisao e sempre do trader.
- **Plano unico:** US$ 29/mes ou US$ 290/ano, 200 ticks. Desde 21/09 o saldo do
  assinante e NO MAXIMO 200: no inicio de cada janela mensal volta a ser
  exatamente 200 (nao acumula). Quick = 1 tick, deep = 3. Free = 3 analises
  quick (deep so para assinante). Na UI se fala em "analyses"; "ticks" e so
  unidade de cobranca. Checkout sempre em USD (Adaptive Pricing da Stripe
  converte).
- **Semanal (28/09):** o mesmo plano por US$ 7,99/semana, saldo volta a 25
  ticks a cada 7 dias (`WEEKLY_PRICE_ID` e `WEEKLY_TICKS` em
  `config/stripe.config.ts`; price `price_1UKeWPB1hl0IoocUjsQNv9BG`). Sem
  EARLY35 (o cupom e do 1o mes; o servidor descarta). No `/usage` o plano vem
  `weekly`. Motivo: 17 checkouts abertos de 11 a 27/09 sem ninguem digitar o
  cartao, publico quase todo de pais onde US$ 29 de uma vez nao fecha.
- Checkout com `billing_address_collection: 'auto'` desde 28/09 (era
  `required`: formulario de endereco inteiro no celular).
- **Cupons:** EARLY35 (35% no 1o mes) pre-aplicado no paywall e na /pricing; o
  estado e lido da Stripe (`founding-offer.ts`) e a oferta some sozinha quando o
  cupom acaba (5 de 50 usos em 21/09; tentativa recusada tambem gasta uso). O DTO
  so aceita EARLY35. Codigo EARLY50 segue ativo por decisao do dono. TICKS (100%
  vitalicio) arquivado.
- **Assinantes:** 3 pagantes (08 a 10/09, todos pelo paywall, a US$ 18,85). A
  conta do dono tem acesso manual (`manual_owner_1` no banco, nao na Stripe):
  **toda contagem de assinantes pelo banco filtra
  `WHERE "stripeId" NOT LIKE 'manual_%'`.**
- **Aquisicao:** o canal que funciona e organico via ChatGPT (368 de 1.017
  pageviews em 30 dias ate 14/09). Anuncios de set/26 (Google + Meta): ~R$ 41,
  ~209 visitas, 0 assinantes. O que converte e USO: `/try` → analise → limite →
  paywall, nao a vitrine.
- **Contas:** Bing Webmaster e Google Ads (489-869-2148) em `tickrify@gmail.com`.
  Search Console na conta pessoal do dono. Suporte: `support@tickrify.com` (Zoho).

---

## 3. Estado atual (o que esta no ar)

### 3.1 Stack e infra (conferida nos paineis em 16/09 e 21/09)

- **Frontend:** Vite + React 19 + Clerk + React Router 7 + TanStack Query, no
  Vercel (projeto `tickrify-frontend`, dominio tickrify.com). Monorepo pnpm
  (`apps/frontend`, `apps/backend`), pnpm fixado em 10.12.4 no Dockerfile.
- **Backend:** NestJS + Prisma no Render, servico `tickrify`
  (`srv-d6o0b5nafjfc73ap4270`), plano pago `0.5c-512mb` desde 08/09 (nao
  hiberna). As env vars ficam direto no servico (nao existe env group). Banco
  Supabase (regiao us-west-2). Redis `tickrify-redis` (BullMQ).
- **O worker roda, mesmo sem servico proprio no painel.** O Render usa o
  `Dockerfile` da raiz, e o `infra/docker-entrypoint.sh` sobe API + worker
  embutido no mesmo conteiner (`RUN_EMBEDDED_WORKER` ausente = `true`). Prova no
  boot: `[Outcome] Outcome tracking ligado`. Nunca iniciar o sweeper em outro
  lugar sem desligar o worker embutido (varredura duplicada).
- **Migracoes:** `RUN_MIGRATIONS_ON_START=false`. Quem mantem o schema e o
  `ADD COLUMN IF NOT EXISTS` dos `onModuleInit`. Coluna nova = migracao Prisma
  **e** `ADD COLUMN IF NOT EXISTS` no boot. Indice, constraint ou rename exigem
  SQL manual no Supabase (entregue ao dono).
- **i18n:** `apps/frontend/src/lib/i18n/{pt,en,es,fr,de,ja}.ts`, padrao `en`, o
  tipo vem de `pt.ts`. So o ingles e indexavel (decisao de 17/08): as outras 5
  sao conforto de UX.
- **E-mail (Resend, `noreply@tickrify.com`, reply_to `support@`):** boas-vindas
  no cadastro; recuperacao "cota gratis esgotada" ao concluir a 3a analise gratis,
  nos DOIS caminhos (`modules/mail/recovery-email.ts`), uma vez por pessoa, e nao
  para quem ja assina. A Stripe manda o e-mail de falha de pagamento (ligado
  15/09). Relatos do botao "reportar problema" vao para `support@` (teto global
  de 20 e-mails/hora).
- **GitHub Actions:** CI, `calendar-mirror.yml` (a cada 6h), `backup.yml` (diario,
  retencao 7 dias). O `keep-warm` foi removido em 21/09 (o Render pago nao
  hiberna). Ver pendencia de 21/09 sobre Actions parado.
- O frontend tem um historico proprio em `apps/frontend/CLAUDE.md` (31/08).

### 3.2 Motor de IA

- **Modelo:** `gpt-5.6-luna` no quick e no deep (`AI_MODEL_QUICK`,
  `AI_MODEL_DEEP`). `AI_REASONING_EFFORT_QUICK=low` (09/09); `_DEEP` nao setada
  (padrao da OpenAI). O `gpt-4o` (desligado pela OpenAI em 23/10/2026) nao e mais
  usado.
- **Prompt:** v7.5 (24/09) em `apps/backend/src/common/prompts/trading-system-prompt.ts`.
  O `PromptSyncService` publica como versao nova no boot, entao `promptVer`
  separa antes e depois. Tetos de caracteres por campo desde 09/09.
- **Grounding do quick ligado** (`ENABLE_QUICK_GROUNDING=true`): candles reais
  (OKX, Binance de reserva, Twelve Data para XAU/FX), RSI(14), posicao no range,
  momentum, volume e mapa de volume por preco (SO cripto: forex e metais spot nao
  tem volume e o motor nao inventa), mapa de eventos e guarda de print velho
  (`detectStaleChart`). Acoes/ETF nao tem grounding.
- **Guards ligados por padrao:** news guard (evento High entre -15min e +45min
  vira WAIT) e R/R guard (rebaixa so quando nem o MELHOR alvo passa de 1.2:1).
- **Outcome sweeper** (worker, 1x por hora): avalia analises 48h depois, corrida
  TP1 x SL em candles de 30m. `outcome` = o que o mercado fez (MAIUSCULO, so o
  sweeper); `userVerdict` = o que o trader marcou (minusculo, so o `setOutcome`).
- **Latencia e custo medidos (09/09):** o backend gasta ~49 ms; o resto e a
  OpenAI escrevendo (~102 tokens/s). Quick ~18,5 s e ~US$ 0,0195 (margem ~86%).
  Toda analise loga `[Cost]` e `[Metrics]` no Render.
- **Timeouts acoplados:** backend `AI_ANALYZE_TIMEOUT_MS=120000`; frontend
  (`lib/api.ts`) `ANALYZE_TIMEOUT_MS` 150 s e `POLL_TIMEOUT_MS` 300 s. Nunca
  mexer em um sem o outro: o worker conclui, a tela ja desistiu, o tick foi
  cobrado.
- **`/accuracy`** publica o acerto com n e intervalo de Wilson; a home le os
  numeros ao vivo da mesma API (sem resposta mostra um traco, nunca numero velho). O
  score de confianca NAO mostrou poder preditivo em producao (27/07).
- **Perfil de estrategia (pago):** campos fechados, selo `strategyFit`
  (`ideal|good|poor|conflict`) que nunca muda a recomendacao; analise com
  estrategia fica fora de tudo que e publico (`strategyHash`).
- **A/B do prompt v9:** `AB_PROMPT_V9_PERCENT` = 0, desligado (ver secao 8).

### 3.3 Pagamentos (Stripe)

- **Moeda fixa `usd` no servidor** (controller ignora o body). E fronteira de
  seguranca, nao preferencia: nao reverter. Price IDs BRL/EUR e planos
  `pro`/`elite` ficam no `stripe.config.ts` so como legado.
- **Webhook na API `2025-07-30.basil`:** a fatura traz a assinatura em
  `parent.subscription_details`, nao no topo (`invoiceSubscriptionRef` le os dois
  formatos). Todo campo novo lido do payload: conferir no formato basil.
- **Idempotencia:** tabela `StripeWebhookEvent` por `event.id`; estado da
  assinatura sempre RELIDO na Stripe; credito por janela com chave
  `allowance:<assinatura>:<inicio da janela>` na coluna unica
  `stripePaymentIntentId` (webhook, lazy sync e `ensureTicksForActiveSubscriber`
  usam a mesma). Handler com erro responde nao-2xx para a Stripe reenviar.
- **NAO reenviar pelo painel eventos `invoice.payment_succeeded` antigos.**
- Login antes do checkout preserva a intencao de compra (`lib/checkoutIntent.ts`).
- Meta Pixel + Conversions API com dedup por `event_id`. Cada etapa do funil de
  compra loga `[funnel] stage=...` e grava AdminAudit `funnel:<etapa>`.
- Pacotes avulsos removidos em 21/09. Se voltarem, separar saldo comprado do
  reset mensal, senao o reset apaga ticks pagos.
- Fallback de cupom: cupom que a Stripe recusa nao derruba o checkout, so deixa
  de descontar.

### 3.4 Analytics

- **PostHog:** o backend e a fonte da verdade (distinctId = id do Clerk):
  `signup_completed`, `free_analysis_started/completed`, `free_quota_exhausted`,
  `checkout_completed`, `subscription_created`, `payment_succeeded/failed`.
  Navegador: `landing_viewed`, `pricing_viewed`, `pricing_section_viewed`,
  `signup_started`, `analysis_started/completed`, `upgrade_cta_*`,
  `upgrade_clicked`, `checkout_started/failed/canceled`,
  `checkout_success_viewed`, `analysis_shared {step}`. Nomes antigos
  (`landing_view`, `subscription_activated`, `signup_completed_server`) so
  existem no historico: funil novo usa os nomes acima.
- **Sem aceite de cookies, o PostHog roda cookieless** (24/09). Depende de "Enable
  cookieless tracking" LIGADO no painel do PostHog (desligado, o servidor descarta
  tudo calado). Evento sem cookie nao tem pais: usar `$timezone`. Testar o
  PostHog pela rede ou pela chave `ph_*` no localStorage, nunca por
  `window.posthog` (e modulo npm, nao global).
- Meta Pixel, GA4 (`G-SME6X097T6`) e Google Ads (`AW-18439434622`) so carregam
  com aceite. Conversoes do Ads (sign_up e purchase) com rotulos no codigo
  (`ADS_CONVERSION_LABELS` em `analytics.ts`), nao em env var.
- **Sentry:** `environment` decidido por `import.meta.env.PROD`; ruido do Google
  Translate e do ResizeObserver filtrado no cliente; WebView do Instagram so
  marcado (`tags.webview`), nao descartado.
- Pergunta de atribuicao no painel (`AcquisitionSurvey`): a primeira resposta
  vale, dispensar nao grava nada.

---

## 4. Regras tecnicas que nasceram de bug real (nao desfazer)

### 4.1 Motor e OpenAI

- **Ordem do `json_schema` = ordem de geracao:** `is_financial_chart` →
  `analysis` (reasoning primeiro) → `recommendation` → `confidence` →
  `strategyFit`. Mover campo para cima desfaz a trava sem quebrar tipo (ha teste
  que le o fonte).
- **GPT-5 rejeita `temperature`, `top_p`, `max_tokens` e `seed`:** tudo passa por
  `buildSamplingParams` em `modules/ai/openai-params.ts`. Sem temperatura, a
  consistencia depende so do prompt.
- `reasoning_effort` invalido e ignorado (typo no painel nao derruba analise).
  `high` e inutilizavel (medido: estoura o timeout). Teto de saida abaixo de ~16k
  tokens perde o veredito (a resposta trunca e vira HOLD).
- `model-cost.ts`: `reasoning_tokens` ja esta DENTRO de `completion_tokens` (nao
  somar). Preco de modelo so no `PRICING`. `⚠️ CUSTO ACIMA DA RECEITA` no log e
  incidente.
- **Motor so muda com medicao.** Nunca trocar modelo e prompt no mesmo teste. Nao
  mexer em parametro de modelo as vesperas de demo importante.
- **Dois caminhos de producao:** a FILA (`worker/ai.worker.ts`, o caminho real) e
  o sincrono do `ai.service` (fallback). Parametro novo no `analyzeImage`
  alimenta os dois, e o teste confere o que e GRAVADO no fim, nao so o que chega
  (o perfil de estrategia quebrou assim duas vezes: 31/08 e 24/09).
- **Calendario economico:** `getEventsForSymbol` devolve `{ events, degraded }`;
  falha nunca vira "sem eventos" e a tela mostra aviso. Se degradar,
  **reiniciar o servico no Render antes de investigar** (31/08). Espelho: fonte
  direta primeiro, espelho (`public/calendar/thisweek.json`) so se a direta
  falhar inteira. No ForexFactory so existe `thisweek`.
- Noticia/manchete em tempo real nao existe no projeto (so calendario agendado).

### 4.2 Backend

- `GlobalAuthGuard`: rota sem decorator nasce FECHADA; publica so com
  `@Public()`. `route-access.spec.ts` quebra o CI se faltar decisao. O `role` vem
  do banco, nunca do token do Clerk.
- **DTO:** decorator do class-validator em TODO campo + teste contra o
  `ValidationPipe` real (`whitelist` + `forbidNonWhitelisted`, igual ao
  `main.ts`). Campo sem decorator faz a requisicao inteira ser rejeitada (o salvar
  do perfil de estrategia quebrou 100% em producao com tsc e jest verdes).
- **Query publica:** `isDemo: false` E `strategyHash: null`. O
  `strategy-accuracy-guard` so varre o `ai.controller.ts` pelo marcador
  `isDemo: false`; rota publica nova em outro arquivo e responsabilidade de quem
  escreve.
- Perfil de estrategia so com campos fechados (whitelist). Texto livre do usuario
  no prompt = injecao contra a abstencao que sustenta a `/accuracy`.
- Paginacao por cursor validado contra o usuario (`findFirst({ id, userId })`),
  `orderBy` com `id` de desempate; cursor alheio devolve lista vazia.
- **Env var ausente nao da erro, some calada** (no Vite e no Nest). Por isso as
  flags que a vitrine vende aparecem no boot log e no `/health` (ops token):
  `quickGrounding`, `calendar`, modelos, `reasoningEffort*`, `📣 Meta CAPI`.
  `disabled`/`degraded` = incidente de claim, nao config.
- Antes de suspeitar de ambiente, confirmar que o codigo que usa aquele ambiente
  chega a ser EXECUTADO (o e-mail NULL de julho era uma rota que ninguem chamava).

### 4.3 Frontend

- **Casca do `index.html`:** dentro do `#root` nao ha texto (so a barra do
  cabecalho; a logo animada so aparece em `/dashboard`, `/demo`, `/admin`). Texto
  duplicado fora do React diverge. Comentario dentro do `<style>` do index viaja
  para o navegador em toda requisicao: manter curto.
- **CSS do site publico:** `.site-*`/`.tk-site` ganham do Tailwind (vem depois no
  CSS final). Ajuste em elemento `.site-*` vem de outra classe `.site-*`.
- Campo de digitar no painel nunca abaixo de 16px (zoom automatico do Safari no
  iPhone). `maximum-scale` no viewport e proibido (acessibilidade).
- A `<img>` de 400px na demo mobile (`.site-demo-chart`) e zoom DELIBERADO, contido
  por `overflow: hidden`. Nao "corrigir". Imagens publicas levam `width`/`height`
  e `height: auto` no CSS.
- **Resultado do trade (TP1/TP2/Stop/aberto): o SERVIDOR e a fonte da verdade.**
  A marcacao local e so otimista e sai quando o servidor confirma e a lista e
  relida; se ele recusar, a tela desfaz e avisa. Nunca voltar a persistir o
  veredito no localStorage acima do servidor (25/09: um "aberto" antigo guardado
  no aparelho fazia o aviso "trade still open" voltar para sempre). `setOutcome`
  grava resultado E valor juntos; valor vazio e NULL, nunca 0.
- `useAPIClient`: 1a tentativa com o token do cache do Clerk; `skipCache` so
  depois de 401. Nao voltar o `skipCache` para a 1a tentativa.
- Teste que monta componente: `cleanup()` no `afterEach` (nao ha config global do
  Vitest). Rodar via `pnpm test`.
- `useJsonLd` remove o elemento de mesmo id antes de inserir; pre-render e React
  usam os mesmos ids, com `@graph` num id so.
- **`prerender.mjs` e `geo-body.mjs`:** fonte unica (texto do `en.ts`, numeros da
  API no build, preco e FAQ do `PricingPage.tsx`); se a extracao falha, nao emite
  nada. `String.replace` sempre com FUNCAO de replacement (o `$29` virava "9").
  `stripBody()` evita que execucao repetida contamine as rotas.
- Paginas estaticas em `public/` (`blog/`, `tools/`, `for/`, `calendar/`) sao
  servidas pelo Vercel antes do rewrite da SPA. Elas tem `<head>` proprio e nao
  passam pelo pre-render: mudanca de head vale nelas tambem (21 arquivos).
- `og.png`: ao trocar a arte, subir o `?v=` (hoje `?v=2`, 54 referencias).
- Meta `msvalidate.01` do Bing no `index.html`: nao remover (o Bing revalida).

### 4.4 Claims e texto publico

- Toda afirmacao da vitrine tem que ser verdadeira e verificavel no codigo. Abrir
  o arquivo do motor ANTES de escrever a frase, nao depois.
- Sem dado real, a secao nao aparece. Nunca inventar numero, avaliacao,
  depoimento ou `aggregateRating`. Numero publico so com metodologia e
  disclaimer; de preferencia vindo da API, nunca fixo no codigo.
- Texto publico em ingles. Sem travessao. Sem emoji na interface.
- String com numero ou afirmacao verificavel muda nos 6 idiomas no MESMO commit,
  conferindo um a um. O `tsc` pega chave ausente, nao traducao desatualizada (ja
  divergiu tres vezes).
- "Second opinion" continua de proposito (keyword e verdade). O que saiu foi o
  pre-requisito "your setup/your read". Auditoria que marcar isso e falso
  positivo.
- **Card de compartilhamento:** sem entry/stop/alvo na estrutura; WAIT ganha card
  igual; texto do post sempre em ingles e sem performance; `publicVerdict()` e a
  unica fonte para imagem e texto. A prosa da IA pode conter precos: decisao
  consciente do dono (02/09).
- Datas "last updated" sao constantes (`LAST_UPDATED`) e mudam a mao quando o
  texto muda. `dateModified` so com mudanca real de conteudo.
- **Falsos positivos conhecidos:** `&amp;` nas UTMs dentro do HTML e o correto;
  ausencia de `hreflang` e o correto (nao ha URL por idioma).

---

## 5. SEO / GEO (tabela viva)

**Resolvido, nao reabrir sem evidencia nova:** meta/title/canonical por rota
(`hooks/useSeo.ts` + `lib/seo-routes.json`) · pre-render do head e do CORPO em
`<noscript>` (`scripts/prerender.mjs` + `scripts/geo-body.mjs`, confirmado em
producao em 15/09) · JSON-LD no HTML cru (FAQPage na home, SoftwareApplication +
Offer + FAQPage na /pricing, Dataset + FAQPage na /accuracy) · `/privacy`
canonica · sitemap com 25 URLs e `lastmod` · `/accuracy` linkada e reescrita no
formato que LLM cita · `og.png` proprio · descriptions de 130 a 163 caracteres ·
6 posts do blog com 1.386 a 2.621 palavras · 3 calculadoras em `/tools/` ·
landings `/for/` (sem acoes/ETF de proposito: nao ha grounding) · `noindex` de
verdade em `/sign-in` e `/sign-up` (fora do `Disallow`) · links estaticos para
`/blog/` · `robots.txt` com 15 crawlers de IA nomeados · Google Fonts fora do
caminho critico (`media="print"`) e Syne removida · `llms.txt` com links Markdown
(audit do Lighthouse passa, "Navegacao agentica" 3/3) · `Organization` schema ·
Bing Webmaster verificado com sitemap (15/09) · `<html lang>` segue o idioma.

Licoes: `Disallow` no robots impede rastrear, nao indexar (usar `noindex`). URL
sem link interno e despriorizada pelo Google mesmo estando no sitemap. Em
propriedade de dominio no Search Console, o sitemap vai com URL completa. Cota
da Inspecao de URL: 10 por dia.

Pendencias de SEO/GEO estao na secao 6.

---

## 6. Pendencias abertas (com data)

Ordem: primeiro o que tem data marcada, depois do mais recente para o mais
antigo. Ao fechar, mover para a secao 7 no mesmo commit.

### 6.1 Com data marcada

- **08 a 10/10/2026: primeira renovacao dos 3 assinantes.** Primeira vez que o
  credito por fatura (formato basil, chave `allowance:`) roda com cobranca real.
  Conferir no log do Render (`[funnel] stage=payment_succeeded`) e no banco que o
  saldo foi para 200; se recusar, conferir que o e-mail de falha da Stripe saiu.
  (Claude le o log / dono confirma no painel.)

### 6.2 Abertas

| Desde | Item | Quem |
|---|---|---|
| 28/09 | **Afiliados: configuracao manual na Stripe antes de divulgar.** (1) Criar cupom 10%, `duration: once`, e pôr o id em `STRIPE_AFFILIATE_COUPON_ID` no Render (sem ele: sem desconto para indicado e sem promotion code; a comissao funciona igual). (2) Marcar `charge.refunded` e `charge.dispute.created` no endpoint do webhook. (3) Afiliados que entraram ANTES do (1) ficam "sem promotion code" no admin: salvar o perfil deles de novo cria o codigo. Conferir no boot log `[affiliate] Tabelas prontas. Cupom da Stripe: configurado`. | dono |
| 24/09 | **Medir o WAIT% do prompt v7.5** por versao: `select "promptVer", count(*), round(100.0*avg((recommendation='WAIT')::int)) pct_wait from tickrify."Analysis" where status='completed' and model='gpt-5.6-luna' group by 1 order by 1;` Alvo 35 a 55%. Abaixo de 25%: olhar o win rate da `/accuracy` antes de qualquer coisa. Rollback = `git revert` do commit (o sync publica a volta). | dono roda o SQL, Claude le |
| 24/09 | Comentario do `schema.prisma` diz que a imagem "nao e mais salva": errado, a print e salva no Supabase Storage. Corrigir na proxima mudanca de schema. Evento candidato no funil: `trade_result_logged`. | Claude |
| 21/09 | **GitHub Actions parado** ("recent account payments have failed or your spending limit needs to be increased"): conferir se CI, `calendar-mirror` e `backup` voltaram a rodar. Ultimo backup valido: 16/09. Apagar os artifacts antigos (703 MB) para liberar a cota. | dono |
| 21/09 | **CLS oscilou de 0 a 0,128** no PageSpeed mobile. Suspeito nº1: troca de fonte depois do `media="print"`. Se passar de 0,1 em varios runs: self-host das fontes ou fallback com `size-adjust`, sem desfazer o `media="print"`. | Claude |
| 21/09 | Performance: 416 KB de JS nao usado na home; i18n dos 6 idiomas no bundle principal; `DashboardPage` (1.200+ linhas) sem memoizacao estudada; contraste; erros de console; 8 de 43 alvos de toque abaixo de 32px; pesos da Geist nunca auditados. | Claude |
| 21/09 | Reset mensal: a primeira tela do painel mostrou o saldo antigo (corrida entre `/ticks/balance` e `/usage`). Nao corrigido. | Claude |
| 21/09 | Abertos nao criticos: preflight CORS de origem desconhecida responde 500 em vez de negar; drift cosmetico entre migracoes e schema. | Claude |
| 21/09 | Env vars no Render sem leitor no codigo (dono decide remover): `ALLOW_UNAUTHENTICATED`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `FREE_ANALYSIS_LIMIT_PER_MONTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_MONTHLY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `VITE_GOOGLE_ADS_ID`. | dono |
| 21/09 | Trocar o e-mail de suporte para `support@tickrify.com` nos dados publicos da Stripe (recibo e checkout) e no Clerk. | dono |
| 21/09 | Checkout: de 13 a 20/09, ~11 sessoes abertas e 0 cartao submetido (fluxo conferido, NAO esta quebrado). Cruzar os clientes perdidos com pais no PostHog. Sessoes duplicadas no mesmo segundo sugerem `handleUpgrade` rodando 2x apos o login. E-mail proprio de checkout abandonado via Resend: caminho mapeado, NAO feito (decisao do dono). | Claude / dono |
| 21/09 | Conferir se o endpoint do webhook tem `payment_intent.payment_failed` e `checkout.session.expired` marcados (sem eles, recusa e abandono nao aparecem no `[funnel]`). Conferir no boot log se `📣 Meta CAPI` esta ON (`META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN`). | dono / Claude |
| 15/09 | **40% das tentativas de assinatura foram recusadas por falta de saldo** (codigo 51). Decidir entre preco regional, mirar geo de maior renda, ou nada, usando o dado de origem do `AcquisitionSurvey`. | dono |
| 15/09 | O link do e-mail de falha de pagamento da Stripe aponta para a home. Trocar para "pagina hospedada da Stripe" e IRREVERSIVEL (a Stripe avisa). | dono |
| 15/09 | Tag de conversao do Google Ads "nao verificada": so verifica depois da 1a compra desde o deploy. Conversao so conta para quem aceita cookies. Nao mexer ate existir compra. | aguardando |
| 15/09 | GA4 configurado; confirmar que o painel recebe dado. Se nao: filtro de trafego interno, se o fluxo 15784212373 e o dono do `G-SME6X097T6`, DebugView com `?_dbg=1`. | Claude |
| 14/09 | GEO: presenca em terceiros (Reddit, Product Hunt, AlternativeTo, G2, Capterra); dashboard no PostHog por `utm_source` e dominio de IA; conferir o relatorio AI Performance do Bing (`/webmasters/aiperformance`). | Claude / dono |
| 09/09 | Vigiar se `executiveSummary` e `structureValidation` ficaram rasos com os tetos de caracteres. Se sim, afrouxar primeiro o do `executiveSummary` (450), nunca o do `reasoning`. | Claude |
| 09/09 | Quick e deep rodam o MESMO modelo (luna); o deep se diferencia so por prompt e esforco (quick `low`, deep no padrao). Se a diferenca nao se sustentar, cobrar 3 ticks pelo deep vira claim sem lastro. `AI_REASONING_EFFORT_DEEP=medium` e opcional (nunca `high`). | dono |
| 31/08 | Os 6 posts do blog mantem o enquadramento antigo ("you already have the chart open"): divida nomeada, deliberada. Conferir: travessao no `<title>` de `/blog/` e `/tools/`; a barra de abas mobile do painel tinha rotulos em portugues e com emoji (ver se sobrou depois da mudanca de 24/09). | Claude |
| 26/08 | Search Console: pedir indexacao de `/for/bitcoin/`, `/for/gold/` e `/for/metatrader/` (cota de 10/dia estourou) e reconferir o "Ultimo rastreamento" das 8 URLs que estavam N/D. | Claude / dono |
| 26/08 | Imagens reais nos posts do blog: bloqueado ate o dono mandar print de uma analise real (BTC/NVDA/SPY). Os dois PNGs do repo sao prints crus sem analise e NAO servem. | dono manda, Claude liga |
| 26/08 | Autor pessoa com bio no schema `Article` (E-E-A-T em tema financeiro). Nao da para inventar nome. Glossario de padroes de candle (multi-dia). | dono define / Claude |
| 25/08 | Quando mexer no prompt por OUTRO motivo: pedir sem emoji e sem travessao (hoje limpos na exibicao por `cleanModelText`). Cuidado: os emoji separam os itens de `identifiedPatterns` e os ✅/❌ alimentam o `parseStructureChecklist`; dar outro separador ao modelo. | Claude |

---

## 7. Historico resumido (o que ja passou, so para contexto)

Uma linha por marco. Detalhe completo no arquivo historico em `_local/`.

- **jun/2026:** decisao global/ingles; 3 tiers (Starter/Pro/Elite).
- **03/07:** producao parada por OpenAI sem credito (`openai_billing`); resolvido.
- **10/07:** repo sai do iCloud para `~/dev/tickrify`; dominio do Resend verificado.
- **13/07:** backtest em `scripts/backtest/`; prompt v7.3; chip Read/Signal (limiar 70).
- **17 a 21/07:** grounding do quick e outcome sweeper no ar; incidente de migracao (P2022) resolvido; `MIGRATIONS_DATABASE_URL` no pooler IPv4; e-mail de recuperacao; "what would change my mind"; heatmap; backup diario; blog.
- **27/07:** auditoria de claims (dados fabricados e claims falsos removidos nos 6 idiomas, README reescrito); `/accuracy` no ar; plano unico ($12, $19, $29 nos mesmos price IDs); coluna `userVerdict`; `AI_MODEL_QUICK/DEEP` e `openai-params.ts`.
- **28/07:** telas vazias que ensinam; loop do veredito; regra de nao encher o repo (limpeza para `_local/`).
- **29/07:** checkout cobrava em BRL e o paywall vendia o plano `pro` → moeda unica USD fixada no servidor; politica de privacidade em ingles em `/privacy`.
- **29 e 30/07:** prompt v9 (melhor analista, abstencao de 90%, fica fora de producao); schema reordenado (reasoning antes do veredito); A/B por usuario criado e desligado; coluna `Analysis.model`; volume e mapa de eventos no grounding; guarda de print velho.
- **10/08:** auditoria de SEO; `useSeo`; pre-render do head; blog aprofundado; calculadoras; 84 strings mortas de i18n removidas; sitemap reenviado (o site estava indexado, so que pouco).
- **11/08:** assinatura de teste do dono cancelada (webhook de cancelamento provado); quick vai para `gpt-5.6-luna`.
- **17/08:** acesso manual do dono (`manual_owner_1`); e-mail NULL resolvido (o frontend nunca chamava `/api/auth/me`, commit `dfa80ac`); so ingles indexavel; `normalizeSymbol` (Ouro/Dolar → XAUUSD); 2a auditoria de claims na landing; auditoria de acesso (`GlobalAuthGuard`).
- **25/08:** calendario devolvendo vazio calado → `degraded` + aviso na tela; casca do `index.html` sem texto; regra do CSS `.site-*`.
- **26/08:** landings `/for/`; `noindex` real nas rotas de auth; link estatico para `/blog/`; claim de volume em forex corrigido.
- **31/08:** `model-cost.ts` e `reasoning_effort`; custo medido (luna medium ~$0,0275; `high` falha); `terra` recusado pelo custo; timeouts subidos dos dois lados; espelho do calendario; vitrine para de exigir tese previa; perfil de estrategia (pago).
- **01 e 02/09:** card de compartilhamento (Canvas, sem backend); link publico por analise recusado pelo dono.
- **03/09:** KPI "all time" era falso (contava as 40 carregadas) → `count()`; historico paginado por cursor.
- **08 e 09/09:** `[Metrics]` no worker; Render pago; `AI_MODEL_DEEP=luna` confirmado; `reasoning_effort=low` + tetos de caracteres: latencia 31,4 s → 18,5 s, custo -29%.
- **08 a 10/09:** primeiros 3 assinantes pagantes.
- **14/09:** GEO (corpo em HTML cru, JSON-LD no HTML cru, crawlers de IA no robots); incidente `a9ab59b` (backend sem compilar foi a producao, corrigido em `75784f1`).
- **15/09:** bundle de producao conferido; GA4 criado; Bing Webmaster; auditoria de promessas (f3d corrigido, "Timeframe alignment"); conversoes do Ads no codigo; cupom passou a valer na /pricing; `AcquisitionSurvey`; recusas eram fundos insuficientes; e-mail de falha da Stripe ligado; Resend confirmado funcionando.
- **16 e 21/09:** 10 commits da sessao Codex reaplicados e validados; limpeza de codigo morto (stream, `/performance`, pacotes avulsos, deps); pnpm fixado; incidente supabase-js x Node 20.
- **21/09:** checkout conferido na Stripe (nao estava quebrado); eventos `checkout_*`; login preserva a compra; webhooks no formato basil + idempotencia + teto de 200 ticks por janela ("Ticks never expire" saiu); tracking do PostHog auditado; Meta CAPI; `[funnel]`; -46% de JS inicial e cache immutable; e-mail de recuperacao ligado no worker; contato `support@`; oferta EARLY35 automatica e TICKS arquivado; PageSpeed (fonte fora do caminho critico, `llms.txt`); keep-warm removido e backup com retencao de 7 dias; numeros da home ao vivo; `width`/`height` nas imagens.
- **22/09:** `after_expiration.recovery` ligado e removido no mesmo dia (a Stripe nao manda e-mail; so gera link).
- **24/09:** prompt v7.5 contra o WAIT de 82% do luna; PostHog cookieless; My Trades com print, botoes TP/Stop e P&L; logo animada no carregamento; painel abre mais rapido (token do cache, preload); testes estaveis (`cleanup`); Watchlist virou filtro "Favoritas" + aba Diario (`/api/ai/journal`); WAIT nao e operacao; selo de estrategia corrigido no worker; Plans no rodape do menu; `og.png` novo.
- **28/09:** programa de afiliados (`modules/affiliates`, migracao `20260926120000_affiliates`, `/affiliates`, `/affiliate`, secao no `/admin`): entrada por aprovacao manual (PENDING -> ACTIVE/REJECTED, ACTIVE <-> SUSPENDED; so ACTIVE atribui, comissiona e saca), taxa padrao 20% por 12 meses que NUNCA aparece na pagina publica (so no painel do proprio afiliado e no admin), comissao por fatura relida na Stripe, PENDING 30 dias, saque manual a partir de US$ 50, refund/disputa cancela. No checkout vale UM desconto, o maior (EARLY35 ganha dos 10% enquanto existir, porque a vitrine promete os 35%).
- **28/09 (tarde):** plano semanal US$ 7,99 / 25 ticks (pricing, paywall, modal, contador); checkout sem endereco obrigatorio.
- **28/09 (seguranca):** TLS do runtime exige `verify-full`; demo bloqueia sem Turnstile/verificador/segredo de hash; rate limit usa `req.ip`; auth oculta erros internos; auditoria de dependencias bloqueia consulta inconclusiva. Gate validado na base atual: 473 testes backend, 128 frontend, builds e auditoria sem bloqueadores. CA Supabase conferida em preflight no Render; requisitos operacionais no runbook de deploy.
- **28/09 (resultado):** veredito `no_fill` ("Entry not reached") no painel, My Trades e Diario: fecha a cobranca, fica fora do win rate e do P&L; "Did not take it" continua so apagando a marcacao.
- **28/09 (upload Android):** imagem copiada para a memoria na escolha (painel e `/try`); se nem ai der para ler, a tela avisa e sai `upload_read_failed { surface, fileType, fileBytes, errorName }` no PostHog. Antes o erro virava `analysis_failed network_error` em ~70 ms.
- **25/09:** este arquivo reorganizado; aviso de "trade aberto" que nunca sumia corrigido (servidor vira a fonte da verdade do resultado; valor vazio nao vira mais 0).

---

## 8. Opcional: contexto antigo que nao se usa mais

Ler so se o assunto voltar. O detalhe esta em `_local/CLAUDE-historico-ate-2026-09-25.md`.

- **Prompt v9 e A/B (29 e 30/07):** `trading-system-prompt-v9.ts` existe, nao e
  importado, A/B em 0. Carrega o enquadramento abandonado ("confirms or kills the
  user's read") e nao recebeu os tetos de 09/09 nem as mudancas da v7.5. Corrigir
  ANTES de ligar o A/B. Com trafego baixo, o A/B levaria meses para ter amostra.
- **v7.4 (playbooks):** nunca subiu; backup em `tmp/v74-playbooks-backup/`.
- **Backtest:** `scripts/backtest/` (runner retomavel, `--prompt-file`,
  `BT_DEBUG_FIELDS`, `AI_DEBUG_DUMP_RAW`, `rodar-teste-v9.sh`). Resultados de julho
  (win rate 37 a 45%, calibracao que so apareceu no backtest). Util de novo so
  para medir prompt/modelo antes de subir.
- **Tabelas de custo do deep com `terra`/`sol` (17/08):** superadas pela escolha
  do luna. Receita por tick continua sendo a regua: $29 / 200 = $0,145.
- **Rollover de ticks:** discussao de 27/07 e 31/08 superada pelo teto de 200 por
  janela (21/09).
- **Pendencias antigas que ja se resolveram:** `CLERK_SECRET_KEY` (sempre esteve
  certa); `RESEND_API_KEY` (existe; a nota de 31/08 estava errada);
  `ENABLE_QUICK_GROUNDING` (true); assinaturas de teste em BRL (canceladas em
  11/08); Render pago (08/09); os 10 commits de 16/09 (subiram em 21/09);
  `/api/ai/analyze/stream` sem chamador (removido 21/09); `detectCurrency`
  (removido 21/09); card "16s" e badge "real time" (removidos 17/08).
- **Distribuicao de jun e jul** (Instagram de 53 para 82 seguidores, estrategia
  "The AI With Receipts", Post 0, kit de marketing): material em
  `_local/marketing-sprint/` e `_local/`. A thread antiga do X
  (`EXECUTAR_AGORA_X_REDDIT_YT.md`) e obsoleta (PT, cupom inexistente).
- **Arquivos de entrega antigos** (manual em PDF, copy do site, videos de demo):
  movidos para `_local/arquivo/` em 28/07.
- **Rename BUY/SELL/HOLD para BULLISH/BEARISH/NEUTRAL:** adiado com motivo, ver
  `apps/frontend/CLAUDE.md`.
- **Link publico por analise (`/s/:token`):** caminho mapeado (token + PNG no
  Supabase Storage + funcao no Vercel, nunca no Render), recusado pelo dono em
  02/09. Publicacao automatica no X: fora (OAuth, conta dev).
- **Google Ads de set/26** em Filipinas/Malasia/Africa do Sul com teto de R$ 3:
  quase sem leilao; licao: geo barata e cartao sem saldo sao o mesmo fenomeno.
- **Numeros de acuracia antigos** (37,9% em jul, 38,8% em set): hoje home e
  `/accuracy` leem a API; nao copiar numero para o codigo.
- Statement descriptor da Stripe (27/07): conferir se um dia importar.
- Traducao da `/accuracy` para outros idiomas: fora (so ingles e indexavel).
