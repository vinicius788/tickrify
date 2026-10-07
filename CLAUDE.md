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
- **Extensao (`extension/`, fora do workspace do pnpm, npm proprio):** dentro
  da pasta, `npm run typecheck`, `npm test` e `npm run build` (gera
  `.output/chrome-mv3`). Nunca `pnpm install` la dentro: o pnpm sobe para o
  lockfile da raiz, que o Docker do Render e o CI usam. Nao usar `wxt build`
  direto (termina o build mas o processo nao sai); o `npm run build` chama a API.
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
- **Cupons:** EARLY35 (35% no 1o mes) pre-aplicado no paywall e na /pricing,
  **so no MENSAL** (05/10: regra no servidor, `billingCycle !== 'monthly'`
  descarta; antes o anual saia a US$ 188,50). O estado e lido da Stripe
  (`founding-offer.ts`) e a oferta some sozinha quando o cupom acaba (5 de 50
  usos em 21/09; tentativa recusada tambem gasta uso). Em 05/10 o
  `/api/stripe/offer` respondia `active: true, percentOff: 35`. O DTO so aceita
  EARLY35. Codigo EARLY50 segue ativo por decisao do dono. TICKS (100%
  vitalicio) arquivado. Sem desconto pre-aplicado (anual, semanal sem
  afiliado), a sessao abre com `allow_promotion_codes`: um codigo DIGITADO
  ali vale conforme a configuracao dele na Stripe (ver 6.2).
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
  de 20 e-mails/hora). Todo envio aceito deixa `[mail] Enviado kind=<tipo>
  id=<id Resend>` no Render (desde 29/09; antes so a falha logava).
- **E-mails de ciclo de vida (29/09, DESLIGADOS ate o dono aprovar o texto):**
  `modules/mail/lifecycle-email.ts`, varredura no worker a cada 15 min.
  `activation_1` (1h a 6h apos cadastro sem analise), `activation_2` (20h a 48h),
  `checkout_recovery` (1h a 24h apos `funnel:checkout_session_created` sem
  assinatura; texto de recusa se houver `funnel:payment_failed`). Chaves no
  /admin: `EMAIL_ACTIVATION_NUDGE` e `EMAIL_CHECKOUT_RECOVERY`. Desligadas, o
  worker so loga `[lifecycle] dry-run kind=... user=...`. Uma vez por pessoa
  (AdminAudit `lifecycle:<tipo>`), nunca para assinante nem para quem saiu
  (`email_unsubscribed`, rota publica `/api/email/unsubscribe` com HMAC do id;
  segredo `EMAIL_UNSUBSCRIBE_SECRET` ou, na falta, `CLERK_SECRET_KEY`). Remetente
  `LIFECYCLE_MAIL_FROM` (padrao `Vinicius from Tickrify <vinicius@tickrify.com>`; nao existe no Render, lido em 06/10),
  resposta em `LIFECYCLE_MAIL_REPLY_TO`; links de descadastro em `PUBLIC_API_URL`
  ou `RENDER_EXTERNAL_URL`.
- **GitHub Actions:** CI, `calendar-mirror.yml` (a cada 6h), `backup.yml` (diario,
  retencao 7 dias). O `keep-warm` foi removido em 21/09 (o Render pago nao
  hiberna). Ver pendencia de 21/09 sobre Actions parado.
- O frontend tem um historico proprio em `apps/frontend/CLAUDE.md` (31/08).

### 3.2 Motor de IA

- **Modelo:** `gpt-5.6-luna` no quick e no deep (`AI_MODEL_QUICK`,
  `AI_MODEL_DEEP`). `AI_REASONING_EFFORT_QUICK=low` (09/09); `_DEEP` nao setada
  (padrao da OpenAI). Sem env, o `resolveModel` cai no `gpt-5.6-luna` (05/10;
  antes caia no `gpt-4o`/`gpt-4o-mini`). A pagina de desativacoes da OpenAI
  (lida em 05/10) so desliga o snapshot `gpt-4o-2024-05-13` em 23/10/2026; o
  alias `gpt-4o` e o `gpt-4o-mini` nao estao na lista. O `extractSymbol` do
  grounding chama `gpt-4o-mini` fixo no codigo.
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
  score de confianca NAO mostrou poder preditivo em producao (27/07; 30/09: 39,6% na
  faixa 60-69 x 39,7% na 70+, n=116, confianca media 69,6 contra 40% de acerto).
- **Confianca fora da tela desde 30/09.** O prompt pede `confidence` como chance de
  bater o TP1 (deve bater com `probabilityTp1`), entao ela E probabilidade, e
  descalibrada em ~30 pontos. Saiu do resultado, card de compartilhamento, painel,
  My Trades, /try, paywall e home, junto com o selo Signal/Read e o bloco
  "Probabilities". O motor continua gravando; a /accuracy continua mostrando a
  tabela por faixa. Nao voltar a exibir sem calibracao medida.
- **R/R principal = TP1 (30/09)** no painel e no /try (era o TP2). E o alvo que a
  /accuracy mede; o TP2 fica na linha de baixo.
- **Expectancy medida (30/09, 127 trades WIN/LOSS):** R medio ate o TP1 1,23,
  expectancy -0,105R antes de custos, 25% chegam ao TP2. Por faixa de R do TP1:
  abaixo de 1,2R n=72, 43,1%, -0,195R; 1,2 a 1,5R n=15, 26,7%, -0,374R; 1,5R ou
  mais n=40, 40%, +0,159R (Wilson do acerto 26% a 55%: ainda nao prova edge).
  O R/R guard atual (rebaixa so se nem o MELHOR alvo passa de 1,2) deixa passar
  57% dos trades com TP1 abaixo de 1,2R. Decisao pendente na secao 6.
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
  Translate e do ResizeObserver filtrado no cliente; erro com a pagina traduzida
  e NENHUMA linha do bundle (`/assets/`) e descartado (`isTranslatorOnlyError`,
  06/10: RangeError dentro do tradutor do Chrome do iPhone); WebView do Instagram so
  marcado (`tags.webview`), nao descartado.
- Pergunta de atribuicao no painel (`AcquisitionSurvey`): a primeira resposta
  vale, dispensar nao grava nada.
- **Medir ativacao com o navegador E o servidor.** `free_analysis_started/completed`
  so existem desde 21/09: contar so eles deu "metade dos cadastros nunca analisa"
  quando o real era 83% (80 de 96, 29/09). Usar `analysis_started` OU
  `free_analysis_started`, ou recortar o periodo a partir de 21/09.
