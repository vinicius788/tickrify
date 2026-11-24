# Tickrify: CLAUDE.md

> **Enxugado em 23/11/2026** (era 212 KB, ~55 mil tokens lidos em toda sessao).
> A versao completa, com todo o detalhe de cada feature, cada pendencia antiga e o
> historico de jun a 23/11/2026, esta sem cortes em
> `_local/CLAUDE-historico-ate-2026-11-23.md` (gitignored) e no git. A anterior,
> de jun a 24/09, em `_local/CLAUDE-historico-ate-2026-09-25.md`.
> **So abra o arquivo historico quando o assunto pedir** (grep pelo termo, nunca
> ler inteiro).
>
> **Como manter este arquivo (curto de proposito):**
> - Ele e lido inteiro em TODA sessao. Cada linha custa limite do dono. Entra so
>   regra, estado atual e pendencia viva. Detalhe de implementacao mora no codigo
>   e no historico do git.
> - Feature nova: no maximo 5 linhas na secao 3 (o que e, onde mora, chave/estado).
> - Item fechado: sai da secao 6 no MESMO commit. Nao existe mais "historico
>   resumido" aqui: o git log e o historico.
> - Pendencia: uma linha, com data e o que falta. Medicoes longas vao para `_local/`.
> - Estado de ambiente (env var, painel, terceiro) so vale se foi LIDO no painel.
>   Este arquivo ja errou tres vezes (`CLERK_SECRET_KEY`, `ENABLE_QUICK_GROUNDING`,
>   `RESEND_API_KEY`).
> - Auditoria, relatorio ou plano de fora: cruze com as secoes 3, 5 e 6 ANTES de
>   abrir codigo (ja custou duas sessoes reconferindo trabalho pronto).

---

## 1. Regras de trabalho do Claude (ler antes de tudo)

### 1.1 Nao encher o repo de arquivo (permanente)

1. Arquivo novo no repo so se for **codigo que roda** (`.ts`, `.tsx`, `.sql`,
   config, migracao). Arquivo que nao e codigo: **nao crie, pergunte.**
2. Documento (plano, relatorio, analise, handoff) vai para `_local/` (gitignored)
   ou no chat. **Prompt para outro Claude vai SEMPRE no chat, nunca vira arquivo,
   nem em `_local/`.**
3. Nada de `RESUMO.md`, `HANDOFF.md`, `PLANO_X.md`, `NOTES.md`, README novo.
4. Arquivo de codigo novo precisa de justificativa (por que nao cabe num
   existente). Preferir editar a criar.
5. O `.gitignore` bloqueia `.md`/`.png`/`.csv`/`.xlsx`/`.pdf` na raiz, `_local/`
   e pastas de rascunho. Precisar desligar isso = fazendo a coisa errada.

`docs/` fica so com doc tecnica (ENV_VARIABLES, PROMPTS, runbooks).

### 1.2 Nao deixar codigo morto (permanente)

1. **Quem tira o uso, tira o codigo**, na MESMA mudanca: endpoint, service, hook,
   tipo, DTO, chave de i18n (6 idiomas), mock, dependencia, env documentada.
2. Nada de casca "para nao quebrar import"; codigo comentado, flag sem leitor,
   `console.log` de depuracao e helper duplicado nao entram. Log de operacao
   (`[funnel]`, `[Metrics]`, `[Cost]`, boot) fica.
3. **Antes de apagar, confirme**: busca no repo INTEIRO (frontend, backend,
   worker, scripts, `public/`, workflows, Dockerfile, imports dinamicos), quem
   chama de FORA (Stripe, crons, Actions), se dependencia e peer/runtime. Depois:
   typecheck, lint, testes e build dos DOIS lados.
4. Env var sem uso: listar para o dono remover no painel. Claude nao remove.
5. **Sem feature flag para o dono ligar** (decisao dele): decidir, medir, soltar
   para todos. Chave de /admin so para coisa que pode precisar de pausa de
   emergencia (e-mails, por exemplo).

### 1.3 Portoes e limites do ambiente

- **Portao: `pnpm check` na raiz** (frontend `tsc -b --force` + `vitest run
  --environment jsdom` + build). Backend: `pnpm test` (jest) e `tsc --noEmit` em
  `apps/backend`. **O build do Render NAO checa tipo** (14/09: backend que nao
  compilava ficou ~3h no ar).
