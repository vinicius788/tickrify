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
2. Documento (plano, relatorio, thread, roteiro, analise, handoff) vai
   para `_local/` (gitignored) ou e entregue no chat. Nunca no git.
   **Prompt (para outro Claude/sessao) vai SEMPRE escrito no chat, para o dono
   copiar e colar. Nunca vira arquivo, nem em `_local/`** (12/10/2026: pasta
   enche e ninguem limpa).
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
- **Gancho `pre-push` (`.githooks/pre-push`, 12/10):** roda `pnpm check`, o
  `tsc` do backend e o `pnpm test` antes de todo push, porque o Actions do repo
  privado so tem 2.000 min/mes gratis. Liga com
  `git config core.hooksPath .githooks`; `git push --no-verify` so com motivo.
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
- **Prompt:** v7.6 (13/10; v7.5 em 24/09) em `apps/backend/src/common/prompts/trading-system-prompt.ts`. v7.6 = so o TP1 no primeiro nivel realista (~1 a 1,5R), alvo de 2R+ no TP2. Teste de prompt novo: `apps/backend/scripts/prompt-replay.ts` (prints reais de producao, dois bracos, mesma regua do sweeper; ~US$ 0,006 por analise).
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
  Desde 20/10/2026 (so medicao, nada muda na tela nem na /accuracy): `outcomeDetail.afterTp1` = TP2 `hit|stop|timeout|none` + 1o reteste da entrada depois do TP1 (break-even); WAIT que guardou niveis (so os rebaixados por codigo: 13 de 187 em 20/10; WAIT do modelo vem sem niveis) e simulado e vai para `outcomeDetail.shadow`, com a coluna `outcome` em ABSTAIN. So linhas com outcome null passam: historico intocado.
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
- **Motor 2.0.0 (12/10, no ar):** `ENGINE_VERSION` mora SO em
  `modules/ai/engine-contract.ts`. Cada analise nova grava `result.engine`
  (versao, `data_mode: print`, `validator_action` none|fixed|downgraded, tempos
  por etapa e o contrato v2: verdict BULLISH/BEARISH/NEUTRAL, confidence,
  asset, timeframe, entry, stop, targets, invalidation, key_reasons,
  no_trade_reason). O contrato e montado DEPOIS do parse: o schema do modelo
  continua igual (raciocinio antes, BUY/SELL/HOLD). Analise antiga nao tem o
  bloco e nada na tela le. A chamada ao modelo passa so por `VisionModel`
  (`vision-model.ts`, implementacao `OpenAiVisionModel`): trocar de provedor =
  outra classe. Validador puro `trade-plan-validator.ts` dentro do
  `decideSignal`: direcao invertida continua FALHANDO (tick volta); nivel fora
  de [preco/2, preco*2] vira WAIT; stop antes da invalidacao SO MEDE
  (`validator_flags`, `MEASURE_ONLY_RULES`): o SQL de 12/10 deu 25 de 349
  trades (7%) e 0 fora de faixa; rebaixar mudaria o que o motor entrega sem
  saber se esses trades perdem mais. R/R segue o guard de 1,2 no melhor alvo. `[Cost]` agora mostra `cached=` (cache de prompt).
  Streaming adiado (precisa de Redis pub/sub + SSE; a analise roda no worker).
- **Camada unica de provedor (13/10):** TODA chamada a modelo (analise, eixo de
  preco, `extractSymbol`) passa por `vision-model.ts`; nada mais fala com a
  OpenAI. `AI_PROVIDER` = `openai` (padrao) | `anthropic`; a Anthropic (HTTP,
  sem SDK) so existe com `ANTHROPIC_API_KEY` e hoje esta INATIVA. Com as duas
  chaves, o outro provedor vira contingencia automatica (`FallbackVisionModel`).
  `AI_COMPARE_PROVIDERS=true` (desligado) roda o segundo em paralelo e grava em
  AdminAudit `ai:provider_compare` + PostHog `ai_provider_compared`; o usuario
  nunca ve o segundo. `/health` mostra `ai.providers`; `result.engine.provider`
  diz quem respondeu. Checagem por codigo: JSON invalido ou plano quebrado
  (`direction`, `incomplete` = sem entrada/stop/alvo) repete a chamada UMA vez
  dentro do mesmo `AI_ANALYZE_TIMEOUT_MS`; falhou de novo, tick volta. Antes de
  ligar a Anthropic: o schema da analise tem 29 campos anulaveis e a saida
  estruturada dela aceita 16 (vai como texto no prompt, sem garantia de ordem);
  medir no backtest (4.1).

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
- **`analysisNumber` do `analysis_started/completed` (12/10):** posicao na cota
  gratis CONTANDO WAIT (`totalUsed + 1`), com `analysisNumberSource:
  'free_quota_total'`. Antes contava so BUY/SELL (`used + 1`) e repetia "1"
  depois de um WAIT: evento sem `analysisNumberSource` e da contagem antiga.
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
  `_local/extensao/medicao-eixo/`. Somem quando o grafico mexe (roda do mouse,
  ARRASTAR mais de 4 px, mudar a janela); clique parado (esquerdo ou direito)
  NAO apaga: o trader clica no grafico para pôr a ordem (pedido do dono, 07/10).
  Cada preco do painel copia com um clique (`PriceCell`, "Copied").
- **Regras que nasceram do teste automatizado (06/10, nao desfazer):** (1)
  escala do recorte = largura da captura / largura da janela, nunca o
  `devicePixelRatio` (com 1x numa tela "2x" o recorte pegava a barra lateral);
  (2) o service worker manda `tk:ping` antes de injetar: reinjetar faz o WXT
  desmontar o painel e o icone parava de funcionar na pagina; (3) esconder o
  painel antes do print pelo container DENTRO do Shadow DOM (o
  `:host { all: initial !important }` do WXT ganha do estilo do host e o
  painel saia no print); (4) dois cliques durante uma analise nao cobram duas
  vezes (`busyTabs`); (5) respostas por `sendResponse` + `return true`.
  De 07/10: (6) clique no icone em andamento trava a aba (`startingTabs`) e o
  painel tira um print por vez: cliques repetidos numa pagina recem-carregada
  entregavam um "comecar" atrasado e cobravam 2 vezes; (7) cada analise solta a
  trava UMA vez (`release`): o fim atrasado de uma analise velha apagava a
  trava da nova; (8) mensagem que chega antes do React montar e entregue na
  inscricao do painel (`bus.subscribe`), nunca num `setTimeout`: o 1o clique
  na Binance se perdia.
- **Suite de ponta a ponta (custo zero):** `_local/extensao/e2e/suite.mjs`
  (Puppeteer + Chrome for Testing, `triggerExtensionAction` libera o
  `activeTab` como o clique real) contra a API falsa
  `_local/extensao/fake-api/server.mjs` (porta 8787, salva cada recorte). Build
  de teste: `WXT_API_URL=http://localhost:8787 WXT_TEST_TOKEN=test npm run build`
  copiado para `_local/extensao/teste-chrome`, e depois `npm run build` normal
  de novo. 30/30 em 06/10; 33/33 tres vezes seguidas em 07/10 (TradingView real, Binance real, zoom 125%, erros,
  cota, ultima analise). Rodar de novo antes de qualquer subida da extensao.
- **Camada 3 (06/10, backend real local com banco/Redis descartaveis no Docker,
  worker da fila, IA de verdade, Clerk de TESTE; `_local/extensao/camada3/` e
  `e2e/suite3.mjs`): 8/8.** Site sem campos novos igual (clientContext NULL);
  analise pela extensao grava `clientContext`, aparece no historico e o "Open in
  Tickrify" aponta a analise certa; WAIT nao gasta; cota esgotou no 3o
  BUY/SELL; proximo clique = planos sem linha nova; chamada direta ao servidor
  = 403 `DEMO_LIMIT_REACHED`. CORS real: so a origem oficial passa. 5 analises,
  ~US$ 0,10.
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
- **Painel SO em ingles** (`lib/texts.ts`; decisao do dono em 07/10: o
  portugues e so a conversa com ele). A extensao manda `userLanguage=en`, entao
  o texto da IA tambem sai em ingles e a tela nao mistura idiomas.
  `translate="no"` no painel (o tradutor do Chrome traduzia o painel).
  **Cores = tokens do painel do site** (`#050508`, cartoes 3% branco, botao
  principal branco, verde/vermelho/amarelo so para sinal, rotulos em mono).
  Erro mostra `Detalhe:` com o codigo tecnico (e loga `[Tickrify]` no console do
  service worker). Mensagem para o painel tenta por ~10 s (pagina pesada
  recem-carregada perdia o clique). **Clique responde na hora** (07/10): o
  painel mostra "Checking your account" logo depois de injetar, antes de
  conferir login e cota; o Clerk carrega UMA vez por gesto (`refreshSession`
  no clique, `loadClerk` reaproveita nas chamadas seguintes, teto de 20 s) em
  vez de um `load` na rede por chamada (cota, envio e cada consulta da
  analise). O dono via o clique no icone "travar" (2 a 3 s de tela parada). Suite e2e oscila com a maquina carregada
  (load > 10): rodar de novo antes de concluir que quebrou.