- **Paginas estaticas (blog/tools/for) medidas desde 29/09** por
  `public/static-analytics.js` (sem biblioteca, cookieless, `$lib=tickrify-static`):
  `$pageview`, `static_cta_clicked { href }`, `static_video_played { video }`.
  Pagina estatica nova precisa da tag `<script src="/static-analytics.js" defer>`.
- Eventos de 29/09: `wait_nudge_viewed/clicked`, `upgrade_video_played/completed
  { surface }`, `demo_analysis_failed { code, chart }`; checkout com
  `source=upgrade_modal`. De 30/09: `sample_analysis_opened { sample }` e
  `sample_cta_clicked { viewed, surface }` (exemplos fixos do painel, 3.5).

### 3.5 Analises de exemplo do painel (30/09)

- Quem esta no plano gratis e ainda nao concluiu nenhuma analise ve, em "Nova
  analise", 3 exemplos fixos (otimista BUY, pessimista SELL, neutro WAIT) acima
  do envio do grafico. Abre um por vez, no MESMO `AnalysisResult` (prop
  `sample`: sem calendario/contexto ao vivo, sem compartilhar, sem id no relato
  de problema), com "o que aconteceu depois" e o CTA "Agora e sua vez".
- Dados em `lib/sample-analyses.ts`: saida REAL do motor (coluna `result` de
  analises da conta `manual_owner_1`), print do Supabase Storage e resultado
  medido pelo sweeper + candles publicos. Nada chama a API: nao toca na cota (ha
  teste). Trocar um exemplo = trocar a analise inteira por outra real.
- Substituiu o "Try it with an example chart" (que rodava a IA via
  `POST /api/demo/example`): rota, DTO, metodo do service, caminho logado do
  `/try` e evento `example_cta_clicked` removidos. O `/try` anonimo nao mudou.
- Junto dos exemplos (05/10): bloco "How Tickrify works" (envia o print, a IA
  le, recebe plano ou WAIT; segunda opiniao, nao sinais) e, se a pessoa fez a
  demo do `/try` neste aparelho, a leitura dela (`saveDemoResult` em
  `lib/demo-api.ts`, localStorage, 7 dias). Os dois somem depois da 1a analise.

### 3.6 Rotas do painel, gratis esgotado e paywall (05/10)

- **Rotas reais:** `/dashboard` (inicio), `/dashboard/new`,
  `/dashboard/new/example/:kind`, `/dashboard/analysis/:id`,
  `/dashboard/trades`, `/dashboard/journal`, `/dashboard/strategy`,
  `/dashboard/plans`. O mapa mora em `parseDashboardPath` (`DashboardPage.tsx`);
  `/demo/*` usa o mesmo. Item ativo do menu sai da URL; endereco desconhecido
  volta para `/dashboard`. So a nova analise tem estado sem URL (carregando,
  erro, paywall). Rotas do painel nao entram no `seo-routes.json` e levam
  `noindex` pelo `useSeo`. O `$pageview` por subrota substituiu o
  `feature_opened` (removido). `/dashboard/plans` conta `pricing_viewed
  { surface: 'dashboard' }`.
- **Planos dentro do painel:** os mesmos `PricingCards` da /pricing. A volta do
  login com intencao de compra (`checkoutReturnPath`) e o `cancel_url` da
  Stripe vao para `/dashboard/plans`; a /pricing segue aceita na volta do login
  (links antigos) e os cards tratam `?canceled=true` nos dois lugares.
- **Gratis esgotado** = `settledExhausted` de `free-quota.ts` (o mesmo estado
  do `free_quota_exhausted`), sem assinatura e sem `role=admin`
  (`AiService.isFreeLocked`). O servidor responde 402 `free_quota_exhausted` em
  diario, `outcome` e `favorite`; o historico devolve so as
  `FREE_READABLE_ANALYSES` (3) ultimas concluidas, sem cursor, e
  `analysis/:id` abre so elas (o polling de analise em andamento nunca trava).
  O `/usage` manda `freeLocked`. Antes de esgotar nada trava. Quem assina volta
  a ver tudo na hora (o retorno da Stripe invalida todas as queries).
- **Paywall unico:** `components/dashboard/Paywall.tsx` (era `LockedAnalysis`,
  so em ingles), 6 idiomas (`t.paywall`), `surface` em `new_analysis | trades
  | journal | history`. Eventos: `upgrade_cta_viewed { source: 'paywall',
  surface }`, `upgrade_cta_clicked { destination: 'plans' }`, `upgrade_clicked`
  e `checkout_started` com `surface` (Stripe recebe `source=locked_value`). O
  `upgrade_modal_viewed { trigger: 'locked_value' }` saiu: era o paywall.
- **Quadrinho de opiniao** (`FeedbackCard.tsx`): "What do you think of
  Tickrify so far?" na tela inicial do painel, so para quem ja fez 1 analise e
  nunca junto da pergunta de origem. Grava em `ProblemReport` com
  `kind='feedback'` (coluna nova: migracao `20261005120000_problem_report_kind`
  e `ADD COLUMN IF NOT EXISTS` no boot do `ReportsService`), SEM e-mail. Lido
  na aba "Opinioes" do /admin. Dispensar esconde 30 dias; enviar, 60. Eventos
  `feedback_sent { length }` e `feedback_dismissed` (o texto nunca vai ao PostHog).
- **Traducao automatica:** area logada (tudo sob `ProtectedRoute`, e no boot
  pelo `isLoggedAreaPath`) marca `<html translate="no" class="notranslate">`;
  a vitrine segue traduzivel. O `removeChild` do Google Translate derrubava o
  painel (reproduzido em teste: arrastar o grafico com a pagina traduzida) e
  era DESCARTADO pelo `beforeSend` do Sentry; agora chega com `page_translated`
  e `route`. Cada area do painel tem ErrorBoundary proprio (tentar de novo sem
  recarregar).

### 3.7 Extensao de navegador (06/10, fase 1: prova no Chrome, NAO publicada)

- Codigo em `extension/` (WXT 0.21.4, MV3, React no Shadow DOM, Clerk
  `@clerk/chrome-extension` 3.1.91). Desenho, plano, demos e passo a passo do
  dono em `_local/extensao/`.
- **Disparo so por gesto do trader:** icone da barra, Alt+Shift+T ou menu do
  botao direito (`activeTab`). Clique em botao injetado na pagina NAO libera
  `captureVisibleTab` (doc do Chrome): a bolha so mostra/reabre. Nenhuma host
  permission de plataforma; o painel e injetado por `scripting` depois do
  clique. Funciona em qualquer site: TradingView acha o grafico sozinho
  (`.layout__area--center`), nos outros o trader marca a area uma vez por site.