- Gancho `pre-push` (`.githooks/pre-push`) roda tudo isso; liga com
  `git config core.hooksPath .githooks`. `--no-verify` so com motivo (Actions do
  repo privado: 2.000 min/mes).
- **Extensao (`extension/`, npm proprio, fora do pnpm):** `npm run typecheck`,
  `npm test`, `npm run build`. Nunca `pnpm install` la dentro; nunca `wxt build`.
- O dono nao roda build local: codigo certo na primeira. Typecheck do frontend
  antes de entregar, sempre.
- **VM do Claude:** funcionam `./node_modules/.bin/tsc`, `eslint`,
  `vitest run --environment jsdom` (nunca `vitest` cru). NAO funcionam
  `vite build`, `prisma generate`, `npx`. A pasta montada nao deixa apagar.
- Erro de tipo de coluna nova = Prisma Client velho; o dono roda
  `npx prisma generate` em `apps/backend`.
- Validar `prerender.mjs`/`geo-body.mjs` sem `vite build`: copiar `scripts/`,
  `src/lib/seo-routes.json` e um `index.html` para pasta temporaria e rodar
  `node scripts/prerender.mjs` duas vezes (nao pode contaminar).
- **Mexeu em dependencia ou infra:** imagem Docker de `git archive HEAD` +
  Postgres/Redis descartaveis, `RUN_MIGRATIONS_ON_START=true`, env falsas para
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`. Conferir
  `engines.node` contra `node:20-alpine` (supabase-js fixado em 2.100.1).

### 1.4 Git na maquina do dono

- O dono roda `git add/commit/push`. Comando de terminal em UMA linha, marcado.
- O sandbox nao apaga arquivo: comando git que toca o index deixa
  `.git/index.lock`. Usar `git --no-optional-locks status --porcelain` e avisar
  (`rm -f ~/dev/tickrify/.git/index.lock`).
- Nunca `git add -A` sem olhar o que vai junto.
- Push rejeitado sem motivo = `calendar-mirror.yml` commitou:
  `git pull --rebase --autostash origin main && git push`.
- Commits pequenos e reversiveis. Nunca segredo em doc, commit ou log.

### 1.5 Producao, paineis e dados

- Escrever no banco de producao esta fora do alcance do Claude: entregar SQL
  pronto (id preenchido + comando de desfazer) para o SQL Editor do Supabase.
- Nada que altera producao, cobranca, ou e publico/irreversivel sem o dono
  confirmar na hora (salvar env no Render redeploya; opcoes da Stripe de mao unica).
- **Ler bundle em producao:** WebFetch le so ~185 KB. Usar
  `curl -s "https://tickrify.com/assets/$(curl -s https://tickrify.com | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)" | grep -c "<string>"`
  com uma string de controle. Botao "sumido" costuma ser cache (`Cmd+Shift+R`).
- Formulario React que resiste a automacao: setter nativo do `HTMLInputElement`
  + eventos `input`/`change` com `bubbles: true`.
- Responsividade: iframe de largura fixa (`resize_window` nao muda `innerWidth`).
- PageSpeed mobile varia ~17 pontos: rodar 3 na interface `pagespeed.web.dev`.
- Rotulo de painel: extrair do DOM, nunca do screenshot.

---

## 2. O produto

- **Tickrify:** SaaS freemium de analise de grafico com IA. Sobe o print, recebe
  Enter now / Watch / No trade com plano (entrada, stop, alvos) quando ha.
  "A second opinion, not signals." Copiloto: a decisao e do trader. North Star =
  assinantes pagos / MRR. Global, em ingles.
- **Plano unico:** US$ 29/mes, US$ 290/ano ou US$ 7,99/semana. Saldo volta a 200
  ticks por mes (25 por semana no semanal), nao acumula. Quick = 1 tick, deep = 3.
  Na UI se fala em "analyses". Price sempre o de USD; EUR/GBP/JPY/CAD/AUD pelas
  `currency_options` do mesmo price (3.3). Adaptive Pricing NAO converte (conta BR).
- **Gratis:** trial de 3 dias sem cartao (`TRIAL_MODE` LIGADO desde 14/10): 3/2/2
  analises, ate 7 dias. Bonus de opiniao: +3 analises, uma vez.
- **Cupons:** EARLY35 saiu do site e do checkout em 23/11 (ninguem assinou com ele
  desde out). Desconto so do afiliado (link, vinculo ou codigo dele) ou FOUNDER15
  (Founding Member, US$ 15 travado, pronto, nada enviado).
- **Assinantes:** poucos (3 em set/26, 1 semanal em 05/10). Conta do dono =
  `manual_owner_1` no banco: **toda contagem filtra
  `WHERE "stripeId" NOT LIKE 'manual_%'`.**
- **Aquisicao:** organico via ChatGPT (tombou em 24/10). Anuncios de set/26 deram
  0 assinantes. O que converte e USO: `/try` -> analise -> limite -> paywall.
- **Contas:** Bing Webmaster e Google Ads (489-869-2148) em `tickrify@gmail.com`;
  Search Console na conta pessoal; suporte `support@tickrify.com` (Zoho).

---

## 3. Estado atual (o que esta no ar)

Detalhe completo de cada item: `_local/CLAUDE-historico-ate-2026-11-23.md`.

### 3.1 Stack e infra

- **Frontend:** Vite + React 19 + Clerk + React Router 7 + TanStack Query, Vercel
  (`tickrify-frontend`). Monorepo pnpm (pnpm 10.12.4 no Dockerfile).
- **Backend:** NestJS + Prisma no Render (`srv-d6o0b5nafjfc73ap4270`, plano pago,
  nao hiberna, 2 instancias). Supabase (us-west-2, plano gratis, schema `tickrify`
  nao exposto na API; "auto expose" DESLIGADO desde 23/11). Redis (BullMQ).
- **Worker embutido** no mesmo conteiner (`infra/docker-entrypoint.sh`,
  `RUN_EMBEDDED_WORKER` padrao true). Nunca rodar sweeper/monitor em outro lugar
  sem desligar o embutido.
- **Migracoes:** `RUN_MIGRATIONS_ON_START=false`. Coluna nova = migracao Prisma
  **e** `ADD COLUMN IF NOT EXISTS` no `onModuleInit`. Indice/constraint/rename =
  SQL manual entregue ao dono. Varias tabelas novas existem so por SQL, FORA do
  `schema.prisma` (UserTrial, TradeState, SetupAlert, AnalysisTrack, MarketCandle,
  UserTelegram, UserWatchAsset, UserFeedback etc.). Campo novo no `schema.prisma`
  so DEPOIS da coluna existir em producao.
- **i18n:** `apps/frontend/src/lib/i18n/{pt,en,es,fr,de,ja}.ts`, tipo vem do
  `pt.ts`. So o ingles e indexavel.
- **E-mail:** Resend (`noreply@`, gratis = 100/dia para TUDO). Todo envio loga
  `[mail] Enviado kind=...`. Recusa tira a marca (tenta de novo). Ciclo de vida em
  `modules/mail/lifecycle-email.ts` (max 1 por pessoa em 20h, descadastro por HMAC).
  Chaves lidas em 12/11: ligadas `EMAIL_ACTIVATION_NUDGE`, `EMAIL_CHECKOUT_RECOVERY`,
  `EMAIL_CHECKOUT_WINBACK`, `EMAIL_SECOND_ANALYSIS_NUDGE`, `EMAIL_SETUP_ALERTS`,
  `EMAIL_TRIAL_SEQUENCE`, `EMAIL_PAYMENT_FAILED`, `CHAT_EMAIL_NOTIFY`,
  `TELEGRAM_SETUP_ALERTS`; desligada `EMAIL_CANCELLATION_CONFIRM`.
- **Actions:** CI, `calendar-mirror.yml` (6h), `backup.yml` (diario), `indexnow.yml`.

### 3.2 Motor de IA

- **Motor pelas velas + tres leitores (23/11, PR #66) com regras
  `filter-2026-11-23` (PR #69, `result.engine.rules`).** `ENGINE_VERSION` mora so
  em `modules/ai/engine-contract.ts` (segue 4.0.0; o marcador do motor novo e
  `result.engine.vote`).
  - Vies pelas velas em `common/utils/entry-engine.ts` (`BIAS_RULES`,
    `isStrongBias`), decisao em `decideFromCandles` (`signal-decision.ts`).
  - **Escada de tempos** (`timeframeLadder`): 1m->15m, 5m->1h, 15m/30m->4h,
    1h->1d, 4h->1w.
  - **Leitores:** 2x `AI_MODEL_QUICK` (gpt-5.6-luna, esforco low) + 1x Haiku 5.5
    (`ANTHROPIC_API_KEY`). Maioria antecipada; o 3o tem 6 s. Voto em `resolveVote`:
    sem maioria so vies FORTE desempata, senao No trade (`no_majority`).
    ENTER_NOW so com 2 leitores na mesma direcao ou 1 + vies forte. Codigo nunca
    promove para ENTER_NOW. Filtro de tendencia (`against_trend`). Plano anterior
    do setup so prende com maioria ou vies forte (`priorBinding`).
  - IA preenche `read` (direcao + veto com motivo). Entrada pelo plano da IA se o
    validador aceita; senao `chooseEntry` (agora / recuo / rompimento; stop no
    swing a 1 ATR+, risco 0,5 a 2 ATR, TP1 a 1R+, teto 1,5R). Rompimento = WATCH
    `breakout_close`. Grava `candleBias`, `entryPlan`, `codeSummary` (resumo
    montado pelo codigo), `engine.readers`, `engine.vote`.
  - Anthropic: sem os 4 campos de pixel (`ANTHROPIC_UNUSED_ANALYSIS_FIELDS`);
    recusa = 1 tentativa com schema em texto.
  - Sem velas: caminho antigo (`dataMode: print`, niveis do modelo).
  - Custo ~US$ 0,0077/analise; p50 ~15 s, p90 ~19 s. **Limite do dono: nao passar
    muito de 20 s.**
- **Velas reais (REAL DATA):** armazem `modules/market/candle-store.ts`
  (`MarketCandle`). Cripto Binance -> data-api.binance.vision -> OKX (aceita
  sufixo de corretora); forex/metal Twelve Data; B3 brapi. **Indices, acoes,
  petroleo e futuros NAO tem fonte** (sem grounding, sem alerta).
- **Twelve Data = cota compartilhada** (`modules/market/twelve-data.ts`, unico
  caminho): gratis 800/dia e 8/min, licenca "internal non-display". Medidor no
  Redis por prioridade (analise 550, monitor 200, resto sweeper). Toda URL pede
  `timezone=UTC` (bug de fuso corrigido em 09/11 14:09:48 UTC). Scripts de
  medicao so com `TWELVE_DATA_API_KEY_EXPERIMENTS`, nunca a chave de producao.
- **Leitura do ativo:** `extractSymbol` com modelo do quick, detalhe alto, teto
  20 s; etapa de dados inteira 25 s. Motivo de "sem velas" sempre gravado em
  `groundingStats`. Dica de ativo do usuario (`applyAssetHint`) so preenche o que
  a imagem nao mostrou.
- **Guardas:** news guard (evento High -15/+45 min = WATCH), print velho
  (`detectStaleChart`, mostra "Historical chart").
- **Perfis de risco** (Conservador/Equilibrado/Arriscado) fixos: validador roda 3x
  na mesma resposta (`PROFILE_GATES` em `plan-engine.ts`); a pessoa ve o dela.
- **Medicao:** rastreador `worker/analysis-tracker.ts` (`AnalysisTrack` e
  `AnalysisProfileTrack`, a cada 30 min) e fonte do motor atual; sweeper
  (48h, velas de 30m, regra `stop_only` desde 20/10) so do motor antigo. Revisao
  mensal: `replay-variants.ts --review` (ENTER_NOW n >= 30: R >= -0,05 mantem,
  R <= -0,15 desliga). Corte de ouro/forex: so depois de 09/11 14:09:48 UTC.
- **Confianca fora da tela desde 30/09** (descalibrada ~30 pontos). Nao voltar sem
  calibracao medida. R/R principal = TP1.
- **`/accuracy` com tres registros** (`current` = com `engine.vote`, `v11` =
  03/11 a 23/11, `previous` = sweeper), nunca somados; derivado so com n >=
  `MIN_N_TO_PUBLISH`. So a AccuracyPage e o prerender leem a rota.
- **Provedor:** toda chamada a modelo passa por `vision-model.ts` (`AI_PROVIDER`,
  contingencia automatica com as duas chaves).
- **Timeouts acoplados:** backend `AI_ANALYZE_TIMEOUT_MS=120000`; frontend
  `ANALYZE_TIMEOUT_MS` 150 s, `POLL_TIMEOUT_MS` 300 s. Nunca mexer em um sem o outro.

### 3.3 Pagamentos (Stripe)

- **Moeda fixa `usd` no servidor** (fronteira de seguranca, nao reverter). Moeda
  local so pelas `currency_options` do price de USD (cadastradas 17/11 via
  `prices.update` no Shell do Render; o painel nao edita). Site escolhe pelo fuso
  (`detectChargeCurrency`); servidor so usa se o price tiver a opcao.
- **Webhook na API `2025-07-30.basil`:** assinatura da fatura em
  `parent.subscription_details` (`invoiceSubscriptionRef`). Campo novo do payload:
  conferir no formato basil.
- **Idempotencia:** `StripeWebhookEvent` por `event.id`; estado sempre RELIDO na
  Stripe; credito com chave `allowance:<assinatura>:<inicio da janela>`.
  **NAO reenviar `invoice.payment_succeeded` antigos pelo painel.**
- Checkout: cartao, Apple Pay, Google Pay, Link; `billing_address_collection: auto`.
  Recusas sao quase todas falta de saldo. Abandono e o buraco, nao bug.
- Portal criado por API (`ensurePortalConfiguration`, cancelar no fim do periodo,
  sem troca de plano). Ex-assinante = modo leitura.
- Afiliados (`modules/affiliates`): pedido com codigo escolhido (cupom e `?ref=`),
  aviso ao support@ (teto 10/h); aprovar no /admin so libera se a Stripe criar o
  promotion code no cupom de `STRIPE_AFFILIATE_COUPON_ID`; boas-vindas 1x
  (`affiliate_welcome_sent`) no idioma do perfil. 20% por 12 meses, saque manual.
- Pacotes avulsos removidos; se voltarem, separar saldo comprado do reset mensal.

### 3.4 Analytics

- **PostHog:** backend e fonte da verdade (distinctId = id do Clerk). Cookieless
  sem aceite (depende do "Enable cookieless tracking" ligado no painel; sem pais,
  usar `$timezone`). Testar pela rede ou chave `ph_*`, nunca `window.posthog`.
- Funil: `signup_completed`, `free_analysis_started/completed` (com `symbol` e
  `timeframe` canonicos), `free_quota_exhausted`, `checkout_*`,
  `subscription_created`, `payment_succeeded/failed`, `trial_*`. Ativacao: somar
  `analysis_started` OU `free_analysis_started` (o do servidor so existe desde 21/09).
- Filtro de usuarios internos por e-mail ligado; 4 alertas de trafego por e-mail.
- Consultar: `POST /api/projects/473872/query/` (HogQL) logado em us.posthog.com.
- Meta Pixel, GA4 (`G-SME6X097T6`), Google Ads (`AW-18439434622`) so com aceite.
- **Sentry:** descarta erro so do tradutor (`isTranslatorOnlyError`).
- Paginas estaticas medidas por `public/static-analytics.js` (pagina nova precisa
  da tag).

### 3.5 Painel e funcionalidades no ar (resumo)

- **Rotas por URL** (`parseDashboardPath` em `DashboardPage.tsx`): `/dashboard`,
  `/new`, `/analysis/:id`, `/trades`, `/journal`, `/watching`, `/strategy`,
  `/plans`, `/settings`, `/setups/:id`. `noindex`, fora do sitemap.
- **Gratis esgotado** (`isFreeLocked`): servidor responde 402 em historico,
  diario, resultado, alertas, setups. Paywall unico `Paywall.tsx` (6 idiomas).
- **Setups e alertas:** seguir (`TrackedSetup`), atualizar = analise nova com
  `setupId`. Todo WATCH com velas vira alerta sozinho (`createWatchAlert`) e
  expira com a validade. Monitor por minuto (cripto 1m, forex/metal 5m pela cota).
  Envio por e-mail `setup_alert` e Telegram (`@TickrifyAlertsBot`, Telegram
  primeiro). Tetos em `ALERT_RULES`.
- **Watching** (`/dashboard/watching`): WATCH e item pendente, nunca operacao;
  My Trades e Diario mostram so operacoes. "I entered" registra entrada num WATCH
  (`Analysis.watchEntry`).
- **My assets** (`watch-assets.ts`): niveis do dia sem IA, alerta nos niveis
  (sem setup). Quiz de conta nova (`OnboardingQuiz.tsx`).
- **Prints extras da nova analise** (`NewAnalysis.tsx`, 24/11, so assinante): espacos fixos por papel (direcao, setup), guia recolhivel `upload_guide_opened`, `analysis_started.extra_charts`.
- **Estado da operacao** (`TradeState`) e modo gerenciamento (chamada separada).
- **Chat com o fundador** (`modules/support`, feito em casa, polling).
- **Trial** em `common/trial.ts`; anti-abuso (e-mail descartavel, 3 por IP/24h,
  teto US$ 10/dia); e-mail repetido (normalizado) nao ganha trial nem cota gratis
  (`isRepeatEmailAccount`, coluna gerada `User.emailNormalized`, 23/11).
- **Configuracoes** com assinatura e portal; tema claro so na area logada (tokens
  em `styles/trading-tokens.css`).
- **/admin** (PR #67): Inicio, Inspetor de analise, Usuario, Motor, Origem,
  Opinioes, Chat, Cancelamentos. Chaves em "Configuracoes avancadas".
- **Extensao** (`extension/`): PAUSADA pelo dono, so no Chrome dele, nao publicada.
  Regras do teste e2e no historico.

---

## 4. Regras tecnicas que nasceram de bug real (nao desfazer)

### 4.1 Motor e OpenAI

- **Ordem do `json_schema` = ordem de geracao** (reasoning antes do veredito; ha
  teste que le o fonte).
- **GPT-5 rejeita `temperature`, `top_p`, `max_tokens`, `seed`:** tudo por
  `buildSamplingParams` (`openai-params.ts`). `reasoning_effort` `high` estoura o
  timeout. Teto de saida abaixo de ~16k tokens trunca o veredito.
- `model-cost.ts`: `reasoning_tokens` ja esta dentro de `completion_tokens`.
  `⚠️ CUSTO ACIMA DA RECEITA` no log e incidente.
- **Motor so muda com medicao.** Nunca trocar modelo e prompt no mesmo teste.
- **Dois caminhos de producao:** FILA (`worker/ai.worker.ts`, o real) e sincrono
  do `ai.service`. Parametro novo alimenta os dois e o teste confere o que e GRAVADO.
- Calendario degradado nunca vira "sem eventos"; se degradar, reiniciar o servico
  antes de investigar.
- **Par de forex/metal so por `canonicalFxPair`** (aceita sufixo de corretora).
- Noticia em tempo real nao existe (so calendario agendado).

### 4.2 Backend

- `GlobalAuthGuard`: rota sem decorator nasce FECHADA; publica so com `@Public()`
  (`route-access.spec.ts`). `role` vem do banco.
- **DTO:** decorator do class-validator em TODO campo + teste contra o
  `ValidationPipe` real (`whitelist` + `forbidNonWhitelisted`).
- **Query publica:** `isDemo: false` E `strategyHash: null`.
- Perfil de estrategia so com campos fechados (texto livre no prompt = injecao).
- Cursor validado contra o usuario, `orderBy` com `id` de desempate.
- **Env var ausente some calada:** flags que a vitrine vende aparecem no boot e
  no `/health` (ops token).
- Antes de suspeitar de ambiente, confirmar que o codigo chega a ser EXECUTADO.
- **Trava do gratis vale no servidor** (402); rota nova de operacao passa pelo
  `isFreeLocked`.
- **Checagem de operacao e demo reservam ANTES da IA** (`TradeCheck`, `DemoUsage`).
  Linhas `ops.trade_checks.v1` e `ops.demo.v1` na `FeatureFlag` NUNCA podem sair
  (sem elas, 503). Pausar so pelos scripts em `apps/backend/scripts/`. Reserva
  presa volta sozinha em 30 min.
- Estado em memoria vale so na instancia (Render roda 2). Deploy mata trabalho
  longo em memoria.

### 4.3 Frontend

- **Texto que muda no React nunca e no de texto solto ao lado de condicional**
  (Google Translate derruba com `removeChild`). Cada estado num `<span>` com
  `key`. Teste `translate-safety.test.tsx`. Area logada leva `translate="no"`.
- Navegacao do painel e por URL, nunca `useState`.
- Casca do `index.html`: nada de texto dentro do `#root`.
- **CSS do site publico:** `.site-*`/`.tk-site` ganham do Tailwind. `hidden` num
  `.site-btn` nao esconde (envolver num `<span>`); `tk-site` em portal (Sheet)
  quebra o `fixed`.