- **Card de novidade** (`ExtensionAnnouncement.tsx`) na tela inicial do painel:
  so aparece com `EXTENSION_STORE_URL` preenchida (vazia ate a loja aprovar) e
  em Chrome/Edge de computador. Eventos `extension_card_viewed/clicked/dismissed`.

### 3.8 Setups acompanhados (12/10, Parte A; no ar)

- **Seguir != favoritar != entrar.** "Follow setup" (abaixo do resultado, em
  destaque no WAIT) grava `TrackedSetup` e `Analysis.setupId`; nao toca
  `userVerdict`, resultado, valor, diario, /usage nem consultas publicas.
  Seguir 2x = 1 setup (unico em `rootAnalysisId`); largar/arquivar so muda o
  status (`tracking|untracked|archived`). Teto de 20 `tracking` (lock por
  pessoa no Postgres). Codigo em `modules/ai/setups.*`, tudo por SQL.
- **Atualizar = analise normal** com `setupId` no `POST ai/analyze`
  (`/dashboard/new?setup=<id>`, custo real na tela antes de enviar). O
  servidor confere ANTES de cobrar: alheio 404, largado 409. Vinculo gravado na
  criacao (vale para fila e sincrono); `recordSetupVersion` roda na conclusao
  dos dois caminhos. O motor nunca le o `setupId`.
- **Rotas** `/api/setups` (lista, seguir, `by-analysis/:id`, `:id` com versoes
  por cursor, `PATCH :id`): nenhuma publica; gratis esgotado = 402 (a pagina do
  setup mostra so versoes entre as 3 abertas, senao Paywall `setups`). Tela:
  topo do inicio (linha do perfil de estrategia + setups) e
  `/dashboard/setups/:id` ("Analysis from <data>", nunca "current/live").
- **PostHog:** servidor `setup_followed`, `setup_unfollowed`, `setup_archived`,
  `setup_update_completed`; navegador `setup_follow_clicked`, `setup_opened`,
  `setup_update_clicked/submitted/failed`. So ids e enums.
- `TrackedSetup` e `Analysis.setupId` ja estao no `schema.prisma` (`0812338`;
  `SupportThread`/`SupportMessage` em `5a0512d`).

### 3.9 Chat com o fundador (12/10, Parte B; no ar)

- **Feito em casa**, sem widget de terceiro (cookie, /privacy, sumiria para
  quem recusa). Uma conversa por pessoa (`SupportThread`, unico em `userId`) e
  `SupportMessage` (texto puro, 1 a 2000 caracteres), por SQL em
  `modules/support/`. Rotas `/api/support/{thread,messages,read}` so da conversa
  do token; `/api/admin/support/threads*` com AdminGuard. NAO passa pelo
  `isFreeLocked`: quem esta no paywall consegue falar. 20 mensagens/hora por
  pessoa (contado no banco).