- **Login:** sessao do site via `syncHost = https://clerk.tickrify.com` (em
  producao o cookie `__client` mora no dominio do Frontend API, nao no
  tickrify.com). Exige `cookies` + host permission do clerk.tickrify.com.
- **Id de desenvolvimento fixo:** `fjmlahaidjmkfiogbmklmnhcaadkmfck` (chave
  publica no `wxt.config.ts`, privada em `_local/extensao/chave/`). A loja da
  outro id: CORS e Clerk vao precisar dos dois.
- **Backend (opcional, retrocompativel):** `CreateAnalysisDto` aceita `source`
  (`web|extension`), `platform` (`tradingview|other`), `chartSymbol`,
  `chartTimeframe`. Gravados em `Analysis.clientContext` (JSONB, criada no boot
  com flag propria e migracao `20261006120000`, FORA do `schema.prisma`, gravada
  por SQL). O motor NAO le. `free_analysis_started` e `paid_analysis_started`
  levam `source`. CORS: so a origem exata entra (`CORS_ORIGINS`).
- **Linhas no grafico = conta, nao estimativa.** O `entryY/stopY/tp1Y/tp2Y` do
  motor errou ate ~82 px num grafico real e NAO e usado. A extensao pede
  `GET /api/ai/analysis/:id/price-axis` (so analise da propria conta, da
  extensao, BUY/SELL; 1 leitura de IA por analise, guardada em
  `clientContext.priceAxis`; sem tick; `price-axis.ts`): a IA le o preco do
  topo e da base do recorte pelo eixo e a extensao calcula a altura de cada
  nivel. Medido em 4 graficos reais x 2 rodadas: pior erro 7,5 px (30 px sem a
  frase da faixa de datas). Sem escala valida, sem linhas (so os precos).
  Chamada SEPARADA: prompt do motor, schema e `promptVer` intocados. Medicao em
  `_local/extensao/medicao-eixo/`. Somem quando o grafico mexe.
- **Regras que nasceram do teste automatizado (06/10, nao desfazer):** (1)
  escala do recorte = largura da captura / largura da janela, nunca o
  `devicePixelRatio` (com 1x numa tela "2x" o recorte pegava a barra lateral);
  (2) o service worker manda `tk:ping` antes de injetar: reinjetar faz o WXT
  desmontar o painel e o icone parava de funcionar na pagina; (3) esconder o
  painel antes do print pelo container DENTRO do Shadow DOM (o
  `:host { all: initial !important }` do WXT ganha do estilo do host e o
  painel saia no print); (4) dois cliques durante uma analise nao cobram duas
  vezes (`busyTabs`); (5) respostas por `sendResponse` + `return true`.
- **Suite de ponta a ponta (custo zero):** `_local/extensao/e2e/suite.mjs`
  (Puppeteer + Chrome for Testing, `triggerExtensionAction` libera o
  `activeTab` como o clique real) contra a API falsa
  `_local/extensao/fake-api/server.mjs` (porta 8787, salva cada recorte). Build
  de teste: `WXT_API_URL=http://localhost:8787 WXT_TEST_TOKEN=test npm run build`
  copiado para `_local/extensao/teste-chrome`, e depois `npm run build` normal
  de novo. 30/30 em 06/10 (TradingView real, Binance real, zoom 125%, erros,
  cota, ultima analise). Rodar de novo antes de qualquer subida da extensao.
- **Camada 3 (06/10, backend real local com banco/Redis descartaveis no Docker,
  worker da fila, IA de verdade, Clerk de TESTE; `_local/extensao/camada3/` e
  `e2e/suite3.mjs`): 8/8.** Site sem campos novos igual (clientContext NULL);
  analise pela extensao grava `clientContext`, aparece no historico e o "Open in
  Tickrify" aponta a analise certa; WAIT nao gasta; cota esgotou no 3o
  BUY/SELL; proximo clique = planos sem linha nova; chamada direta ao servidor
  = 403 `DEMO_LIMIT_REACHED`. CORS real: so a origem oficial passa. 5 analises,
  ~US$ 0,10.
- **Linhas no grafico ERRADAS na medicao real (06/10):** EURJPY 1D, stop 182,3
  desenhado em ~183,7; entrada 181,1 em ~181,8; TP1 177,0 em ~178,2 (erro de
  0,6 a 1,4 no preco, ate ~80 px). O `entryY/stopY/tp1Y/tp2Y` do motor nao serve
  para desenhar. Decisao do dono pendente (secao 6).
- **Painel enxuto (aprovado pelo dono em 06/10, `_local/extensao/demo-painel-enxuto.html`):**
  cabecalho so com ↻ (analisar de novo) e minimizar; fechar fica no x da bolha;
  resultado = veredito, 4 precos, R/R do TP1, um "Details" (por que, riscos,
  invalidacao, R/R do TP2) e UM botao, "Open in Tickrify". Linhas sempre
  ligadas (sem interruptor). Menu do botao direito "Show my last Tickrify
  analysis" reabre o ultimo resultado da aba (storage.session, sobrevive a
  recarregar a pagina) sem analise nova e sem linhas.
- **Clerk de producao: "Native API" LIGADO e obrigatorio** (Configure > Native
  applications). Desligado, a extensao funciona sem sessao (pede login) e
  falha COM sessao (o sync manda o `__client` como requisicao nativa). Ligado
  pelo dono em 07/10, junto do `allowed_origins` (PATCH na Backend API) e do
  `CORS_ORIGINS` + `CLERK_AUTHORIZED_PARTIES` no Render com a origem da extensao.
  1a analise real pela extensao em 07/10 (EURJPY 5m SELL, linhas no lugar, 1 tick).
- **Painel no idioma do navegador** (`lib/i18n.ts`: pt e en; o resto cai no
  ingles) e `translate="no"` no painel (o tradutor do Chrome traduzia o painel).
  **Cores = tokens do painel do site** (`#050508`, cartoes 3% branco, botao
  principal branco, verde/vermelho/amarelo so para sinal, rotulos em mono).
  Erro mostra `Detalhe:` com o codigo tecnico (e loga `[Tickrify]` no console do
  service worker). Mensagem para o painel tenta por ~10 s (pagina pesada
  recem-carregada perdia o clique). Suite e2e oscila com a maquina carregada
  (load > 10): rodar de novo antes de concluir que quebrou.