- Campo de digitar nunca abaixo de 16px; `maximum-scale` proibido.
- **Resultado do trade: SERVIDOR e a fonte da verdade.** Nada de veredito no
  localStorage. Valor vazio e NULL, nunca 0.
- `useAPIClient`: 1a tentativa com token do cache; `skipCache` so depois de 401.
- Teste que monta componente: `cleanup()` no `afterEach`.
- `prerender.mjs`/`geo-body.mjs`: fonte unica; `String.replace` sempre com FUNCAO.
- Paginas estaticas em `public/` tem `<head>` proprio e visual em
  `public/site.css` (mudou CSS: subir `?v=` nas 22 paginas). `og.png` em `?v=4`.
- Meta `msvalidate.01` do Bing: nao remover.
- **Celular:** ilha de navegacao embaixo (`MobileNav.tsx`); area nova no Mais =
  linha em `MORE_ITEMS`. Elemento fixo no rodape fica acima da ilha.
- **Tipografia da area logada: so Geist.** Sem serifa, mono, italico, uppercase.
  Classes `tk-display`, `tk-eyebrow`, `tk-meta`, `tabular-nums`.
- Cor nova na area logada = token, nunca `bg-white/[..]`, `text-zinc-*` ou hex.
- Hover `group-*` do Tailwind nao e gerado (override `postcss-selector-parser`
  6.1.3); usar CSS proprio.