- **Tela:** a bolha virou "Chat, feedback or problem" com o chat como aba
  padrao ("Talk to Vinícius, founder of Tickrify", "Usually replies within a
  few hours", sem bolinha verde); numero de nao lidas no botao e no menu do
  painel; `?chat=open` abre direto. Polling 10 s com o chat aberto e 60 s para
  o contador, parado com a aba oculta. /admin ganhou a aba Chat (`?aba=chat`).
- **E-mails** (`chat-email.ts`, chave `CHAT_EMAIL_NOTIFY` DESLIGADA = so
  `[chat] dry-run`): `chat_founder_notify` para `FOUNDER_CHAT_NOTIFY_TO`
  (padrao support@), com o texto, 1 por conversa a cada 15 min;
  `chat_reply` ("Vinícius replied", sem o texto) se a pessoa nao leu em 10 min,
  1 por conversa a cada 6 h, nunca para descadastrado (varredura no worker a
  cada 5 min). Reserva por UPDATE condicional (2 instancias no Render).
- **PostHog sem texto:** `chat_message_sent { threadId, author, length,
  isSubscriber, freeLocked }`, `chat_thread_started { startedBy }`,
  `chat_reply_email_sent`, `chat_founder_notify_sent`; navegador
  `chat_opened { surface, unread }`, `chat_message_submitted { length }`.

### 3.10 Trial de 3 dias sem cartao (13/10; pronto, DESLIGADO)

- **Chave `TRIAL_MODE` (/admin, desligada).** Ligada: conta sem nenhuma
  analise gratis ganha o trial na 1a visita ao painel (`/usage`); quem ja usou
  a regra antiga (3 planos) continua nela. Sem cartao, sem trial da Stripe,
  sem cobranca automatica: paga so quem clica para assinar.
- **Regras num lugar so** (`common/trial.ts`, `TRIAL_RULES`): dia de uso = dia
  do calendario no fuso do navegador (guardado no trial; sem fuso, UTC) com
  ao menos 1 analise; cota 3/2/2 (WAIT conta); acaba ao esgotar o dia 3, ao
  comecar um 4o dia de uso ou 7 dias depois do inicio. Depois: modo leitura
  (historico inteiro aberto, diario/resultado/favoritos/nova analise travados).
- **Integracao:** `getFreeQuota` (free-quota.ts) le o trial e devolve o MESMO
  formato, entao acesso, `/usage`, trava, funil e e-mails mudaram juntos. Sem
  linha em `UserTrial`, tudo igual a antes. Tabela por SQL (boot do
  `TrialService` + migracao `20261013120000_user_trial`), fora do schema.prisma;
  coluna `Analysis.imageSha256` (print repetido em 24h devolve a leitura, sem IA).
- **Anti-abuso:** e-mail descartavel nega (linha `denied`), e-mail nao
  verificado no Clerk espera verificar, 3 trials novos por IP em 24h. Teto de
  gasto US$ 10/dia (UTC, estimado a US$ 0,0195/analise): passou, mensagem de
  fila (`TRIAL_BUSY`) e alerta 1x/dia (log, AdminAudit `trial:spend_cap:<dia>`,
  e-mail ao suporte).
- **PostHog (servidor):** `trial_started`, `trial_day_completed {day_index,
  analyses_that_day}`, `trial_daily_limit_hit`, `trial_paywall_shown {trigger}`,
  `trial_ended {reason}`, `subscription_renewed` (fatura `subscription_cycle`).
  `subscription_created`/`payment_succeeded` levam `trial_day_at_conversion`;
  o navegador leva `trial_day` em todo evento (super propriedade do /usage).
  Todos com `utm_source` e `$referring_domain` do primeiro toque.
- **E-mails:** 7 tipos `trial_*` no lifecycle-email.ts, chave
  `EMAIL_TRIAL_SEQUENCE` (desligada = dry-run). Regra nova para TODO e-mail de
  ciclo de vida: no maximo 1 por pessoa em 20h. Trial nao recebe
  activation_*/second_analysis/recuperacao (falam dos 3 planos). Boas-vindas
  muda de texto com `TRIAL_MODE` ligado.
- **Reativacao:** `GET/POST /api/admin/trial/reactivation` (chave
  `TRIAL_REACTIVATION`, `confirm: 'GRANT'`); concede o trial, nao envia nada.

### 3.11 Estado da operacao e modo gerenciamento (13/10)

- **Por que:** medido em 13/10 com 2 prints reais de ouro com a posicao
  desenhada, a analise normal tratou o print como setup novo (compra desenhada
  -> WAIT bearish usando o stop/alvo desenhados como niveis proprios; venda
  desenhada -> venda NOVA acima do stop desenhado). Custo do teste: 2 ticks.
- **Estado** (`common/trade-state.ts`, tabelas `TradeState` e `TradeCheck` por
  SQL, boot + migracao `20261013130000_trade_state`): suggested (sem linha),
  pending_order, in_trade, closed, cancelled, expired (pendente > 7 dias);
  motivo em lista fechada. **Uma verdade so:** marcar grava o `userVerdict`
  junto (in_trade=open, target_hit=tp1, stop_hit=stop, cancelado/expirado=
  no_fill) e o `setOutcome` do My Trades/diario atualiza o estado
  (`syncFromVerdict`). O painel substituiu a pergunta "Vai operar?".
- **Grafico novo:** com operacao pendente/aberta na janela de 14 dias, o
  front le o simbolo (`/api/trades/match`, leitura barata sem cota) e PERGUNTA
  se e acompanhamento. Sim = modo gerenciamento; Nao = pergunta se a anterior
  segue aberta e faz analise nova (com aviso de operacao aberta no resultado).
  Nunca decide pela imagem.
- **Modo gerenciamento** (`trade-management.ts`, chamada separada, mesmo
  modelo, prompt do motor intocado): schema proprio (situacao + acao, sem
  campo de entrada nova); codigo corrige acao fora do estado e decide
  target_hit/stop_hit pelo preco DIGITADO; sem preco e sem leitura segura =
  unclear e pede o preco. JSON fora do schema repete 1 vez.
- **Cota:** `TRADE_RULES.managementCheckCost` (1 analise gratis ou 1 tick) e
  `maxChecksPerTrade` (10). Checagem gratis conta no total da regra antiga e
  no dia do trial (free-quota.ts).
- **PostHog:** `trade_marked_pending`, `trade_marked_open`, `trade_closed
  {close_reason}`, `trade_management_requested {situation, action}`, todos com
  `analysisId`. E-mail `trial_day2` com operacao aberta vira "Your [ASSET]
  trade is still open" (mesma chave desligada). Aviso fixo no painel:
  "Educational tool, not financial advice."

### 3.12 Configuracoes, cancelamento e tema (13/10)

- **`/dashboard/settings`** (`SettingsPage.tsx`): status ("Active, renews on",
  "Canceled, access until", "Ended on"), valor, proxima cobranca, botao
  "Manage subscription" (portal da Stripe) e "Reactivate subscription" antes do
  fim do periodo (`POST /api/stripe/subscription/reactivate`). Tambem no menu da
  conta (Clerk `UserButton.MenuItems`), so com `billingManageable` do `/usage`
  (assinatura `sub_*` viva; o acesso manual nao tem portal). Portal responde 403
  `no_subscription` sem assinatura; customer sempre do banco, nunca do navegador.
- **Portal criado por API** na 1a abertura (`ensurePortalConfiguration`,
  metadata `tickrify=portal_v1`): cancelar no FIM do periodo, motivo em lista
  fechada, cartao e faturas, sem troca de plano, sem retencao, retorno em
  `/dashboard/settings`. A configuracao padrao do painel fica intocada; falhou,
  usa a padrao (log `[portal]`). Mudar recurso = versao nova da tag.
- **Webhook:** `updated` com `cancel_at_period_end`/`cancel_at` mudando emite
  `subscription_cancel_scheduled {reason, subscription_day, billingCycle}` ou
  `subscription_reactivated` (dedupe pelo id do evento); `deleted` emite
  `subscription_ended {reason}`. Colunas `cancelAtPeriodEnd`, `cancelAt`,
  `canceledAt`, `endedAt`, `cancelReason`, `cancelFeedback` no `Subscription`
  por SQL (boot + migracao `20261013140000`), FORA do schema.prisma. Portal:
  `billing_portal_opened`. /admin aba Cancelamentos (`GET admin/cancellations`).
- **Ex-assinante = modo leitura** (`formerSubscriber` em `getFreeQuota`: tem
  `sub_*` `canceled`): historico inteiro aberto, nova analise/diario/resultado
  travados, sem trial novo e sem e-mail de "gratis esgotado".
- **E-mail de cancelamento** (`sendCancellationConfirm`) atras da chave
  `EMAIL_CANCELLATION_CONFIRM` DESLIGADA (so `[mail] dry-run`).
- **Afiliado:** quem cancelou e assinou de novo nao gera comissao sobre a
  assinatura nova. Clique repetido do mesmo aparelho (IP + navegador) no mesmo
  dia UTC conta 1 (id do clique = hash). Eventos `affiliate_link_visited`
  (sem perfil de pessoa), `affiliate_signup`, `affiliate_sale_paid`. Vinculo do
  navegador tambem em cookie de primeira parte `tickrify_ref` (30 dias). /admin
  mostra vendas pagas e "Marcar como pago" (`POST admin/affiliates/:id/settle`,
  fecha todo o disponivel num saque PAGO, Pix por fora).
- **Tema claro** (so `/dashboard`, `/demo`, `/admin`; vitrine, blog e
  `/affiliate` seguem escuros): `lib/theme.ts`, tokens em
  `styles/trading-tokens.css` (`:root[data-theme='light']`; valores ESCUROS
  iguais aos de antes) e no bloco shadcn do `index.css`. Script do `index.html`
  aplica antes da pintura (localStorage `tickrify_theme`); a conta guarda em
  `User.themePreference` (SQL, migracao `20261013150000`, `GET/PATCH
  /api/auth/preferences`) e vence o aparelho no login. `theme_changed` sai do
  servidor. Cor nova na area logada = token, nunca `bg-white/[..]`,
  `text-zinc-*` ou hex (o card de compartilhamento em canvas segue escuro).

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
- **Par de forex/metal so por `canonicalFxPair`** (`analysis-normalizer.ts`, 13/10): aceita sufixo de corretora (XAUUSDm, EURUSD.pro) e recusa USDT/USDC. Grounding, contexto de dolar/juros, calendario e sweeper usam ele; regex proprio de par em outro lugar volta a separar as regras (o regex solto dava dolar/juros como "dado real" a altcoin; o ancorado deixava ouro com sufixo UNTRACKABLE).
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
- **Checagem de operacao e demo reservam ANTES da IA (26/10, `96ebbfc`).** Reserva
  = linha com `result = 'null'::jsonb` (`TradeCheck`, `DemoUsage`); falha libera
  uma vez; nunca por idade. Controle nas linhas `ops.trade_checks.v1` e
  `ops.demo.v1` da `FeatureFlag` (fora do /admin): linha ausente = endpoint
  FECHADO (503). Pausar/abrir/conciliar so pelo Shell da Render:
  `node apps/backend/scripts/trade-check-control.cjs pause|status|open --confirm-bootstrap-retired`,
  `node apps/backend/scripts/demo-control.cjs pause|status|open|release --id UUID --confirm-execution-stopped`,
  `node apps/backend/scripts/reconcile-trade-check.cjs [--check-id UUID --apply --confirm-execution-stopped]`.
  Reserva presa (requisicao morta por SIGKILL no deploy; o entrypoint ignora
  SIGTERM) volta SOZINHA: varredura no boot e a cada 10 min libera pendentes
  com mais de 30 min (IA tem timeout de ~2 min; o DELETE e a unica
  reivindicacao, nada credita 2x). Log `[trades]`/`[demo] ... liberada(s)
  automaticamente`; so `[trades] ... ledger inconsistente` pede olho humano.
  Ninguem precisa rodar comando no dia a dia. Rollback = PAUSAR;
  nunca "Rollback" da Render para antes de `96ebbfc` com os endpoints abertos
  (reabre a corrida: IA sem reserva, quota e limite de 10 furados).

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
- **Visual das paginas estaticas = `public/site.css`** (13/10): os mesmos tokens,
  cabecalho, botoes e rodape do `.tk-site` da landing, num arquivo so (antes cada
  pagina tinha um `<style>` com verde neon). Pagina estatica nova: `<link
  rel="stylesheet" href="/site.css?v=N">`, o `<header class="site-header">` e o
  `<footer class="site-footer">` copiados de uma pagina existente, aviso proprio
  em `.page-note`. Mudou o CSS: subir o `?v=` nas 22 paginas. Cor so para dado
  (`.yes`/`.no`, resultado da calculadora).
- `og.png`: ao trocar a arte, subir o `?v=` (hoje `?v=4`, 54 referencias). Arte de 13/10/2026 (trial): "Your AI trading copilot.", cartao de exemplo SEM confianca, rodape "3-day free trial · no card"; fonte HTML em `_local/semana-2026-10-05/og-trial.html` (a anterior, "3 free trade plans", em `og-novo.html`). Gerar com Chrome headless em 1200x630.
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
| 20/10 | **Regra do candle do fill, `legacy | stop_only` (commit `bad809625121ac23b27037071f77ddea0dd982d5`, no `main`; deploy confirmado em 20/10/2026 21:44 UTC: Vercel com os textos novos da /accuracy, Render com `stopOnly` e `methodology` na API).** A /accuracy publica que a entrada enche primeiro, mas o sweeper aceitava o TP1 no mesmo candle de 30m do fill. Em 196 trades (24/09 a 10/10) contra a sequencia de 1m: `legacy` 6 fora do intervalo do 1m (4 WIN falsos, 2 LOSS pessimistas), `stop_only` 3 (todos pessimistas). Regra e `fillCandleRuleOf` em `accuracy.util.ts`; sweeper usa `stop_only` e grava `outcomeDetail.fillCandleRule` (sem o campo = legacy); `prompt-replay.ts --fill-candle-rule` (padrao legacy, grava a regra, recusa retomar com outra); `evaluate.py` `fill_candle_rule` (CLI `BT_FILL_CANDLE_RULE`, padrao legacy) e `analysis-pilot-outcomes.py --fill-candle-rule` (padrao legacy). /accuracy (decisao do dono, opcao c): `overall`, `byConfidence`, `byGrounding`, `byPrompt`, `byModel` e `breakdown` so com linhas `legacy` (sem o campo, nulo ou desconhecido); `stop_only` so em `stopOnly { overall, breakdown }`, nunca somado; `methodology` diz qual regra cada serie usa. Nenhuma linha reprocessada. Pagina e `geo-body.mjs`: rotulo 'Hit rate, original scoring rule', secao 'Updated scoring rule, separate series' (so com `stopOnly`), metodologia e FAQ explicam a diferenca. `legacy` = TP1 vale no candle do fill (regra ate o deploy, todas as linhas antigas); `stop_only` = no candle do fill so o stop conta (avaliacoes feitas depois do deploy). Vigencia de `stop_only`: 20/10/2026 21:44 UTC; isso NAO quer dizer que ja existam resultados nela: na verificacao do deploy `overall.n` = 176 (todos legacy) e `stopOnly.n` = 0, porque o sweeper so avalia analises com mais de 48h. **Pendente (~22/10/2026):** SQL somente leitura no Supabase confirmando avaliacoes novas com `outcomeDetail.fillCandleRule = 'stop_only'`; sem registros, conferir o ciclo do worker e a janela de 48h antes de suspeitar de defeito. | Claude (verificar 22/10) |
| 19/10 | **VNext (branch `claude/vnext-engine`, base `2ea57bd`): divergencia residual do prompt, adiada de proposito.** Feito: o worker monta o prompt por `buildAnalysisPrompt` (`prompt-builder.service.ts`; prova byte a byte em `src/__tests__/ai-worker-prompt-equivalence.spec.ts`, 480 casos + digest); `news_event` em `validatorReasons`; D1 = o caminho sincrono (`ai.service.processSynchronously`) chama `buildPromptByVersion(..., { consistency: false })` e fica sem a "CONSISTENCIA OBRIGATORIA", como o worker. D2 = o worker passou a trocar o `{{USER_CONTEXT}}` do override (perna B do A/B da v9, unico override de producao, padrao 0%) pela instrucao de idioma, como o sincrono ja fazia; override sem placeholder segue sem idioma nos dois (o teste do worker guarda o digest de `2ea57bd` e o de D2). Trim: com `consistency: false` o sincrono nao faz mais trim e junta o bloco deep como o worker; os dois ficam byte a byte iguais (montador e mensagem system da OpenAI) para prompt do banco, do codigo e override v9. **Ainda recebem o bloco (padrao de `buildPromptByVersion`), por decisao do dono em 19/10:** o `/try` (`demo.service.ts`, publico) e os scripts de medicao `prompt-replay.ts`, `backtest-runner.ts` e `analysis-pilot-runner.ts`. Consequencia: medicao feita por esses scripts NAO reproduz o prompt do worker (bloco e trim); os comentarios do `backtest-runner` ("exatamente o caminho de producao") e do `analysis-pilot-runner` ("mesmo caminho do worker") estao errados nisso. D3 (so caracterizacao e log, regra nenhuma mudou): testes fixam que `currentPrice` 0, null, ausente, "" ou texto vira 0 no parser (negativo fica negativo), que o worker falha com `validation_failed` / `currentPrice invalido: 0` ate num WAIT e que o sincrono grava a mesma resposta como concluida. Log novo do adapter, so na analise principal e ANTES do `ensureNumber` (no `parseSchemaResult`): `[price] currentPrice do modelo sem preco util: <categoria>`, com `model_zero`, `model_negative`, `missing`, `null` ou `non_numeric`; preco positivo e texto numerico nao logam. `missing` = campo ausente no JSON que o parser recebeu: NAO prova se foi o modelo ou resposta truncada e reparada (o truncamento tem log proprio). As 4 falhas de 20/09 sem `errorCode` sao anteriores a coluna (`a171226`, 23/09). Validado na worktree em 19/10: 65 suites, 1017/1017, tsc e eslint limpos; ainda NAO esta em producao (sem commit). D4: com resultado do AIAdapter o worker NAO roda mais `decideSignal` (antes rodava de novo, com 2a consulta ao calendario, e descartava a 1a); grava a decisao do adapter com a confianca inteira (como sempre gravou) e so revalida o plano (`validateTradePlan`, puro). A fonte de demonstracao (fora de producao) decide sozinha. `decideSignal` devolve `newsGuardStatus` (so memoria): disabled, skipped, no_event, event, degraded_no_event, degraded_event, timeout, error; log `[news-guard] status=<s> symbol=<ativo>` uma vez pela decisao usada (warn em timeout/error/degraded). Politica do guard NAO mudou: timeout, erro e fonte degradada sem evento seguem sem rebaixar (falha aberta), agora visivel; bloquear e decisao do dono. `result.engine.timings.validation_ms` passou a somar o tempo de decisao do adapter. Problema separado, nao corrigido: WAIT com confianca 55 grava 55.00000000000001 (0..1 no worker e x100 ao gravar). Ainda abertos: versao ausente (sincrono cai no ativo, worker no codigo), regras do worker (preco <= 0 ate em WAIT, TP1/TP2 obrigatorios, ordem dos alvos; decisoes do dono, auditoria D3-A), politica do news guard sem calendario. **Qualidade por codigo (19/10, noite):** 92 respostas completas do luna guardadas no Mac (Experimentos A e B, checklist de 29/09; os 92 prints do replay de 13/10 so tem resumo) passadas pelo adapter real com cliente falso: percentual de stop/alvo errado em 7 de 83 planos e total do checklist diferente da lista em 16 de 32 respostas no formato de producao. Agora percentuais saem dos precos (`computeLevelPercents`, adapter, worker e leitura do historico) e, com os 7 itens marcados, a lista vence o total declarado (`reconcileConfluence`); depois: 0 e 0, nenhuma recomendacao nem confianca mudou nas 92. Regra so de medicao `limit_needs_confirmation` em `validator_flags` (limit cujo texto espera rejeicao/sweep/fechamento: 32 de 83). My Trades mostrava fatores sobre 6 (checklist tem 7). Validado: 66 suites 1092/1092, tsc, eslint, frontend tsc + 265/265 + vite build. Fica com o prompt (precisa de chamada paga para medir): limit que espera confirmacao, instabilidade entre repeticoes (2 a 3 de 10 iguais no B), entrada a mais de 3 ATR do preco (26 de 83). **Experimento D (19/10, pago, US$ 0,16 de teto 0,20, fora do repo em `tickrify-experimento-d-limit/`):** prompt de producao x candidata que separa limit (toque) de stop (confirmacao), 10 graficos x 2 repeticoes, caminho do worker: problema 4/15 x 2/15 (leitura manual), 0 erros novos, mesmo HOLD (5 x 5), formato igual; a candidata nunca usou stop. Amostra pequena e efeito pequeno: NAO mudar o prompt; medir pela `limit_needs_confirmation` em producao primeiro. A regra ignora a clausula de cancelamento ("cancel after a close above X" era falso positivo). Varredura final por codigo (19/10) nos 113 planos guardados (92 + Experimento D): zero invalidacao do lado errado, limit ja executavel, stop ja atingido, TP2 antes do TP1 ou preco do texto diferente do campo `entry`; o que sobra e julgamento do modelo (prompt) ou regra que depende do resultado do sweeper (R/R guard e stop antes da invalidacao, SQL do dono). | dono decide / Claude |
| 13/10 | **Auditoria do motor por classe (relatorio em `_local/auditoria-motor-classes-2026-10-13.md`).** Prompt unico para todas as classes. v12, WIN/LOSS do sweeper, antes de custos: metais n=97, 41% (Wilson 32 a 51), +0,14R; cripto n=50, 30%, -0,24R; forex n=17, 12%, -0,71R; sinteticos 19 analises, nada medivel; indices/acoes ~8 cada. `isDemo=true` = analise GRATIS (nao filtrar ao medir o motor). Feito: `canonicalFxPair` (4.1); v7.6 no ar (replay de 92 prints: -0,02R -> +0,14R; ganho veio de cripto/forex com n pequeno, ouro igual). Medir o `promptVer` novo x 12 por classe quando tiver n >= 30 WIN/LOSS; se metais cair abaixo de 0R, voltar a v7.5. Falta: (1) dono aprova o texto do aviso "experimental" no forex e da recusa de sinteticos (sem cobrar) antes do codigo; (2) depois do deploy, SQL que devolve ao sweeper os UNTRACKABLE de forex/metal com sufixo (entregue no chat); (3) playbook por classe so depois de medir a v7.6. | dono / Claude |
| 13/10 | **Vitrine promete trial: conferir `TRIAL_MODE` LIGADO no /admin.** Home, /pricing, posts e llms.txt dizem "3-day free trial, no card" desde `dd6485b`; com a chave desligada, conta nova ainda cai na regra antiga (3 planos). Tambem: a /accuracy grava os numeros no HTML no BUILD (`geo-body.mjs`) e o texto diz "recalculated hourly": o HTML cru so muda a cada deploy (o React le ao vivo). "Can I switch plans" agora diz que a troca e feita pelo suporte (portal sem troca de plano): dono confirma que faz isso na Stripe. | dono |
| 13/10 | **Cancelamento, afiliados e tema (3.12) prontos para deploy.** Dono: (1) aprovar o texto "How to cancel" (vitrine) e o e-mail de cancelamento (entregues no chat); so depois pôr o "How to cancel" no site e ligar `EMAIL_CANCELLATION_CONFIRM`; (2) conferir no endpoint do webhook `customer.subscription.updated` e `.deleted`; (3) Stripe > Settings > Billing > Subscriptions and emails: link de gerenciar assinatura nos e-mails (recibo/renovacao); (4) testar em modo teste (sandbox) o portal: cancelar, voltar vendo "Canceled, access until", reativar; conferir `[portal] Configuracao do portal criada` no Render; (5) decidir a duracao do cupom de afiliado (o codigo trata `once`; nao existe cupom de afiliado na Stripe em 13/10) e se a /cookies deve citar o `tickrify_ref`; (6) aprovar o tema claro pelo preview da Vercel. | dono |
| 13/10 | **Trial de 3 dias pronto e DESLIGADO (3.10).** Antes de ligar `TRIAL_MODE`: (1) textos APROVADOS pelo dono em 13/10 (e-mails `trial_*`, inclusive a variante do dia 2 com operacao aberta, boas-vindas e telas); (2) vitrine trocada para "3-day free trial, no card" em 13/10 (landing nos 6 idiomas, /try, /pricing, FAQ, meta descriptions, seo-routes, blog, /for, tools, llms.txt, og.png `?v=4`): o push dessa troca e o liga de `TRIAL_MODE` vao JUNTOS, no mesmo momento, senao o site promete trial com conta nova ainda na regra antiga; (3) conferir no boot `[trial] Tabela pronta`. Depois de ligar: funil por dia no PostHog (`trial_day_completed` por `day_index`), `trial_paywall_shown` por `trigger`, conversao por `trial_day_at_conversion`. | dono / Claude |
| 13/10 | **Quando a Anthropic entrar em uso:** atualizar /privacy (secao 4 ja diz "AI provider"; texto proposto entregue no chat em 13/10) e conferir `[ai-provider]` no Render. Nada publico cita a Anthropic antes disso. | dono / Claude |
| 12/10 | **Redesenho da tela de resultado nunca juntado:** branch remota `claude/blissful-heisenberg-dwasmg` (01/10, 2 commits): acao em destaque e vies secundario, WAIT explicado uma vez como decisao de risco, preco sem `$`, textos dos exemplos em `t.samples` nos 6 idiomas (~540 linhas no `AnalysisResult.tsx`), e `scripts/e2e-payment.mjs` no lugar do `e2e-staging.mjs`. O `main` mudou muito depois (setups, motor 2.0.0, estrelas): decidir se refaz em cima do `main` (com demo antes) ou se descarta e apaga a branch. | dono decide |
| 12/10 | **Motor 2.0.0 no ar:** depois do deploy conferir `analysis_completed` com `engine_version=2.0.0` e `[Cost] ... cached=` no Render. Em 7 dias: `validator_action` por valor, mediana de `model_ms`, `queue_ms`, `verdict_visible_ms`. Tempo ate o 1o token so existe com streaming. Em **19/10**, junto do R/R guard: acerto (WIN/LOSS do sweeper) dos trades com stop antes da invalidacao x os outros; so ligar o rebaixamento se perderem claramente mais com n >= 30. | dono / Claude |
| 12/10 | **Chat (Parte B) no ar:** (1) conferir no boot `[chat] Tabelas prontas.`; (2) escolher a frase de boas-vindas do chat (versao 1 no ar); (3) ligar no /admin `CHAT_EMAIL_NOTIFY` quando quiser os avisos por e-mail (conferir depois `[mail] Enviado kind=chat_founder_notify` e `kind=chat_reply`; lembrar que a Resend gratis e 100/dia para tudo). Medir por semana: conversas iniciadas pelo usuario, tempo ate a 1a resposta, e % de quem conversou que analisou ou assinou em 7 dias contra quem nao conversou (leitura, sem afirmar causa). | dono / Claude |
| 12/10 | **Setups (Parte A) no ar:** (1) depois do deploy, conferir no boot `[setups] Tabela e coluna prontas.`; (2) rodar no Supabase `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Analysis_setupId_idx" ON "tickrify"."Analysis"("setupId");` (desfazer: `DROP INDEX CONCURRENTLY IF EXISTS "tickrify"."Analysis_setupId_idx";`). Medir em 7 dias: % de quem seguiu e fez `setup_update_completed` em OUTRO dia em ate 7 dias; 2a analise de quem tomou WAIT na 1a (hoje ~50%); dias distintos com analise por semana entre assinantes. | dono / Claude |
| 08/10 | **Proximo experimento: teste mais longo (tese do dono).** O dono acha que 3 analises nao bastam para o trader ver se o produto e bom: "se ele testar 3 dias e no 4o pensar *preciso disso*, assina". Pensar bem antes de fazer. Combinado: NAO trocar o gratis (e o que traz gente; 83% de quem cadastra analisa) nem pedir cartao no cadastro (o cartao e o buraco: 11 de 12 checkouts sem cartao digitado, 40% de recusa por falta de saldo). Desenho candidato: no PAYWALL, opcao "3 days full access" com cartao, virando semanal/mensal no 4o dia; variante "3 days for $1" (a cobranca de US$ 1 ja testa o cartao no dia 1, nao entrega 3 dias de IA a quem nao vai conseguir pagar). Stripe tem trial nativo. Medir checkout iniciado x cartao digitado x pago no dia 5 contra o funil atual (13 abrem, 1 paga). Antes: dono assiste ~10 gravacoes do PostHog (session replay) de quem ficou 10+ min sem assinar (perdido ou interessado?). Mexe em cobranca: demo clicavel e ok do dono antes de codigo. Junto: credibilidade (depoimentos no ar, texto "How I use Tickrify", "Who's behind this" com foto, video de 60 s) e conversa 1 a 1 com os pagantes (SQL de uso por assinante entregue no chat em 08/10; mensagem citando o uso real + 1 mes gratis por call de 15 min). | dono decide / Claude |
| 07/10 | **Estrelas e depoimentos.** "How useful was this read?" abaixo do resultado de analise PAGA (`RatingCard`, 1x/semana; respondeu, 30 dias). Nota alta pede frase + licenca OPT-IN para citar; nota baixa, motivos de lista fechada. Tabela `AnalysisRating` (migracao `20261007130000` + boot), `modules/ratings/`. /admin aba Opinioes: notas, media por BUY/SELL/WAIT e botao Publicar (so com licenca e comentario, o servidor confere). Site: `TestimonialsSection` na home e na /pricing e uma frase no paywall, SO com 2+ publicados. PostHog: `rating_card_viewed`, `rating_given`, `rating_details_sent`, `analysis_rated` (servidor), sem texto. Falta: commit/deploy; bloco "How I use Tickrify" do dono (precisa do texto dele). | dono / Claude |
| 06/10 | **Linhas: medir em mais graficos antes de divulgar.** A leitura do eixo foi medida em 4 graficos do TradingView (tema claro, 1D) e, em 07/10, num print real do dono (XAUUSD 5m, tema ESCURO, Pepperstone): as 4 linhas no preco certo pelo eixo, erro de ~1 px. Falta: corretoras (area marcada pode nao ter o eixo: a IA tem que devolver null) e o `[Cost] price-axis` real no Render. Se alguma passar de ~15 px, desligar as linhas (a extensao ja fica so com precos quando nao ha escala). | Claude |
| 07/10 | **Extensao PAUSADA pelo dono para replanejar** (achou o fluxo confuso). Nada publicado: so roda no Chrome dele (pasta da Mesa); o card do site segue desligado. Ficou decidido manter a analise direto no clique no TradingView. Em aberto ao voltar: arrastar a linha da ordem no grafico apaga as linhas da extensao (nao da para distinguir de arrastar o grafico); o painel do TradingView que abre embaixo muda a altura do grafico sem apagar as linhas (falta observar o tamanho do grafico). | dono |
| 06/10 | **Extensao, fase 2:** conferir o simbolo lido da pagina contra o `extractSymbol`; visual final com o dono; texto da /privacy (envia so o recorte, so no clique); ficha da Chrome Web Store (US$ 5, conta do dono); depois de aprovada, preencher `EXTENSION_STORE_URL` (liga o card) e trocar a chave/id pelos da loja no CORS e no Clerk. Fase 3: Firefox (sync do Clerk so e documentado para Chrome) e Safari (US$ 99/ano + Xcode, decisao do dono). | Claude / dono |
| 05/10 | **Campanha de reativacao: medir em 13/10** quem voltou a analisar e quem assinou entre os 200 (AdminAudit `campaign:reactivation_2026_10` x analises/assinaturas depois de 06/10 00:42 UTC) e as respostas em `vinicius@tickrify.com`. Reenviar os 5 recusados depois de rodar o SQL que tira a marca deles (entregue no chat em 05/10). Decidir o plano da Resend: gratis = 100/dia; Pro (US$ 20/mes) tira o limite diario. | Claude / dono |
| 05/10 | **Ligar no /admin** a chave `EMAIL_CHECKOUT_WINBACK` (reativacao de checkout, texto aprovado pelo dono em 05/10; `EMAIL_SECOND_ANALYSIS_NUDGE` ja foi ligada por ele). Depois conferir no Render `[lifecycle] kind=checkout_winback ... sent=1` e `kind=second_analysis ... sent=1`. | dono |
| 05/10 | **Decidir `allow_promotion_codes` no anual/semanal.** Sem desconto pre-aplicado a Stripe abre o campo de codigo: quem DIGITAR EARLY35 (ou EARLY50) no anual pode receber o desconto, conforme a configuracao do codigo na Stripe. Fechar o campo nesses ciclos tambem fecha o codigo de afiliado digitado. | dono decide, Claude implementa |
| 05/10 | PostHog: dashboards que usam `feature_opened` passam a usar `$pageview` com `$pathname` (`/dashboard/trades`, `/journal`, `/strategy`); os que usam `upgrade_modal_viewed trigger=locked_value` passam a `upgrade_cta_viewed source=paywall` (por `surface`). Novo: `acquisition_source_answered` e a propriedade de pessoa `acquisition_source`. | dono / Claude |
| 05/10 | Medir 7 dias depois do deploy: 402 `free_quota_exhausted` por rota, `upgrade_cta_viewed` por `surface`, `checkout_started` com `surface`, erros `removeChild` no Sentry com `page_translated=yes` (devem sumir do painel). | Claude |
| 05/10 | **R/R guard: decidido (dono delegou em 05/10).** NAO mudar agora. Motivo: os numeros de 30/09 misturam prompts (v10/v11 davam 80% WAIT; o v7.5, `promptVer` 12, da 35%) e a unica faixa positiva (TP1 >= 1,5R, n=40) tem intervalo de 26% a 55%, que ainda inclui expectancy negativa; travar em 1,2R viraria WAIT ~57% dos planos e voltaria ao WAIT de ~70%, o que derrubou a ativacao em setembro. Regra: em **19/10** (ou quando o `promptVer` 12 tiver 60 trades WIN/LOSS) rodar a expectancy por faixa de R do TP1 so no 12; se abaixo de 1,2R continuar negativa com n >= 30, mudar o guard para "TP1 >= 1,2R" e medir WAIT% e ativacao por 7 dias. SQL: `select case when (result->>'riskRewardTp1')::numeric < 1.2 then '<1.2' when (result->>'riskRewardTp1')::numeric < 1.5 then '1.2-1.5' else '>=1.5' end faixa, count(*) n, round(100.0*avg((outcome='WIN')::int)) win from tickrify."Analysis" where "promptVer"=12 and outcome in ('WIN','LOSS') group by 1;` **Rodado em 19/10 (SQL do dono, WIN/LOSS do sweeper):** v12 <1,2R n=20 75%; 1,2-1,5R n=35 54%; >=1,5R n=141 23% (o UNICO negativo, ~-0,2R estimado). v13 (v7.6) n=28: >=1,5R ainda 23 de 28 (17%), <1,2R 4 (50%). Pela regra combinada: guard NAO muda (faixa <1,2R positiva e n<30). Stop antes da invalidacao: 16 trades, 25% x 33% dos outros 208, n<30: segue so medindo. Achado: a v7.6 nao aproximou o TP1 em producao (82% ainda >=1,5R); refazer com n>=30 na v13, com expectancy real por trade. Expectancy REAL por trade (19/10, mesmo SQL do dono): v12 cripto >=1,5R n=40 18% -0,49R; ouro >=1,5R n=87 29% -0,05R; ouro 1,2-1,5R n=22 +0,37R; ouro <1,2R n=15 +0,44R. Cuidado: faixa e escolha do modelo (selecao); a re-simulacao de 12/10 com as MESMAS entradas e stops mostrou ganho pequeno ao aproximar o TP1 (ouro +0,17 -> +0,18R; cripto -0,21 -> -0,02R em 0,8R), entao a diferenca entre faixas nao e so do alvo. v13 ouro: n=20, ~-0,37R ponderado (v12 ouro ~+0,08R); pela regra de 13/10, se ouro na v13 seguir abaixo de 0R com n>=30, voltar a v7.5 (decisao do dono, mexe no prompt de producao). Cripto TP1>=1,5R (19/10, 44 trades v12 com candles de 1m em `_local/analise-tp1/`, sem custo): 26 LOSS, 14 nunca passaram de +0,5R, so 4 chegaram a +1R, mediana de 20 min ate o stop: a falha e direcao/momento da entrada, nao o alvo (alvo mais perto salva no maximo 4). Distancia da entrada NAO e padrao robusto: em velas de 30m pareceu (longe -0,58R x perto -0,06R), em velas do TF do grafico inverte, e no ouro a entrada fora do ENTRY REACH rende +0,39R (n=53): impor por codigo pioraria o ouro. Sem o texto da analise (result) desses trades nao da para achar padrao de raciocinio; proximo passo e o export por SQL (gratis) e a classificacao offline. **Export feito (19/10, 79 analises cripto v12/v13 com texto, `_local/Supabase Snippet Risk_Reward Tier Breakdown by Prompt Version.csv`):** padrao comprovado = filtro de liquidez AGAINST -> o modelo poe a limit ANTES da liquidez com 'only after sweep/rejection' e o stop logo alem dela (a varredura enche a ordem e bate o stop): TP1>=1,5R com AGAINST 2 de 22 (9%, Wilson 3-28%, empate em 28%), -0,69R; 24 de 36 AGAINST tem a frase contra 5 de 34 IN FAVOR. Pela regra `limit_needs_confirmation` (definida ANTES de ver esses resultados): marcados 2 de 19 decididos, -0,66R x -0,10R dos outros 35; v13 0 de 2. Correcao local: chave `ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD` (padrao DESLIGADO) em `signal-decision.ts`: so cripto, a marca vira WAIT (niveis mantidos, motivo `limit_needs_confirmation`). Replay offline v12: 26 planos a mais viram WAIT; soma dos decididos -19,2R -> -7,7R, E -0,39 -> -0,25R (segue negativo; o replay nao tem TP2, entao o guard de R/R age a mais nos dois bracos). Ligar = decisao do dono (WAIT de cripto sobe muito). **Validacao final (19/10):** os 19 lidos um a um, todos limit com sweep/rejeicao/reclaim exigido; regra usa so `entryType` + `entryCondition` do proprio resultado (nada de candle nem desfecho) e foi fixada as 20:09, antes do export (20:27); a restricao a cripto veio desses dados. Replay limpo (decisoes reais, so tira os marcados, WIN = R do TP1, LOSS = -1, NO_FILL/TIMEOUT fora, sem custos): v12 -15,9R -> -3,4R; metades -7,3 -> 0,0 e -8,7 -> -3,5; v13 -2,4 -> -0,4. 16 de 19 sao BTC, varios no mesmo dia/nivel. Ouro/forex/indices/PAXG/XAUT nunca viram cripto; BTCUSDm (Exness) tambem nao (guard nao age nele). Chave invalida cai no padrao desligado; rollback pelo /admin vale em ate 60 s, sem deploy. Ligado, o sweeper marca esses WAIT como ABSTAIN: o desfecho contrafactual so sai por script offline com os niveis guardados. Pronto para decisao (19/10): `isCryptoSymbolForGuard` (so o guard usa) aceita sufixo de corretora (BTCUSDm, BTCUSD.pro, ETHUSD-P); ouro/forex/indices com sufixo seguem fora (testado). Ligar/desligar: /admin > Configuracoes avancadas, ou `PATCH`/`DELETE /api/admin/flags/ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD`; vale em ate 60 s por instancia. 1143/1143, tsc e eslint limpos. Consultas de acompanhamento (Q1 WAIT/ativacoes/falso positivo, Q2 expectancy realizada pelo `outcomeDetail`, Q3 WAITs do guard para pontuar offline, Q4 nova analise em 24h depois de WAIT cripto) validadas no Supabase em 19/10 so com leitura, data de teste 19/10: linha de base 05 a 18/10 = ~5 analises cripto/dia, 57 planos, 37 decididos, -0,35R (igual pelo riskRewardTp1: niveis do sweeper batem), 17 WAIT cripto com 11 (65%) novas analises em 24h; colunas do guard 0 em todos os dias. | dono decide / Claude |
| 30/09 | Medir a tabela "48 hours later" da home (`/api/ai/public-analyses/scored`): cliques para `/accuracy` e `/try` a partir de `#reads`. Hash diario publico das analises (repo publico ou OpenTimestamps) ainda nao feito. | Claude |
| 29/09 | Primeiros envios dos e-mails de ciclo de vida: conferir no Render (`[lifecycle] kind=... sent=1`) e na Resend que sairam e se alguem respondeu em `vinicius@tickrify.com`. | Claude |
| 29/09 | Teto de 10 analises gratis: MANTIDO de proposito. A barra do WAIT (29/09) empurra a pessoa a tentar outro grafico ate achar um BUY/SELL; baixar o teto agora cortaria justamente isso e mandaria ao paywall quem nunca viu um plano de trade. Reavaliar com os 7 dias de `wait_nudge_clicked`: se a 2a analise subir e mesmo assim poucos esgotarem, testar 6. | Claude |
| 29/09 | Medir 7 dias depois do deploy: `wait_nudge_clicked / wait_nudge_viewed`, 2a analise de quem tomou WAIT na 1a (era ~50%), `upgrade_video_played`, `checkout_started source=upgrade_modal`, `$pageview` com `$lib=tickrify-static` por `$pathname`. | Claude |
| 28/09 | **Afiliados: configuracao manual na Stripe antes de divulgar.** (1) Criar cupom 10%, `duration: once`, e pôr o id em `STRIPE_AFFILIATE_COUPON_ID` no Render (sem ele: sem desconto para indicado e sem promotion code; a comissao funciona igual). (2) Marcar `charge.refunded` e `charge.dispute.created` no endpoint do webhook. (3) Afiliados que entraram ANTES do (1) ganham o codigo sozinhos no proximo boot (`syncMissingPromotionCodes`, 13/10; log `[affiliate] Codigos na Stripe criados no boot`). Lido na Stripe em 13/10: NAO existe cupom de afiliado (so TICKS, EARLY35, TEST100, EARLY50, dev.cupom); os 2 afiliados ativos (HEARA4U6, F29P59JJ) estao sem codigo. Conferir no boot log `[affiliate] Tabelas prontas. Cupom da Stripe: configurado`. | dono |
| 05/10 | Acompanhar o acerto do `promptVer` 12 (v7.5) contra o 10/11 quando houver amostra: `select "promptVer", count(*) filter (where outcome='WIN') win, count(*) filter (where outcome='LOSS') loss from tickrify."Analysis" where outcome in ('WIN','LOSS') group by 1 order by 1;`. O WAIT% caiu para o limite de baixo do alvo; se o acerto do 12 cair, a alavanca e a decisao do R/R guard (30/09), nao o prompt. | dono roda, Claude le |
| 24/09 | Comentario do `schema.prisma` diz que a imagem "nao e mais salva": errado, a print e salva no Supabase Storage. Corrigir na proxima mudanca de schema. Evento candidato no funil: `trade_result_logged`. | Claude |
| 21/09 | **GitHub Actions parado** ("recent account payments have failed or your spending limit needs to be increased"). Diagnostico de 12/10: NAO e cartao; e a cota gratis do repo privado (2.000 min/mes) esgotada em outubro pelo CI que rodava ate 6h (29/09 a 05/10, ~1.700 min de relogio x 6 jobs). Volta sozinho na virada do mes; ate la o portao e o `pre-push` (secao 1.3). Desde 12/10 todo job tem `timeout-minutes` e o CI cancela a execucao anterior. Conferir em novembro se CI, `calendar-mirror` e `backup` voltaram. Ultimo backup valido: 16/09. | dono / Claude |
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
- **05/10 (rastreio ponta a ponta confirmado):** caminho de uma pessoa no PostHog por e-mail: `select distinct person_id from events where person.properties.email = '<email>'` e depois os eventos por `person_id` (HogQL pela API, ver linha do funil). Exemplo real (1o assinante semanal): /try em 03/10 -> cadastro pela demo -> 2 analises (WAIT com a barra) -> volta em 05/10 -> esgota o gratis -> e-mail de recuperacao (Resend) -> volta 4h depois -> paywall -> checkout semanal -> pago em 2 min -> 4 analises pagas no mesmo dia. `checkout_completed` (servidor) tem como timestamp a hora do evento `checkout.session.completed` (conclusao real, `event.created`) e guarda a criacao da sessao em `sessionCreatedAt`; implantada em 20/10/2026 (commit ad59367, Render); nos eventos gravados ate essa data o timestamp e a criacao da sessao e aparece ANTES do `checkout_started` do navegador. Lacunas: visita anonima sem aceite de cookie em dias diferentes nao se liga; dentro da pagina da Stripe so vemos inicio, pagamento, recusa e cancelamento; abertura/clique de e-mail nao vai ao PostHog.
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
- **07/10 (extensao no ar para o dono):** `CORS_ORIGINS` e `CLERK_AUTHORIZED_PARTIES` no Render, `allowed_origins` e "Native API" no Clerk; 1a analise real (EURJPY 5m SELL, linhas no lugar). Depois, a pedido dele: paleta do site, painel SO em ingles (o portugues era a conversa), precos copiaveis, linhas ficam no clique parado. A suite achou 2 bugs que cobrariam 2 vezes (trava solta pela analise velha; "comecar" atrasado) e o 1o clique perdido na Binance; corrigidos (3.7, regras 6 a 8).
- **07/10 (cripto, desistido):** passe pre-pago em cripto via NOWPayments foi implementado e publicado (commit `6698806`) e REMOVIDO no mesmo dia por decisao do dono: a assinatura continua so pela Stripe. Nunca foi ligado (sem chaves), nenhum pagamento. Motivo da ideia, se voltar: nos paises emergentes 8 de 8 recusas desde set/26 foram do BANCO (Stripe/Radar nao bloqueiam nada; Radar so com regras padrao). Pesquisa: Stripe Crypto nao atende conta BR; Coinbase Commerce fechou fora de US/SG; NOWPayments serve, mas o repasse em USDT TRC20 pode custar varios dolares por pagamento (usar rede barata). Desenho e demo em `_local/cripto/`.
- **12/10 (setups, Parte A):** seguir um setup a partir de qualquer analise e atualizar com o fluxo normal de nova analise (versoes em `/dashboard/setups/:id`, secao no topo do inicio); tabela `TrackedSetup` + `Analysis.setupId` por SQL, testado num Postgres descartavel (30 casos: dono, idempotencia, teto, clique duplo, cursores, ordem das versoes).
- **12/10 (chat, Parte B):** chat com o fundador dentro da bolha do painel (aba padrao), aba Chat no /admin com "Start conversation" pelo e-mail, avisos por e-mail com teto (chave `CHAT_EMAIL_NOTIFY` desligada); /privacy cita as mensagens do chat. Testado num Postgres descartavel (37 casos: isolamento, texto puro, limite por hora, nao lidas, tetos de e-mail com relogio falso, descadastro).
- **12/10 (testes em producao):** setups e chat testados logado no Chrome do dono (seguir, atualizar com print novo cobrando 1 tick, versao 2 no setup, arquivar, chat ida e volta com nao lidas, /admin, 375 px). Achados corrigidos: condicao do WAIT tambem do `alternativeScenario` e "First analysis" com a data da 1a analise (nao a de seguir).
- **12/10 (motor 2.0.0):** medicao por etapa no `analysis_completed`, contrato v2 em `result.engine`, validador do plano com testes, chamada ao modelo isolada em `VisionModel`, `streamAnalyzeImage` (morto desde 21/09) removido. Linha de base PostHog (30 dias, `symbol` so existe desde 30/09): 347 analises com ativo, ouro 59%, cripto 28%, forex 7%, indices sinteticos 4%, indices 1%, acoes 0.
- **12/10 (limpeza do git):** 4 worktrees (3 do Codex, 1 do Claude), 7 branches locais ja contidas no `main` e os 2 stashes (seguranca 28/09 e My Trades 24/09, ambos ja no `main`) removidos; backup dos diffs em `_local/limpeza-2026-10-12/`. Do worktree do Codex `analysis-funnel-count` (28/09, nunca commitado) entrou so o `analysisNumber` contando WAIT (3.4); os scripts do piloto de analise (`analysis-pilot-*`, `analysis-checklist-candidate`) ficaram so no backup. Frontend, setups e chat confirmados em producao (bundle e rotas respondendo). Em 13/10: 12 branches remotas ja contidas no `main` apagadas do GitHub; Docker sem o staging de 01/10 (7 conteineres `supabase_*_tickrify-staging-20261001`, 2 volumes, 2 imagens) e sem cache de build (9,2 GB). Restou so a branch `claude/blissful-heisenberg-dwasmg` (6.2).
- **13/10 (provedor de IA):** camada unica `vision-model.ts` com OpenAI ativa, Anthropic pronta e inativa, contingencia, modo comparacao desligado e nova tentativa unica quando a checagem por codigo falha (ver 3.2). Nao existe chat com IA no produto (o chat e com o fundador), entao nao ha historico de chat a limitar.
- **13/10 (trial):** trial de 3 dias sem cartao implementado atras de `TRIAL_MODE` (3.10). Diagnostico de 22/09 a 13/10 (PostHog, 194 cadastros): 0 analises 16%, 1 = 35%, 2 = 20%, 3 = 15%, 4+ = 14%; de quem analisou, 16% voltou em outro dia (UTC) e 2% em 3 dias; mediana de 1 min entre cadastro e 1a analise (157 de 162 na 1a hora); o assinante semanal pagou ~39h depois do cadastro (3o dia do calendario) e renovou em 12/10.
- **13/10 (operacao):** estado da operacao, pergunta de acompanhamento e modo gerenciamento (3.11).
- **13/10 (paginas do rodape):** blog, /for e /tools (22 paginas estaticas) com o visual da landing via `public/site.css` (sai o verde neon, o logo em texto e as fontes Fraunces/JetBrains); cabecalho e rodape iguais aos do site; 229 travessoes trocados por virgula, dois pontos ou ponto; tabela "48 hours later" da home e aviso de risco sem travessao. As paginas React do rodape ja usavam o `SiteLayout`.
- **13/10 (vitrine factual):** "cancel in one click" virou "anytime in Settings" (home, /pricing, meta, 6 idiomas); /pricing ganhou "How do I cancel?"; post how-tickrify-works sem "3 free"; vs-chatgpt e best-tools sem "not aware of another tool"; llms.txt com calendario, print velho, sentimento so em cripto, sem score de confianca, hit rate != lucro; robots.txt so com comentario em ingles. Diagnostico das IAs: o "75% de perda" mais provavel e (LOSS + NO_FILL) / (WIN + LOSS + NO_FILL) da tabela crua da /accuracy (172/233 = 73,8%); nenhuma versao publicou acerto perto de 25%.
- **13/10 (cancelamento, afiliados, tema):** Configuracoes com assinatura e portal da Stripe por API, reativar, eventos de cancelamento, ex-assinante em modo leitura, aba Cancelamentos; afiliados com clique deduplicado, eventos, cookie do vinculo, vendas pagas e "Marcar como pago"; tema claro na area logada com tokens (361 cores soltas trocadas). Ver 3.12.
- **26/10 (concorrencia):** checagem de operacao e demo com reserva atomica antes da IA (trabalho do Codex revisado + pausa da demo), `96ebbfc`/`557afbc` Live 01:38 BRT; aberto pelos CLIs as ~09h com `active=[]`/`pending=0`. Conciliacao (deficit liquido por usuario+analise, historico inteiro): 1 par, 2 debitos x 2 resultados pagos, deficit 0, nada a compensar. Antes disso ja estavam no ar `6d1ed51` (body-parser 2.4.0), `26d45be` (Vercel com lockfile congelado) e `d1d10c5`/`92fe994` (assinatura). SQL de deficit e de compensacao (chave unica `compensation:trade_check:<user>:<analysis>:v1`) no historico da sessao, nao executar compensacao sem o dono.
- **26/10 (confluencia, `80910da`, Codex, Live 13:10 BRT):** checklist completo de 7 itens decide `factorsPresent` E `confluenceScore` (inclusive 0 de 7); antes so corrigia quando o total divergia. Roda so em analise nova (adapter); historico intocado. Prompt de producao segue v13 (v7.6): o pacote de prompt do Codex (mexe em `trading-system-prompt.ts`: MTF observado x inferido, ordem stop/limit como colocacao manual, checklist so 7 itens) NAO foi publicado: A/B de 25/10 (10 prints x 2 repeticoes, US$ 0,13) deu INCONCLUSIVO. Candidata zerou 3 CHoCH falsos e 2 erros de R/R do texto, mas virou WAIT em 6 de 20 decisoes (BUY/SELL/WAIT 7/12/1 -> 6/8/6), com 3 regressoes factuais novas e mesma estabilidade (8/10). Diff guardado em `_local/backup-worktrees-20261026/quality-package-20261025.diff`. Nao publicar sem nova medicao com amostra maior.
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