- **Card de novidade** (`ExtensionAnnouncement.tsx`) na tela inicial do painel:
  so aparece com `EXTENSION_STORE_URL` preenchida (vazia ate a loja aprovar) e
  em Chrome/Edge de computador. Eventos `extension_card_viewed/clicked/dismissed`.

---

## 4. Regras tecnicas que nasceram de bug real (nao desfazer)

### 4.0 Regras de 05/10/2026

- **Texto que muda no React nunca e no de texto solto ao lado de condicional**
  (`{cond ? 'a' : <>{x}, <em/></>}`, `{v ? 'x' : ''}` entre irmaos): com a
  pagina traduzida, o React tenta remover um no que o tradutor trocou e cai em
  `removeChild`. Cada estado vira um `<span>` com `key`, ou um texto so
  (template string). Teste: `translate-safety.test.tsx` (simula o tradutor).
- **EARLY35 so no mensal, decidido no servidor.** A vitrine so mostra o 35%
  onde o servidor aplica; preco riscado ou "35% off" nunca ao lado do anual.
- **Navegacao do painel e por URL.** Nada de `useState` para trocar de area;
  link interno do painel aponta para `/dashboard/*`, nunca para a /pricing ou a
  landing (exceto logo e sair).
- **Trava do gratis vale no servidor.** Tela que trava sem 402 no servidor nao
  e trava. Rota nova de operacao (historico, resultado, diario) passa pelo
  `isFreeLocked`.

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
  Duas armadilhas reais (05/10/2026): `hidden`/`sm:inline-flex` direto num
  `.site-btn` nao esconde nada (envolver num `<span>`); e `tk-site` em painel de
  portal (Sheet/Dialog) troca o `fixed` por `relative` e joga o painel no fim da
  pagina, o menu do celular "nao abria" (pôr `tk-site` so no miolo).
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
- `og.png`: ao trocar a arte, subir o `?v=` (hoje `?v=3`, 54 referencias). Arte de 05/10/2026: "Your AI trading copilot.", cartao de exemplo SEM confianca, "3 free trade plans"; fonte HTML em `_local/semana-2026-10-05/og-novo.html` (gerar com Chrome headless em 1200x630).
- Meta `msvalidate.01` do Bing no `index.html`: nao remover (o Bing revalida).

### 4.4 Claims e texto publico

- Toda afirmacao da vitrine tem que ser verdadeira e verificavel no codigo. Abrir
  o arquivo do motor ANTES de escrever a frase, nao depois.
- Sem dado real, a secao nao aparece. Nunca inventar numero, avaliacao,
  depoimento ou `aggregateRating`. Numero publico so com metodologia e
  disclaimer; de preferencia vindo da API, nunca fixo no codigo.