### 4.4 Claims e texto publico

- Toda afirmacao da vitrine verdadeira e verificavel no codigo: abrir o motor
  ANTES de escrever a frase.
- Sem dado real, a secao nao aparece. Nunca inventar numero, avaliacao,
  depoimento, `aggregateRating`. Numero de desempenho so na /accuracy, da API.
- Texto publico em ingles. **Sem travessao. Sem emoji na interface.**
- Leitores: o texto publico diz "more than one independent AI read", nunca
  "tres", ate a `ANTHROPIC_API_KEY` estar confirmada no Render.
- **Nome do dono:** Vinícius. Proibido so o apelido "Vini".
- String com numero ou afirmacao muda nos 6 idiomas no MESMO commit.
- "Second opinion" fica de proposito (falso positivo de auditoria).
- Cards de compartilhar: um renderer so (`lib/share-card.ts`); leitura sem preco
  de entrada/stop/alvo; trade sem moeda; valor nunca vai ao PostHog.
- `LAST_UPDATED` e `dateModified` so com mudanca real. `&amp;` nas UTMs e falta
  de `hreflang` estao corretos.

---

## 5. SEO / GEO

**Resolvido, nao reabrir sem evidencia nova:** meta/canonical por rota
(`useSeo` + `seo-routes.json`), pre-render do head e do corpo em `<noscript>`,
JSON-LD no HTML cru, sitemap com `lastmod`, `/accuracy` no formato que LLM cita,
blog (6 posts), 3 calculadoras, landings `/for/` (sem acoes de proposito),
`noindex` em `/sign-in`/`/sign-up`, `robots.txt` com crawlers de IA, `llms.txt`,
`Organization`, Bing verificado.

