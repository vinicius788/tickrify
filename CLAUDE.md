# Tickrify — Contexto para o Claude

> Leia este arquivo no início de cada sessão. É a fonte única de verdade sobre a plataforma, decisões e estado atual.

## O que é
Tickrify — SaaS freemium de **análise de gráficos com IA** para traders. O usuário sobe/cola o print de um gráfico → a IA devolve uma leitura estruturada: **entry, stop, targets, confidence, confluence, risco e cenários**. North Star = **assinantes pagos / MRR**. Free tier = **3 análises grátis**, depois paywall.

## Mercado / posicionamento
- **Global / Inglês** (decidido jun/2026). Idioma padrão do site = **inglês**; PT/outros via seletor (lembra a escolha no navegador).
- Voz: direta, anti-hype. *"A second opinion that confirms or kills your read."* Não é sinal. A decisão é sempre do trader.

## Stack
- **Frontend:** Vite + React 19 + Clerk (auth) + React Router 7 + TanStack Query → **Vercel** (projeto `tickrify-frontend`, domínio tickrify.com).
- **Backend:** NestJS + Prisma → **Render** (serviço `tickrify`, API em https://tickrify.onrender.com, plano free que **hiberna**). Worker + **Redis** (BullMQ). DB **Supabase** (Postgres).
- **Pagamento:** Stripe. Monorepo **pnpm** (`apps/frontend`, `apps/backend`).
- **i18n:** `apps/frontend/src/lib/i18n/{pt,en,es,fr,de,ja}.ts`. Padrão `'en'`. O tipo vem de `pt.ts`.
- **Analytics:** PostHog (funil) + Sentry (frontend). Eventos: `landing_view, pricing_viewed, signup_started/completed, analysis_started/completed{analysisNumber 1/2/3}, analysis_failed{code}, free_limit_reached{reason}, upgrade_modal_viewed{trigger}, upgrade_clicked, checkout_started, subscription_activated`.

## Restrição de workflow (IMPORTANTE)
- **Repo local: `~/dev/tickrify`** (migrado pra fora do iCloud em 10/07/2026 — o iCloud descarregava arquivos e travava git/Cursor, e chegou a corromper o `.git/index` em 08/07). No Cowork/Claude, conectar a pasta `~/dev/tickrify`. Backup antigo em `~/Documents/tickrify.com-OLD` — apagar após 17/07/2026.
- Máquina local lenta (disco/iCloud cheio) → **builds locais inviáveis**. Fluxo: **Claude edita o código → usuário roda `git add/commit/push` → Vercel/Render buildam remoto → acompanhar build pelo navegador**.
- **Evitar dependências novas** (lockfile não atualiza local).
- Frontend = seguro. Backend = crítico; no sandbox só dá pra **checar sintaxe** (não tipos completos). Build do Render que falha **não derruba** o app (mantém a última versão boa).
- Às vezes aparece `.git/index.lock` travado → corrige com `rm -f .git/index.lock`.
- **Nunca manusear chaves/segredos** (o usuário cola direto no Render/serviço).

## Modelo de monetização
- **PLANO ÚNICO desde 27/07/2026: US$ 19/mês (ou US$ 190/ano) com 200 ticks mensais.** Substituiu os 3 tiers (Starter $12 / Pro $29 / Elite $59), que diferiam APENAS em volume — mesma fila, mesmo modelo, mesmo suporte. O Starter a $0,267/análise era mais caro que o pacote avulso ($0,20): assinar era o pior negócio da loja. Agora $0,095/análise, metade do avulso mais barato.
  - No Stripe o valor foi **editado no objeto existente** (`Starter-usd` = `price_1TRvEJB1hl0IoocUvbCyxkt5`), então o price ID NÃO mudou. `pro` e `elite` seguem em `stripe.config.ts` como LEGADO — não apagar, assinaturas antigas resolvem por eles.
  - Checkout sempre em **USD** (o frontend força). BRL/EUR do Starter ficaram nos valores antigos e estão dessincronizados — irrelevante hoje, cuidado se ligar multimoeda.
- **"Ticks"** = créditos internos (nome pra casar com a marca). Análise rápida = 1 tick, profunda = 3 ticks, PDF = 2 ticks.
- Free tier: 3 análises (só rápida — a profunda é travada pra assinante via `allowHigherTimeframes`).
- Na UI, falar em **"analyses"** (manter "ticks" só como unidade de billing, deixando claro).
- Cupom **EARLY50** = 50% no 1º mês.

## O que JÁ ESTÁ NO AR
- Site 100% em inglês (padrão).
- Copy de conversão afiada (hero, CTA, mensagens de limite) em `en.ts`.
- **Paywall de valor trancado:** free user na 4ª análise → preview borrado + cadeado + "Unlock analysis" (`components/dashboard/LockedAnalysis.tsx`); dispara `free_limit_reached` + `upgrade_modal_viewed{trigger:'locked_value'}`.
- **E-mail de boas-vindas** via Resend: `apps/backend/src/modules/mail/` (MailModule global + MailService com `fetch`, sem dep nova). Disparado em `auth.controller` (`GET /api/auth/me`, no branch de usuário novo). `RESEND_API_KEY` configurada no env group do Render.
- **Ping anti-cold-start:** `.github/workflows/keep-warm.yml` dá ping em `/api/health/live` a cada 10 min.
- **Prompt v7.3 (13/07/2026):** calibração de confiança (bandas 62–78, >70 raro, confiança = probabilidade de TP1 antes do SL) + checklist com evidência obrigatória + entry alcançável (~1,5 ATR). Motivado pelo backtest (abaixo).
- **UI de tier de convicção (13/07/2026):** chip ao lado do BUY/SELL — conf <70 = "Read" (leitura, tooltip explicativo), ≥70 = "Signal". `getConvictionTier()` em `lib/trading-ui.ts`; i18n nas 6 línguas. Limiar 70 medido no backtest.

## Backtest do motor (13/07/2026) — régua objetiva
- **Pipeline reprodutível em `scripts/backtest/`** (README lá dentro): dados Binance (BTC/ETH 30m+4h, 12m) + Twelve Data (XAU/EUR; 30m só 60d), amostragem cega seed 20260713, render matplotlib estilo TradingView, runner com motor real (`apps/backend/scripts/backtest-runner.ts`, flags `--limit/--every/--ground/--out`), avaliação com Wilson/calibração/expectancy. Custo ~US$1/100 análises; API roda no terminal do usuário.
- **Resultados v1 (prompt v7.2, 300 análises):** win rate 45,3% (IC 35–56), expectancy +0,02R, WAIT 68%, confiança "75" fixa (sem informação). Relatórios locais (gitignored): `Tickrify_Backtest_Report*.md`.
- **v2 (v7.3 + grounding, 150 pareadas):** win rate bruto não melhorou (~37%), mas a confiança passou a DISCRIMINAR: conf 60–70 → 25% real, conf ≥70 → 56% real. Daí o limiar 70 na UI.
- **⚠️ PRODUÇÃO NÃO REPRODUZ ESSA SEPARAÇÃO (medido 27/07/2026, n=103 outcomes conclusivos):** conf 60–69 → 36,8% (IC 23,4–52,7) vs conf ≥70 → 38,5% (IC 27,6–50,6). Os intervalos se sobrepõem quase inteiros — no tráfego real o score de confiança **não prevê nada** até agora. A página `/accuracy` publica isso explicitamente em vez de esconder. Se a separação não aparecer com amostra maior, quem muda é o score, não a página.
- **Regras:** nenhum número vai pra marketing sem decisão explícita + metodologia + disclaimer. Posicionamento validado: "second opinion, not signals".
- **Backlog barato:** testar grounding isolado (~US$0,75), testar deep/gpt-4o vs mini (~US$4), ampliar amostra XAU/EUR 4h.

- **Grounding do quick (NO AR — commits 2e97324/bf2c0f5, 17/07/2026):** `AIAdapter.buildQuickGrounding` injeta candles reais no prompt (OKX primário — Binance bloqueia IP dos EUA/Render —, Binance fallback, XAU/EUR via Twelve Data se `TWELVE_DATA_API_KEY` no env) + contexto do MarketService. Flag `ENABLE_QUICK_GROUNDING` — **decisão consciente do dono: ligar em produção SEM backtest prévio** (tráfego ~0, kill-switch disponível, outcome tracking mede de graça). PENDENTE confirmar `=true` no env group do Render + linha `[QuickGrounding]` no log do tickrify-worker após análise de teste. Matemática idêntica ao `--ground` do runner.
- **Outcome tracking (NO AR — commit 2e97324, 17/07/2026):** `worker/outcome.sweeper.ts` + migração `20260716120000_analysis_outcome` (campos `outcome/outcomeAt/outcomeDetail` no Analysis). A cada 1h avalia análises completadas há 48h+: fill no entry → corrida TP1×SL em candles 30m (regra idêntica ao `evaluate.py`; mesmo candle TP+SL = LOSS). Outcomes: WIN/LOSS/TIMEOUT/NO_FILL/ABSTAIN/INCOMPLETE/UNTRACKABLE. Lotes 25/h com backfill. Kill-switch `ENABLE_OUTCOME_TRACKING='false'`. Com ~30–50 outcomes: calcular win rate real de produção (separar com/sem grounding pela data do deploy). Cria o dataset proprietário; depois expor "taxa de acerto histórica" na UI.
- **v7.4 (playbooks) segue LOCAL, não commitada** — `trading-system-prompt.ts` + `backtest-runner.ts` (strategyLine) + `evaluate.py`. Só sobe depois de medir (teste ~US$1,50). Pro teste de grounding isolado: `git stash push -- apps/backend/src/common/prompts/trading-system-prompt.ts` antes (volta pra v7.3), `git stash pop` depois.
- **19/07/2026 — grounding LIGADO em produção + incidente de migração resolvido:** `ENABLE_QUICK_GROUNDING=true` e `TWELVE_DATA_API_KEY` adicionadas no env do Render. Na sequência descobriu-se produção quebrada (P2022: colunas outcome/outcomeAt/outcomeDetail não existiam — a migração nunca rodou porque `RUN_MIGRATIONS_ON_START=false`, e ligar não resolve: `prisma migrate deploy` falha com P1001 porque `MIGRATIONS_DATABASE_URL` aponta pro host direto do Supabase, IPv6-only, inalcançável do Render). Correção: SQL da migração aplicado manualmente no SQL Editor do Supabase + INSERT no `public._prisma_migrations` com o checksum correto (sha256 do migration.sql). `RUN_MIGRATIONS_ON_START` voltou pra `false`. **REGRA: toda migração nova precisa ser aplicada manualmente no Supabase (SQL Editor) + registrada no `_prisma_migrations`, OU corrigir de vez `MIGRATIONS_DATABASE_URL` pro session pooler IPv4 do Supabase (aws-0-<região>.pooler.supabase.com:5432).**

## Sprint 20–21/07/2026 (tudo NO AR salvo indicação)
- **Migrações consertadas:** `MIGRATIONS_DATABASE_URL` no Render trocada pro session pooler IPv4 (`postgresql://postgres.xobqgbqemqsooabdwprg:<senha>@aws-0-us-west-2.pooler.supabase.com:5432/postgres`). `prisma migrate deploy` volta a funcionar do Render — fim do SQL manual. (Região real do Supabase = **us-west-2**, não sa-east-1.)
- **E-mails 100% funcionando:** domínio Resend verificou sozinho em 10/07 (DNS propagou); `MAIL_FROM=Tickrify <noreply@tickrify.com>` setado no Render. **Causa raiz dos e-mails que nunca saíam:** o session token do Clerk NÃO traz e-mail → `User.email` ficava NULL. Fix: `common/utils/clerk-email.ts` (busca na API do Clerk) + backfill no `auth.controller` (getMe) e no gatilho de recuperação.
- **E-mail de recuperação LIGADO:** `ai.service.triggerRecoveryEmail` dispara quando o free bate o limite; dedup permanente via `AdminAudit` (`action='recovery_email_sent'`, sem migração). Cupom do e-mail = **EARLY35** (35% 1º mês, confirmado vivo no Stripe 0/50; EARLY50 expirou em jun).
- **"What would change my mind"** no `AnalysisResult` para WAIT/HOLD (chaves i18n `flip*`): compõe entryCondition/alternativeScenario/invalidation/whyNotOpposite — SÓ campos que o motor já devolve, zero mudança de prompt. Confirmado no ar.
- **Calendário Econômico:** já estava implementado no `AnalysisResult` (accordion "Economic Events"); corrigido o bug de strings hardcoded em PT → 6 línguas (chaves `cal*` em `analysis.result`).
- **Blog SEO** em `apps/frontend/public/blog/` (4 artigos EN + índice) + `sitemap.xml` reenviado no Search Console (8 páginas encontradas). Marketing, não commitado no motor.
- **Heatmap de consistência** (`components/dashboard/ActivityHeatmap.tsx` + endpoint `GET /api/ai/activity` em ai.controller/ai.service): grade estilo GitHub dos últimos ~119 dias + streak atual/recorde. Mecânica de hábito + card "printável" pra conteúdo. i18n `heat*`. NO AR.
- **Backup diário do banco:** `.github/workflows/backup.yml` — pg_dump 07:00 UTC + manual, artifact privado 30d, sem 2º repo. Secret `SUPABASE_DB_URL` (= a string do pooler) no GitHub. Testado verde. Plano free do Supabase não tem backup — isto protege o dataset de outcomes.
- **Grounding do quick turbinado (21/07):** `buildCandleGroundingBlock` agora injeta **RSI(14) Wilder + posição no range (0–100%) + momentum ~6 candles**, tudo dos candles reais já buscados (zero API/dep nova), cada um com instrução de humildade (RSI extremo ≠ gatilho de reversão sozinho). Atrás da mesma flag `ENABLE_QUICK_GROUNDING`. Medir via outcome tracking; próximo candidato de indicador = **contexto HTF multi-timeframe** (maior salto, `extraImageUrls` já existe).

## PENDENTE (pós-sprint)
- **Post 0 do relançamento de conteúdo** (só o dono grava) — kit pronto em `marketing-sprint/` e docs de estratégia. Estratégia nova = "The AI With Receipts" (SEG call / QUA your-chart / SEX receipt, 3x/semana).
- **Render pago (~US$7):** decisão do dono — NÃO assinar até o Post 0 ir ao ar (cold start só machuca com tráfego). Gatilho: dia do 1º short OU 1º assinante.
- ~~Confirmar `[QuickGrounding]` no log do worker~~ — **resolvido em 27/07**: `ENABLE_QUICK_GROUNDING=true` conferido no env do Render, e `TWELVE_DATA_API_KEY` está lá. (A linha `[QuickGrounding]` em si não aparece porque **nenhuma análise rodou em produção nos últimos 7 dias** — não é bug, é falta de tráfego.)
- ~~Conta Stripe chamada "WayPay"~~ — **resolvido**: a conta já se chama `tickrify` (verificado no dashboard em 27/07). Falta só conferir o *statement descriptor* (nome na fatura do cartão), que é campo separado.
- **v7.4 (playbooks)** continua fora da árvore (backup em `tmp/v74-playbooks-backup/`); medir ~US$1,50 antes de subir.

## Distribuição / conteúdo
- **Estágio zero** (≈0 seguidores em tudo, jun/2026): IG @tickrify 53 seguidores (reels 1–2k views), YouTube 0 inscritos / 4,5k views em 28d, X @tickrify 4 seguidores (parado).
- Diagnóstico: **alcance funciona; o vazamento é view → clique → cadastro.** Gargalo = tráfego, não conversão. **Medir primeiro.**
- Conteúdo: **faceless** (só mão + tela), **texto em inglês na tela** (fundador não fala inglês). 1 short/dia → repostar IG Reels + YT Shorts + TikTok. X depois Reddit. **UTM por canal**.
- Vídeo de demo com cara premium: gravar no **Cursorful/Screen Studio** (auto-zoom); estilo flashy via **template do CapCut**.

## Arquivos de entrega nesta pasta
- `Tickrify_Manual_Completo.pdf` (estratégia + funil + execução + conteúdo)
- `Tickrify_Site_Copy_EN.md` (copy do site em inglês, com tradução)
- `P4_copy_conversao.md` (copy das telas de conversão)
- `Tickrify_Demo_16x9_HD.mp4`, `Tickrify_Demo_9x16_HD.mp4`, `Tickrify_Demo_9x16_v2.mp4` (vídeos de demo)

## Sprint 27/07/2026 — auditoria de claims (Fases 0, 1, 2, 5 do plano de correção)

**Princípio que governou tudo:** toda afirmação da vitrine precisa ser verdadeira ou verificável, porque a página `/accuracy` depende de a casa estar limpa. Commits: `1c209fa`, `ab4d36b`, `15a7f78`, `82373a1`.

### Fase 0 — dados fabricados removidos
- `RecentAnalysesSection`: array `FALLBACK` com 6 análises inventadas (preços defasados: BTC 104.500, XAU 3.310) **apagado**. Loading → skeleton; erro de fetch ou <3 análises reais → `return null`.
- `RecentTickerSection`: esteira 100% hardcoded (com uma confiança de 87%, impossível no motor) trocada por dados reais.
- Hook novo `useRecentPublicAnalyses` (TanStack Query, `staleTime` 60s) compartilhado pelas duas seções → uma requisição por carga.
- `GET /api/ai/public-analyses` ganhou `isDemo: false` — análises da demo anônima estavam vazando pra vitrine.
- **Regra permanente:** sem dado real, a seção não aparece. Nunca inventar para preencher.

### Fase 1 — claims falsos corrigidos (6 idiomas)
- Card **"2:1 validated minimum R/R · on every signal generated"** → morto. A regra do motor é 1.5, o piso do normalizador é 1.2, o R:R médio medido foi 1.19, e o guard está morto no adapter. Virou a taxa de abstenção.
- Hero e preview: confiança **80% → 68%** + chip "Read", R/R **2.0:1 → 1.6:1** (números que fecham a conta), badge **`● LIVE` → "Example"**.
- Features: `f5 "Real-time alerts"` e `f6 "Continuous education"` não existiam em lugar nenhum do código → trocados por **live candle grounding** e **economic calendar guard**, que estão no ar e não eram vendidos. Zero cards "Soon".
- Pricing: removidos `Priority responses`, `Priority execution`, `Priority support` (a fila BullMQ não tem campo `priority`) e `Institutional-grade AI` (o modelo é escolhido por tipo de análise, nunca por plano). A palavra "institucional" saiu da vitrine inteira (fica só no `orderBlockTip`, terminologia ICT correta).
- "Ações BR" saiu dos 5 idiomas; bloco `cta` alinhado ao inglês; `landing.how.*` reescrito ("From chart to a second opinion", "Confirm or kill your read") e FAQ `a2` reescrito para admitir o erro.
- `README.md` reescrito (estava em nov/2025, anunciava "Nível Institucional", 7 agentes que não existem no prompt, e deploy no Railway).

### Fase 3.1 — a hipótese do buraco de ativação foi DERRUBADA
Medido no Supabase em 27/07:
- Free users que esgotaram as 3 **sem ver nenhum sinal: 0** (de 4 que esgotaram, de 4 que já analisaram).
- **Abstenção real em produção: 39,4%** (153 WAIT de 388 análises) — não os 72,7% do backtest. P(3 WAITs) cai de 38% para ~6%.
- Motivo provável: o backtest sorteia gráficos às cegas; usuário real sobe print de gráfico em que já viu algo.
- **Conclusão: não mexer no free tier nem devolver tick no WAIT.** O gargalo é que só 4 pessoas na vida completaram uma análise grátis. É tráfego, não ativação.

### Fase 5 — página pública `/accuracy` NO AR
- `accuracy.util.ts` (novo): Wilson 95%, bandas de confiança, lista explícita de outcomes automáticos.
- `GET /api/ai/accuracy` no `ai.controller`, cache em memória de 1h (Render free), sem dep nova.
- `AccuracyPage.tsx` em `/accuracy`, linkada no rodapé (i18n nos 6) e no FAQ. **Texto só em inglês** (regra: texto público é em inglês).
- Números publicados hoje: acerto **37,9%** (IC 29,1–47,5, n=103), abstenção 39,4%.
- Diz em voz alta o que ninguém diz: sem custos de operação, amostra pequena e enviesada, taxa de acerto ≠ lucratividade, e que a calibração não se reproduziu em produção.

### ⚠️ Dois bugs de dados descobertos (não corrigidos ainda)
1. **`Analysis.outcome` mistura duas fontes:** o sweeper grava MAIÚSCULAS (`WIN`/`LOSS`/`ABSTAIN`/...) e o veredicto manual do usuário no My Trades grava minúsculas (`tp1`/`tp2`/`stop`/`open`). São ~8 registros hoje. O endpoint `/accuracy` já filtra, mas **qualquer query nova precisa filtrar também** — ou separar em coluna própria.
2. **O card "16s" da landing continua sem verificação e NÃO dá pra medir pelo banco:** a mediana de `updatedAt - createdAt` deu ~35 dias, porque o sweeper e o `setOutcome` reescrevem `updatedAt` muito depois. Precisa de log do worker ou de um campo dedicado de duração.

### Outros achados
- **As 2 "assinaturas ativas" no Stripe são do próprio dono** (`vm3441896@gmail.com`) — uma ativa, uma cancelando em 06/08. O MRR de R$ 297 no painel é a assinatura Elite de teste dele. **Não há cliente pagante real.**
- **Em 10 dias de grounding no ar, nenhuma análise nova chegou a resolver** (o split antes/depois de 17/07 tem n=0 do lado "depois"). Prova concreta de volume ≈ 0.
- O Prisma Client local está desatualizado (não conhece `outcome`) → `tsc` do backend acusa 7 erros que **não existem no build do Render** (que roda `prisma generate`). Rodar `npx prisma generate` em `apps/backend` para calar localmente.

### O que ficou de fora de propósito
- **Teto de rollover dos ticks** (Fase 2b): hoje acumulam pra sempre e a vitrine promete "Ticks never expire" — o que ainda é **verdade**, então não é claim falso. Mexer em `TicksService` é backend crítico; fazer em commit separado.
- **Fase 4 (teste de modelo)** inteira: o motor roda `gpt-4o-mini`/`gpt-4o`, família de ~2 anos atrás. O harness já aceita `AI_MODEL` por env, o teste custa ~US$3-8, e responde se o teto é o prompt ou o modelo. **A chave da OpenAI é do dono — ele roda o comando.**
- Tradução da `/accuracy` para os outros 5 idiomas.

## ⚠️ INFRA REAL (leia antes de mexer em worker/deploy — 27/07/2026)

**Este bloco existe porque eu (Claude) errei um diagnóstico por não saber disto.**
O dashboard do Render mostra só DOIS recursos: o web service **`tickrify`** e o
**`tickrify-redis`**. Não existe serviço `tickrify-worker`. É fácil concluir daí
que o worker não roda. **Ele roda.**

- O **`render.yaml` da raiz NÃO é o que está no ar.** Ele declara `tickrify-api`
  + `tickrify-worker`, mas o blueprint nunca foi aplicado — o serviço foi criado
  à mão e se chama `tickrify`. Não confie nesse arquivo para entender produção.
- O `Dockerfile` da raiz também **não** é o usado. O Render builda
  **`infra/Dockerfile`**, cujo `ENTRYPOINT` é `infra/docker-entrypoint.sh`.
- Esse entrypoint sobe **três coisas no mesmo contêiner**: a API, as migrações
  (se `RUN_MIGRATIONS_ON_START=true`) e o **worker embutido**:
  ```sh
  if [ "${RUN_EMBEDDED_WORKER:-true}" = "true" ]; then
    npm run worker:prod -w apps/backend &
  fi
  ```
  `RUN_EMBEDDED_WORKER` **não está no env** → default `true` → o worker roda.
  É ele que chama `startOutcomeSweeper`. Prova no log, a cada boot:
  `[Outcome] Outcome tracking ligado (varredura a cada 1h, maturidade 48h).`
- **NUNCA inicie o sweeper em outro lugar** (ex.: dentro do `main.ts`) sem antes
  desligar `RUN_EMBEDDED_WORKER` — dois sweepers no mesmo contêiner fazem
  varredura duplicada. Uma flag `ENABLE_SWEEPER_IN_API` chegou a ser criada em
  27/07 por causa do diagnóstico errado e foi **removida** no mesmo dia.

**Migrações:** `RUN_MIGRATIONS_ON_START=false` no env → o `prisma migrate deploy`
do entrypoint é pulado. Rodar `npm run migrate:deploy` na máquina do dono também
falha (`.env` local vazio → `P1012: Environment variable not found: DIRECT_URL`).
Na prática, **quem mantém o schema em dia hoje é o `ADD COLUMN IF NOT EXISTS` do
`AiService.onModuleInit`**, que roda a cada boot. Isso cobre coluna aditiva e
nada mais — índice, constraint ou rename vão exigir SQL manual no Supabase.

## Sprint 27/07 — parte 2 (fases 6.2, 6.3, modelos e preço)

- **Preço: US$ 29/mês e US$ 290/ano.** Subiu de $19 no mesmo dia, por sinalização
  (a $19 o produto lia como "mais ou menos" num nicho onde barato = suspeito),
  não por custo — a margem bruta é ~88% nos dois. Editado nos MESMOS price IDs
  do Stripe (`price_1TRvEJ...` mensal, `price_1TRvKH...` anual); os IDs nunca
  mudaram nas três edições ($12 → $19 → $29). 0 assinaturas afetadas.
- **6.2 verificado, nada a corrigir:** `normalizedAnalysisType` degrada `deep`
  para `quick` quando `hasPaidAccess` é falso, e é o valor NORMALIZADO que segue
  para `enforceAccessAndCreate` (linhas 242 e 340). Free não queima 3 ticks num
  `gpt-4o`. O débito só ocorre dentro do ramo pago.
- **6.3 FEITO — coluna `userVerdict`:** `outcome` guardava dois fatos que se
  destruíam. O sweeper busca `outcome IS NULL`, então trade marcado à mão nunca
  era avaliado (sumia da /accuracy); e o `setOutcome` fazia UPDATE cru, apagando
  WIN/LOSS já medido. Agora: `outcome` = o que o mercado fez (só o sweeper,
  MAIÚSCULO), `userVerdict` = o que o trader diz (só o `setOutcome`, minúsculo).
  O front não mudou: a API expõe `SELECT "userVerdict" AS "outcome"`.
  Backfill idempotente no `onModuleInit` moveu os 8 registros presos (confirmado
  no log: `[outcome] Backfill: 8 veredicto(s) manual(is) movido(s)`), e como o
  `outcome` deles voltou a NULL, o sweeper os reavalia e eles entram na amostra.

### Modelos de IA — o prazo que ninguém tinha visto
- A família atual da OpenAI é **GPT-5.6** (`sol` $5/$30 · `terra` $2,50/$15 ·
  `luna` $1/$6 por 1M tokens; input cacheado 10× mais barato).
- **`gpt-4o` — usado no deep — tem shutdown marcado para 23/10/2026.** Migrar não
  é opcional. Candidatos: `luna` no quick, `terra` no deep (mesmo preço de input
  que o gpt-4o atual).
- **Piloto de 10 análises custou US$ 0,00** (erro 400 não é cobrado) e achou a
  incompatibilidade real: GPT-5 **rejeita `max_tokens`** (exige
  `max_completion_tokens`) e **rejeita `seed`**. Corrigido em
  `modules/ai/openai-params.ts` → `buildSamplingParams(model, opts)`, usado nos
  dois call sites do adapter. Isso era dívida obrigatória pro deadline de outubro.
- **`AI_MODEL_QUICK` / `AI_MODEL_DEEP`** criados (`resolveModel()`): antes só
  existia `AI_MODEL`, que sobrescrevia quick E deep juntos — migrar o quick
  achataria o deep e mataria a diferença que justifica cobrar 3 ticks.
  Precedência: `AI_MODEL_QUICK|DEEP` → `AI_MODEL` → padrão histórico.
  **Nenhuma das três está setada no Render** → produção roda mini/4o.
- Custo por análise rápida: **~$0,003** no mini · **~$0,024** no luna ·
  **~$0,06** no terra. O `COST_PER_ANALYSIS_USD = 0.01` do runner é a estimativa
  antiga do mini — no luna, multiplique por ~2,4 o que ele imprime na tela.
- **Saldo OpenAI em 27/07: US$ 2,42**, auto-recharge desligado. As 150 análises
  do teste custam ~US$ 3,60. A perna baseline NÃO precisa ser refeita — o
  backtest v2 já é ela (mesmas amostras, seed 20260713, mesmo prompt v7.3).
- O runner é **retomável**: grava linha a linha e pula o que já analisou. Dá para
  fatiar o teste conforme o caixa; o mesmo `--out` vai se completando.

### Regra de experimento (custou caro aprender em outros projetos)
**Trocar modelo e prompt ao mesmo tempo invalida o teste.** Ordem obrigatória:
(1) v7.3 no modelo novo → isola o modelo; (2) só então v7.4 vs v7.3 no vencedor.
E cuidado com a intuição de "prompt mais complexo": o problema medido é
calibração, não cobertura. Mais estratégias dão mais formas de justificar setup
mediano. Um prompt mais ENXUTO pode performar melhor num modelo mais capaz —
boa parte da v7.3 é andaime para compensar limitação do mini de 2024.