- Texto publico em ingles. Sem travessao. Sem emoji na interface.
- **Nome do dono:** tudo que sai em nome dele (e-mail, assinatura, remetente, rascunho) usa **Vinícius**. O UNICO proibido e o apelido "Vini" (so para os intimos). Founder/Fundador e CEO valem os dois (dono, 06/10/2026, confirmado duas vezes). Os 200 e-mails da campanha de 05/10 sairam assinados "Vini, Founder".
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
| 06/10 | **Extensao: ligar o teste do dono.** Depois do deploy do backend (os campos novos do DTO precisam estar no ar, senao a extensao toma 400): (1) Render: `CORS_ORIGINS` += `chrome-extension://fjmlahaidjmkfiogbmklmnhcaadkmfck`; ler se `CLERK_AUTHORIZED_PARTIES` existe e, se existir, acrescentar a mesma origem; (2) Clerk: `allowed_origins` da instancia com a mesma origem (PATCH na Backend API, mantendo as que ja existirem); (3) carregar `extension/.output/chrome-mv3` em modo desenvolvedor. Passo a passo em `_local/extensao/como-testar.md`. Conferir no Render que a 1a analise grava `clientContext` e sai `source=extension` no PostHog. | dono / Claude |
| 06/10 | **Linhas: medir em mais graficos antes de divulgar.** A leitura do eixo foi medida em 4 graficos do TradingView (tema claro, 1D). Falta: tema escuro, intraday, corretoras (area marcada pode nao ter o eixo: a IA tem que devolver null) e o `[Cost] price-axis` real no Render. Se alguma passar de ~15 px, desligar as linhas (a extensao ja fica so com precos quando nao ha escala). | Claude |
| 06/10 | **Extensao, fase 2:** medir a posicao das linhas (`entryY` etc.) contra o grafico real e o simbolo lido da pagina contra o `extractSymbol`; visual final com o dono; texto da /privacy (envia so o recorte, so no clique); ficha da Chrome Web Store (US$ 5, conta do dono); depois de aprovada, preencher `EXTENSION_STORE_URL` (liga o card) e trocar a chave/id pelos da loja no CORS e no Clerk. Fase 3: Firefox (sync do Clerk so e documentado para Chrome) e Safari (US$ 99/ano + Xcode, decisao do dono). | Claude / dono |
| 05/10 | **Campanha de reativacao: medir em 13/10** quem voltou a analisar e quem assinou entre os 200 (AdminAudit `campaign:reactivation_2026_10` x analises/assinaturas depois de 06/10 00:42 UTC) e as respostas em `vinicius@tickrify.com`. Reenviar os 5 recusados depois de rodar o SQL que tira a marca deles (entregue no chat em 05/10). Decidir o plano da Resend: gratis = 100/dia; Pro (US$ 20/mes) tira o limite diario. | Claude / dono |
| 05/10 | **Ligar no /admin** a chave `EMAIL_CHECKOUT_WINBACK` (reativacao de checkout, texto aprovado pelo dono em 05/10; `EMAIL_SECOND_ANALYSIS_NUDGE` ja foi ligada por ele). Depois conferir no Render `[lifecycle] kind=checkout_winback ... sent=1` e `kind=second_analysis ... sent=1`. | dono |
| 05/10 | **Decidir `allow_promotion_codes` no anual/semanal.** Sem desconto pre-aplicado a Stripe abre o campo de codigo: quem DIGITAR EARLY35 (ou EARLY50) no anual pode receber o desconto, conforme a configuracao do codigo na Stripe. Fechar o campo nesses ciclos tambem fecha o codigo de afiliado digitado. | dono decide, Claude implementa |
| 05/10 | PostHog: dashboards que usam `feature_opened` passam a usar `$pageview` com `$pathname` (`/dashboard/trades`, `/journal`, `/strategy`); os que usam `upgrade_modal_viewed trigger=locked_value` passam a `upgrade_cta_viewed source=paywall` (por `surface`). Novo: `acquisition_source_answered` e a propriedade de pessoa `acquisition_source`. | dono / Claude |
| 05/10 | Medir 7 dias depois do deploy: 402 `free_quota_exhausted` por rota, `upgrade_cta_viewed` por `surface`, `checkout_started` com `surface`, erros `removeChild` no Sentry com `page_translated=yes` (devem sumir do painel). | Claude |
| 05/10 | Limpeza local: 7 conteineres Docker parados `supabase_*_tickrify-staging-20261001` e 2 volumes; branch `welcome-email` sem commit; `stash@{0}` (seguranca, 28/09) e `stash@{1}` (My Trades, 24/09) esperando decisao. | dono |
| 05/10 | **R/R guard: decidido (dono delegou em 05/10).** NAO mudar agora. Motivo: os numeros de 30/09 misturam prompts (v10/v11 davam 80% WAIT; o v7.5, `promptVer` 12, da 35%) e a unica faixa positiva (TP1 >= 1,5R, n=40) tem intervalo de 26% a 55%, que ainda inclui expectancy negativa; travar em 1,2R viraria WAIT ~57% dos planos e voltaria ao WAIT de ~70%, o que derrubou a ativacao em setembro. Regra: em **19/10** (ou quando o `promptVer` 12 tiver 60 trades WIN/LOSS) rodar a expectancy por faixa de R do TP1 so no 12; se abaixo de 1,2R continuar negativa com n >= 30, mudar o guard para "TP1 >= 1,2R" e medir WAIT% e ativacao por 7 dias. SQL: `select case when (result->>'riskRewardTp1')::numeric < 1.2 then '<1.2' when (result->>'riskRewardTp1')::numeric < 1.5 then '1.2-1.5' else '>=1.5' end faixa, count(*) n, round(100.0*avg((outcome='WIN')::int)) win from tickrify."Analysis" where "promptVer"=12 and outcome in ('WIN','LOSS') group by 1;` | Claude (em 19/10) |
| 30/09 | Medir a tabela "48 hours later" da home (`/api/ai/public-analyses/scored`): cliques para `/accuracy` e `/try` a partir de `#reads`. Hash diario publico das analises (repo publico ou OpenTimestamps) ainda nao feito. | Claude |
| 29/09 | Primeiros envios dos e-mails de ciclo de vida: conferir no Render (`[lifecycle] kind=... sent=1`) e na Resend que sairam e se alguem respondeu em `vinicius@tickrify.com`. | Claude |
| 29/09 | Teto de 10 analises gratis: MANTIDO de proposito. A barra do WAIT (29/09) empurra a pessoa a tentar outro grafico ate achar um BUY/SELL; baixar o teto agora cortaria justamente isso e mandaria ao paywall quem nunca viu um plano de trade. Reavaliar com os 7 dias de `wait_nudge_clicked`: se a 2a analise subir e mesmo assim poucos esgotarem, testar 6. | Claude |
| 29/09 | Medir 7 dias depois do deploy: `wait_nudge_clicked / wait_nudge_viewed`, 2a analise de quem tomou WAIT na 1a (era ~50%), `upgrade_video_played`, `checkout_started source=upgrade_modal`, `$pageview` com `$lib=tickrify-static` por `$pathname`. | Claude |
| 28/09 | **Afiliados: configuracao manual na Stripe antes de divulgar.** (1) Criar cupom 10%, `duration: once`, e pôr o id em `STRIPE_AFFILIATE_COUPON_ID` no Render (sem ele: sem desconto para indicado e sem promotion code; a comissao funciona igual). (2) Marcar `charge.refunded` e `charge.dispute.created` no endpoint do webhook. (3) Afiliados que entraram ANTES do (1) ficam "sem promotion code" no admin: salvar o perfil deles de novo cria o codigo. Conferir no boot log `[affiliate] Tabelas prontas. Cupom da Stripe: configurado`. | dono |
| 05/10 | Acompanhar o acerto do `promptVer` 12 (v7.5) contra o 10/11 quando houver amostra: `select "promptVer", count(*) filter (where outcome='WIN') win, count(*) filter (where outcome='LOSS') loss from tickrify."Analysis" where outcome in ('WIN','LOSS') group by 1 order by 1;`. O WAIT% caiu para o limite de baixo do alvo; se o acerto do 12 cair, a alavanca e a decisao do R/R guard (30/09), nao o prompt. | dono roda, Claude le |
| 24/09 | Comentario do `schema.prisma` diz que a imagem "nao e mais salva": errado, a print e salva no Supabase Storage. Corrigir na proxima mudanca de schema. Evento candidato no funil: `trade_result_logged`. | Claude |
| 21/09 | **GitHub Actions parado** ("recent account payments have failed or your spending limit needs to be increased"): conferir se CI, `calendar-mirror` e `backup` voltaram a rodar. Ultimo backup valido: 16/09. Apagar os artifacts antigos (703 MB) para liberar a cota. | dono |
| 21/09 | **CLS oscilou de 0 a 0,128** no PageSpeed mobile. Suspeito nº1: troca de fonte depois do `media="print"`. Se passar de 0,1 em varios runs: self-host das fontes ou fallback com `size-adjust`, sem desfazer o `media="print"`. | Claude |
| 21/09 | Performance: 416 KB de JS nao usado na home; i18n dos 6 idiomas no bundle principal; `DashboardPage` (1.200+ linhas) sem memoizacao estudada; contraste; erros de console; 8 de 43 alvos de toque abaixo de 32px; pesos da Geist nunca auditados. | Claude |
| 21/09 | Reset mensal: a primeira tela do painel mostrou o saldo antigo (corrida entre `/ticks/balance` e `/usage`). Nao corrigido. | Claude |
| 21/09 | Abertos nao criticos: preflight CORS de origem desconhecida responde 500 em vez de negar; drift cosmetico entre migracoes e schema. | Claude |
| 21/09 | Env vars no Render sem leitor no codigo (dono decide remover): `ALLOW_UNAUTHENTICATED`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `FREE_ANALYSIS_LIMIT_PER_MONTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_MONTHLY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `VITE_GOOGLE_ADS_ID`. | dono |
| 21/09 | Trocar o e-mail de suporte para `support@tickrify.com` nos dados publicos da Stripe (recibo e checkout) e no Clerk. | dono |
| 21/09 | Checkout: 15 a 29/09, 12 pessoas abriram, 11 nunca enviaram cartao, 1 recusa (`do_not_honor`). E-mail de checkout abandonado feito e DESLIGADO (29/09, ver 3.1). Sessoes duplicadas no mesmo segundo sugerem `handleUpgrade` rodando 2x apos o login. | Claude / dono |
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
- **29/09 (PostHog assinante):** `subscription_created` so marca `is_subscriber: true` quando a assinatura nasce `active`/`trialing`; cartao recusado nasce `incomplete` e nao marca (quem paga depois e marcado pelo `payment_succeeded`). Os 3 assinantes reais foram marcados a mao no PostHog.
- **29/09 (rastreio do pagante):** todo evento do navegador leva `plan`, `billing_cycle` e `is_subscriber` (super propriedade vinda do /usage, que agora devolve `billingCycle`). Backend emite `paid_analysis_started { analysisType, ticksCost, ticksLeft, plan, billingCycle }` (e grava `plan`, `billing_cycle`, `ticks_left`, `last_paid_analysis_at` no perfil), `trade_outcome_set` e `strategy_saved` (`common/analytics/user-activity.ts`). Navegador: `feature_opened { feature }` para My Trades/Journal/Strategy; `analysis_completed` passou a mandar par e timeframe de verdade. Painel "Assinantes" no PostHog (dashboard 2149207) le tudo isso.
- **29/09 (demos em video):** `/blog/how-tickrify-works/` com os 5 filmes (01 conceito, 02 fluxo, 03 WAIT, 04 multi-timeframe, 05 celular, com versao vertical no mobile), comprimidos para ~1 MB cada, carregam so ao entrar na tela. VideoObject + FAQPage em JSON-LD; entrou no indice do blog, sitemap e llms.txt. CTAs com `utm_campaign=demo_videos`.
- **29/09 (conversao):** varredura do funil (ativacao real 83%, nao 48%: evento do servidor so desde 21/09; 53 de 80 tomaram WAIT na 1a analise; 11 de 12 checkouts sem cartao; Google Pay desligado). Barra no topo do resultado WAIT para o gratis ("nao gastou, restam N", outro grafico, video do WAIT). Paywall com texto honesto (dizia "Your read is ready" sem analise nenhuma), preco do 1o mes, semanal em botao e filme 04; janela de upgrade com checkout direto mensal/semanal e filme 04 (`source=upgrade_modal`). Exemplo em um clique para quem nunca analisou (`POST /api/demo/example`, autenticado, hash do grafico, 1 vez por conta, fora da cota/historico/accuracy; o /try roda sozinho com `?example=1`). E-mails de ciclo de vida desligados + descadastro. PostHog nas 22 paginas estaticas. `demo_analysis_failed`. Log de sucesso de todo e-mail. Emoji do resultado removido.
- **29/09 (ligado pelo dono):** texto dos 4 e-mails de ciclo de vida aprovado e chaves `EMAIL_ACTIVATION_NUDGE` e `EMAIL_CHECKOUT_RECOVERY` LIGADAS no /admin (antes: 1 dry-run por volta, o leopeter com recusa). Google Pay ligado na Stripe (config Default; lido no painel depois). Resend lido no painel: 369 e-mails em 15 dias, 99,19% entregues, 0,81% bounce, 0 reclamacao; uma automacao vazia e desligada da Resend sem uso.
- **29/09 (recuperacao):** texto novo do e-mail "cota gratis esgotada" aprovado pelo dono: assunto "Your free Tickrify analyses are used up", semanal primeiro, mensal com o EARLY35 so se ativo, sem presumir uso.
- **30/09:** 3 analises de exemplo fixas no painel antes das gratis (otimista, pessimista, neutra, com o depois), sem IA e sem cota (ver 3.5); o exemplo em um clique (`/api/demo/example`) saiu.
- **30/09 (confianca e recibos):** confianca, Signal/Read e "Probabilities" fora de todas as telas (card mostra a hora da leitura em UTC); R/R principal pelo TP1; rota publica `/api/ai/public-analyses/scored` e tabela "What the market did 48 hours later" na home (WIN, LOSS, NO_FILL, TIMEOUT, ordem do sweeper); semanal na secao de preco da home; textos falsos corrigidos nos 6 idiomas e no corpo pre-renderizado ("one-off Ticks", "See live analysis", "API sleeps", FAQ "professional traders", "3 free analyses" virou "3 free trade plans, WAIT doesn't count"); blog, `llms.txt` e /pricing sem "confidence score/tier". `confidenceToPercent` e `getConvictionTier` removidos.
- **05/10 (WAIT% medido, SQL do dono):** luna, por `promptVer` e posicao da analise do usuario. v10 e v11 (antes de 24/09): 76% a 93% de WAIT. v12 (v7.5): 38% na 1a analise gratis (n=82), 35% na 2a (n=52), 33% na 3a (n=33), 33% da 4a em diante no gratis (n=30) e 32% no pago (n=57). Dentro do alvo 35-55% so na 1a e 2a, logo abaixo nas outras, longe do alarme de 25%. Gratis e pago iguais: o motor nao trata o gratis diferente. Prompt nao muda sem medir o acerto.
- **05/10 (CI):** CI verde pela 1a vez desde 29/09. O jest nao saia (timer do ciclo de vida no `ai.worker.ts` sem `unref`) e cada CI rodava ate o limite de 6h; o gitleaks acusava a chave PUBLICA de projeto do PostHog (`phc_`) no `static-analytics.js`, liberada por formato no `.gitleaks.toml`. Smoke test agendado apontava para `tickrify.vercel.app` (nao existe mais), trocado por `tickrify.com`.
- **05/10 (Stripe lida no painel, conta live `acct_1RBGT0B1hl0IoocU`):** EARLY35 5 de 50 usos, valido, sem validade, 35% uma vez, sem restricao de produto; codigo promocional digitavel `EARLY35` com 4 resgates (vale no anual se digitado). Novo assinante SEMANAL em 05/10 01:56 (US$ 7,99, pago). Pagamentos tentados desde 08/09: 5 pagos, 5 recusados (4 saldo insuficiente, 1 `do_not_honor`). Nos 14 dias, das 13 pessoas que abriram o checkout so 3 digitaram cartao: o buraco e desistir na tela da Stripe, nao a recusa. O Chrome do dono abre por padrao num sandbox de teste da Stripe (`acct_1RgwA6...`, "Eburnean Seesaw"); a conta real e a `acct_1RBGT0B1hl0IoocU`.
- **05/10 (/try, teste ponta a ponta):** PostHog mostrou 16 `network_error` em 126 demos em 14 dias (30% dos envios de grafico PROPRIO, quase tudo celular). Causas: o /try mandava a foto inteira (o painel ja reduzia) e a conexao de ~20 s cai quando a pessoa troca de app; o servidor concluia, gastava a cota e ela via "you already used" sem nunca ver a leitura. Agora: `shrinkChartImage` em `lib/chart-image.ts` (painel e /try), `DemoUsage.result` (JSONB, `ADD COLUMN IF NOT EXISTS` no boot) guarda a leitura sanitizada e a devolve por 24h no `/api/demo/analyze` (sem IA nova, depois do Turnstile) e no `/api/demo/status`; o /try mostra a leitura recuperada (`demo_result_recovered`) e avisa "Keep this page open". O navegador automatizado e barrado pelo Turnstile (esperado; nao contornar).
- **05/10 (og.png):** imagem de compartilhamento trocada (aprovada pelo dono): "Your AI trading copilot.", sem confianca, "3 free trade plans"; `?v=3` nas 54 referencias.
- **05/10 (cupom e bolha):** campo de codigo da Stripe (`allow_promotion_codes`) so no MENSAL: EARLY35 digitado nao vale no anual nem no semanal (o codigo promocional da Stripe vale para qualquer produto). Desconto de afiliado pelo servidor segue igual. "2 months free" do anual virou "pay 10 months, get 12" (era a conta de US$ 290 x 348, lida como teste gratis; nao existe trial). Pergunta de origem tambem abaixo do resultado da analise. Botao flutuante virou "Feedback or problem" com duas abas: problema (padrao, igual antes, e-mail ao suporte) e opiniao (`kind=feedback`). Sentry lido em 05/10: nenhum `removeChild` e nenhum erro novo depois dos deploys.
- **05/10 (celular):** menu dos tres riscos nao abria (painel com `tk-site` ia para o fim da pagina); "Log in" escondido no celular (quem tinha conta caia no cadastro); faixa de 768 a 940px sem menu nenhum; cabecalho com o mesmo texto da home levando ao cadastro. Agora: Log in sempre visivel, menu com analise gratis, links e login, botao do cabecalho e da home levam ao /try, e a home tem UM botao (saiu "See how a read looks"). Botoes nao dependem mais do Clerk carregar.
- **05/10 (rastreio ponta a ponta confirmado):** caminho de uma pessoa no PostHog por e-mail: `select distinct person_id from events where person.properties.email = '<email>'` e depois os eventos por `person_id` (HogQL pela API, ver linha do funil). Exemplo real (1o assinante semanal): /try em 03/10 -> cadastro pela demo -> 2 analises (WAIT com a barra) -> volta em 05/10 -> esgota o gratis -> e-mail de recuperacao (Resend) -> volta 4h depois -> paywall -> checkout semanal -> pago em 2 min -> 4 analises pagas no mesmo dia. `checkout_completed` (servidor) aparece com a hora de CRIACAO da sessao (de proposito), por isso antes do `checkout_started` do navegador. Lacunas: visita anonima sem aceite de cookie em dias diferentes nao se liga; dentro da pagina da Stripe so vemos inicio, pagamento, recusa e cancelamento; abertura/clique de e-mail nao vai ao PostHog.
- **05/10 (admin):** aba **Origem** no /admin (`acquisition-report.ts`, `GET /api/admin/acquisition?dias=7|30|90|0`): cadastros, analisaram, assinaram e conversao por canal DECLARADO (pergunta do painel) e por PRIMEIRO TOQUE tecnico (utm/dominio), mais as ultimas 50 respostas; sem acesso manual e sem admin. SQL testado num Postgres descartavel. Interruptores de "Configuracoes avancadas" consertados (a bolinha saia do trilho: faltava `left-0`). E-mail `checkout_winback` (3 a 30 dias depois do checkout aberto sem assinar, uma vez, semanal + dica do banco, sem inventar erro nosso), chave `EMAIL_CHECKOUT_WINBACK` DESLIGADA. `EMAIL_SECOND_ANALYSIS_NUDGE` ligada pelo dono em 05/10.
- **05/10 (checkout):** texto acima do botao de pagar na Stripe (`custom_text.submit`): "Cancel anytime from your Tickrify dashboard. Your analyses are available right after payment." Bug achado junto: o cartao do plano com "Manage subscription" (portal da Stripe) so aparecia para o GRATIS desde junho; o assinante nao tinha onde cancelar pelo painel, embora a /pricing prometesse. Agora aparece na barra lateral para todos e, no celular, no inicio e nos Planos. Stripe lida: cartao, Apple Pay, Google Pay e Link ligados; Pix e Boleto desligados (so Brasil); Adaptive Pricing LIGADO. Os checkouts do Brasil nos 14 dias eram o dono testando.
- **05/10 (funil, acao):** paywall, janela de planos e CTA da ultima gratis passam a liderar com o SEMANAL (US$ 7,99), mensal logo abaixo. E-mail novo `second_analysis` (24h a 72h depois da UNICA analise, texto por WAIT ou plano), chave `EMAIL_SECOND_ANALYSIS_NUDGE` DESLIGADA ate o dono aprovar. Quem some depois de 1 analise: 52% tomou WAIT (17 de 33), 85% no celular. `activation_1` dizia "one-click example chart" (saiu em 30/09): corrigido para as 3 analises de exemplo.
- **05/10 (funil PostHog, 14 dias, lido pela API com a sessao do dono):** 286 viram a landing, 157 abriram o /try (87 concluiram a demo), 113 cadastros, 96 fizeram analise gratis, 21 esgotaram o gratis, 25 viram paywall/CTA, 15 clicaram em assinar, 13 abriram checkout, 1 pagou. Analises gratis por pessoa: 38 fizeram so 1, 24 fizeram 2, 17 fizeram 3, 17 fizeram 4 ou mais. O maior buraco e quem para depois da 1a analise (40% de quem ativa); o segundo e o checkout (13 abrem, 1 paga; paises de checkout BR, MA, IT, NG, MY, KE, IN, ZA). Rastreio por subrota do painel confirmado no PostHog (`/dashboard/plans`, `/new`, `/trades`, `/journal`, `/strategy`). Para consultar de novo: `POST /api/projects/473872/query/` (HogQL) de dentro de us.posthog.com logado.
- **05/10 (opiniao):** quadrinho de opiniao no painel (ver 3.6).
- **05/10 (campanha de reativacao):** `modules/mail/reactivation-campaign.ts` + rotas do /admin (`GET admin/campaigns/reactivation` conta por grupo sem gravar; `/preview?segment=`; `POST .../send` com `confirm: 'SEND'`). Um e-mail por pessoa (AdminAudit `campaign:reactivation_2026_10`), fora assinante, admin, acesso manual, descadastrado, conta com menos de 3 dias e quem recebeu e-mail automatico nos ultimos 3 dias. Grupos pela cota gratis: exhausted (semanal US$ 7,99), one_left/two_left, three_left (so viu WAIT ANTES de 24/09: pedido de desculpas pelo WAIT demais do motor antigo, problema real; o dono pediu para dizer "erro" e ficou o fato verdadeiro), three_left_recent, never. Enviado na noite de 05/10: 200 de 205 (9 exhausted, 17+36 com plano sobrando, 88 desculpas, 13 recentes, 42 nunca analisaram); 5 recusados pela cota diaria da Resend. Licoes: (1) Resend GRATIS = 100/dia UTC para tudo, a campanha gastou a cota do dia 06/10 inteira (boas-vindas e recuperacao falham ate a virada UTC); (2) o commit automatico do `calendar-mirror` faz o Render redeployar e mata trabalho longo em memoria (o disparo parou em 165 e foi retomado); (3) o Render roda 2 instancias: estado em memoria (`campaignRunning`) so vale na instancia que recebeu o POST. Envio recusado agora perde a marca (retentativa so dessas pessoas). Em 06/10 o mesmo valia para os e-mails automaticos: "gratis esgotado" (`recovery-email.ts`) e ciclo de vida marcavam ANTES de enviar e nunca tentavam de novo, e o log da recuperacao dizia "enviado" com a Resend recusando (3 perdidos, 1 deles de quem tinha acabado de tentar pagar o anual). Agora: recusa tira a marca; `retryRecoveryEmails` roda junto da varredura de 15 min (quem esgotou nas ultimas 72h sem a marca). Boas-vindas recusadas nao tem retentativa (5 perdidas em 06/10, sem id no log).
- **05/10 (diario e topo do painel):** Diario ganhou "Performance this month" (`computeMonthStats` em `lib/journal.ts`, so com os dados que o `/journal` ja manda): R medio PLANEJADO (TP1/TP2 pelo R:R da leitura, Stop = -1), fator de lucro e curva/maior queda trade a trade pelos valores registrados, melhor/pior dia e recortes por ativo, tempo grafico, direcao e dia da semana. Depois, no mesmo dia: "You vs the AI plan" (lista e `/journal` mandam `marketOutcome` = `Analysis.outcome` do sweeper, separado do `outcome` da API, que segue sendo o `userVerdict`) e anotacao por trade (`tradeNote` JSONB: nota ate 1000, setup, emocao e erros em listas fechadas copiadas em `lib/trade-note.ts` e `dto/set-trade-note.dto.ts`; `PATCH /api/ai/analysis/:id/note`, rota separada do resultado; coluna no boot com flag propria `tradeNoteReady`; a nota nunca vai ao prompt nem ao PostHog, que recebe so `trade_note_saved` sem texto). Regra que nasceu daqui: campo novo no `schema.prisma` so DEPOIS de a coluna existir em producao, porque `update`/`create` sem `select` no worker devolvem todas as colunas e quebrariam se o worker rodasse antes do ALTER do boot (deploy em dois commits; prova da coluna = salvar nota vazia responde 200, nao 503). Cartao do plano do assinante saiu da lateral e abre pelo saldo/plano no topo (`TicksBadge`); o gratis segue com o contador na lateral. Raio (Zap) trocado por moedas (saldo) e selo (plano).
- **05/10 (oferta):** faixa do topo e /pricing diziam que os primeiros assinantes "travam US$ 29/mes" (ja e o preco normal; nada no codigo garante trava). Agora dizem a oferta real, lida da Stripe: X% no 1o mes do mensal com EARLY35, depois US$ 29. O card mensal dos Planos mostra o mesmo; menu do gratis diz "Subscribe" (era "Upgrade to Pro"). Descricao do produto na Stripe trocada pelo dono (dizia "Monthly Ticks" ate no semanal).
- **05/10:** semana de produto: erro `removeChild` do painel (Google Translate) com causa reproduzida e corrigida, `translate="no"` na area logada e Sentry passando a receber o erro; rotas reais do painel e Planos dentro dele; EARLY35 so no mensal no servidor e na vitrine; gratis esgotado trava historico, diario e resultado no servidor (402) com paywall unico em 6 idiomas; numeros de desempenho fora da home e do corpo pre-renderizado (so na /accuracy); "3 free analyses" corrigido para "3 free trade plans" no resto do site (blog, tools, meta description, FAQ, /try); "cheaper than buying Ticks one by one" removido (nao existe avulso); bloco "How Tickrify works" e leitura do /try no painel; e-mail de boas-vindas redesenhado (marca em texto, versao texto puro, regra verdadeira do gratis) aguardando aprovacao; pergunta de origem vira propriedade de pessoa no PostHog; modelo padrao sem env vira `gpt-5.6-luna`. Detalhe em `_local/funil-2026-10-05.md`.
- **06/10 (extensao, fase 1):** prova da extensao de navegador em `extension/` (fora do workspace: dentro de `apps/` o pnpm mexeria no lockfile do Render/CI). Demos clicaveis aprovadas pelo dono (Chrome e Safari, TradingView e corretora, niveis no grafico, painel em duas camadas, WAIT com "Wait for"). Backend com `source`/`platform`/`chartSymbol`/`chartTimeframe` opcionais e `Analysis.clientContext`; card de novidade pronto e desligado. Testado com o `content.js` construido numa pagina de teste (todos os estados); o fluxo real depende da config do dono (6.2).
- **06/10 (CI):** alerta CRITICO novo em `proxy-addr` (<2.0.8, via express do backend; GHSA-jqcg-44mw-7w3h) derrubava o `pnpm audit` do CI desde a tarde. Override `"proxy-addr": "2.0.8"` no `package.json` da raiz; teste de Docker ok (imagem sobe, API + worker, so a 2.0.8 dentro). Risco real baixo para nos (`trust proxy 1`, nao por faixa de IP).
- **07/10 (funil conferido no PostHog e na Stripe):** recarregar `/dashboard/analysis/:id` contava `upgrade_cta_viewed { source: 'last_free_result' }` duas vezes (uma com chave `unknown` enquanto carregava) e ate quando a analise caia no paywall; agora so conta com a analise na tela. Abrir checkout de outro ciclo expira a sessao aberta (trava 3 do `stripe.service.ts`) e, com ela, a assinatura `incomplete` e a fatura: o link de fatura mandado a mao ao cliente do anual morreu assim quando ele abriu o semanal.
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