**IndexNow:** `scripts/indexnow.mjs` + workflow apos cada deploy da Vercel.
**Pagina publica que mudou = `<lastmod>` novo no `public/sitemap.xml` no MESMO
commit.** ChatGPT = indice proprio + Bing/Google; Claude = Brave; Gemini = Google.

Licoes: `Disallow` nao impede indexar (usar `noindex`); URL sem link interno e
despriorizada; Inspecao de URL: 10 por dia.

---

## 6. Pendencias abertas

Uma linha cada. Detalhe e SQL antigos no arquivo historico (grep pela data).

### 6.1 Com data marcada

- **01/12/2026:** refazer `site:tickrify.com` no Brave e no Bing, "AI
  Performance" do Bing (zero citacoes desde 26/10) e as 10 perguntas no ChatGPT,
  Claude e Gemini.
- **03/12/2026: revisao mensal do motor** (`replay-variants.ts --review --since
  2026-11-03`; ouro/forex so depois de 09/11 14:09:48 UTC; metais/forex antes de
  03/11 17:28:26 UTC receberam o bloco EUR/USD invertido). Junto: se 3+ WATCH com
  velas tiverem `watchLevels` nulo, testar offline "WATCH sem geometria = No trade".
- **Regras filter-2026-11-23:** com 30 trades fechados sob essas regras, R por
  trade <= -0,15R = voltar as regras do #66. Vigiar estabilidade (caiu de 80% para
  60% no replay) e % de No trade (alerta acima de 40%) na aba Motor.

### 6.2 Abertas

| Desde | Item | Quem |
|---|---|---|
| 23/11 | Stripe: desativar cupom EARLY35 e promotion codes EARLY35 e EARLY50 (saiu do site). | dono |
| 23/11 | **Twelve Data:** licenca gratis nao permite mostrar preco a cliente. Recomendado Venture US$ 149/mes. Antes de pagar, perguntar ao suporte (so formulario de vendas, sem e-mail publico): display externo, XAU/XAG, WebSocket, indices e petroleo, historico de 1m. Indices/petroleo/futuros dependem dessa resposta. | dono |
| 23/11 | `ANTHROPIC_API_KEY` no Render confirmada? Sem ela, 2 leitores. Renomear "Strong read" para algo como "2 reads agreed". /admin: conferir no celular e tema claro. | dono / Claude |
| 17/11 | Checkout de teste por moeda local (sem pagar). Trocar telefone de suporte da Stripe (+55 31 98672 0240 nao e do dono) quando ele mandar. | dono |
| 17/11 | Search Console: pedir /about e /affiliates (/pricing "rastreada, nao indexada"). So 2 backlinks no Bing. | dono / Claude |
| 11/11 | Medir em 14 dias: "I entered", quiz de conta nova (meta retorno dia 2 de 21% para 35%), alerta do My assets, bonus de opiniao. Ver um disparo real chegar pelo Telegram com link do ativo. | Claude |
| 10/11 | /privacy: linha sobre o id do chat do Telegram (texto a aprovar). | dono |
| 09/11 | Branches sem decisao (patches em `_local/arquivo-2026-11-09/`): `claude/funnel-paywall-webhook-ip`, `claude/watch-pending-level-map`, `codex/tracker-confirmation`, `codex/watch-next-steps`, `claude/chart-sketch`, `claude/feedback-why-drawing`, `claude/result-glance-drawing`, `claude/blissful-heisenberg-dwasmg`. | dono |
| 04/11 | Textos publicos antigos ainda com BUY/SELL/WAIT em parte do blog e `og:image:alt`; tabela "48 hours later" da home le o sweeper (decidir se rotula o motor). | dono / Claude |
| 03/11 | Supabase Storage: apagar `_local/storage-recompress/backup` no fim de novembro se nenhuma imagem der problema; ate fim de dezembro decidir Supabase Pro x gravar prints menores. | dono |
| 27/10 | Founding Member (FOUNDER15): codigo pronto, nada enviado; onda 1 so com OK do dono. | dono |
| 13/10 | Antes de ligar Anthropic como provedor principal: atualizar /privacy. Cancelamento: aprovar texto "How to cancel" e e-mail de cancelamento. | dono |
| 08/10 | Experimento de teste mais longo: so ideia; "3 dias por US$ 1" RECUSADO pelo dono (nao propor de novo). | dono |
| 05/10 | Decidir `allow_promotion_codes` no anual/semanal (codigo digitado pode valer). | dono |
| 28/09 | Afiliados: criar cupom 10% `once` e por em `STRIPE_AFFILIATE_COUPON_ID`; marcar `charge.refunded` e `charge.dispute.created` no webhook. | dono |
| 21/09 | Env vars sem leitor no Render (dono decide): `ALLOW_UNAUTHENTICATED`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `FREE_ANALYSIS_LIMIT_PER_MONTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_MONTHLY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `VITE_GOOGLE_ADS_ID`; e se existirem `AB_PROMPT_V9_PERCENT`, `PROMPT_AUTO_SYNC`, `ENABLE_QUICK_GROUNDING`, `ENABLE_RR_GUARD`. | dono |
| 21/09 | Menores: CLS 0 a 0,128 no mobile; 416 KB de JS nao usado na home; saldo antigo no 1o render do reset mensal; preflight CORS desconhecido da 500; comentario errado no `schema.prisma` sobre a imagem. | Claude |
| 15/09 | Link do e-mail de falha da Stripe aponta para a home (trocar e irreversivel). | dono |
| 26/08 | Blog: imagens reais de analise (dono manda print); autor pessoa no schema `Article`. | dono |
