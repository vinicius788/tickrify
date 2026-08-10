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
- **PLANO ÚNICO desde 27/07/2026: US$ 29/mês (ou US$ 290/ano) com 200 ticks mensais.** (Passou por $19 no mesmo dia; ver "Preço" na seção Sprint 27/07.) Substituiu os 3 tiers (Starter $12 / Pro $29 / Elite $59), que diferiam APENAS em volume — mesma fila, mesmo modelo, mesmo suporte. O Starter a $0,267/análise era mais caro que o pacote avulso ($0,20): assinar era o pior negócio da loja. Agora $0,095/análise, metade do avulso mais barato.
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

## Sprint 28/07 — ativação + loop do veredito (Ondas 1 e 2)

### Onda 1 — telas vazias que ensinam
- `components/dashboard/EmptyState.tsx` (novo): componente ÚNICO usado em Watchlist,
  My Trades e Dashboard. Props `icon/title/description/ctaLabel/onCta`.
- `Watchlist` e `MyTrades` ganharam a prop `onStartAnalysis` (antes não recebiam
  prop nenhuma); o `DashboardPage` passa o `resetNewAnalysisView`. Sem rota nova —
  a navegação do painel é por `activeView`.
- **No My Trades há DOIS estados vazios distintos.** Sem nenhuma análise → EmptyState.
  Filtro sem resultado → linha simples. Unificar os dois faria quem filtra por "SL"
  ler "seu histórico começa com um gráfico", o que é falso.
- No Dashboard o EmptyState só troca os KPIs se `!isDemo && total === 0 && !loading`.
  Sem o `!loading` ele pisca a cada abertura do painel.
- Hero: chave `landing.hero.valueNow` — "sem histórico pra importar, sem 30 dias de
  diário; sobe o gráfico e a IA lê agora". É o diferencial contra os concorrentes de
  diário (a IA deles só funciona depois de 5-10 trades registrados à mão).

### Onda 2 — o loop do veredito (pergunta → marcação → cobrança → número)
- `lib/verdict.ts` (novo) é a **fonte única**: `Verdict`, `verdictFromOutcome`,
  `outcomeFromVerdict`, `loadVerdicts`, `saveVerdict`, `VERDICT_CFG`, `resolveVerdict`,
  `VERDICT_MIN_AGE_MS` (12h), `VERDICT_MAX_ROWS` (3), snooze de 24h.
  Mesma chave de localStorage de sempre: `tickrify_verdicts`.
- **2.2** — no `case 'analysis-result'`, dentro do card de gancho: "Taking this one?"
  com "I am taking it" (grava `open`) e "Passing". NÃO pergunta TP1/TP2/SL aqui — o
  trade acabou de nascer, não há resposta possível, e cobrar agora ensina a ignorar.
- **2.3** — bloco no topo do dashboard com os trades `OPEN` com +12h, máx 3 linhas,
  "ver todas", "agora não" (24h). Some sozinho quando o último é fechado.
- **2.4** — linha de taxa de acerto só com **≥5 decididos**, sempre com o n visível,
  e o R:R rotulado como **"proposto"** (vem da IA, não da execução do usuário).

### ⚠️ Regras que nasceram de bugs REAIS (não desfazer)
1. **O gatilho da cobrança é `open`, NUNCA `pending`.** O `pending` do
   `GET /api/ai/performance` é o `default` de um switch sobre TODAS as análises
   completadas — inclui WAIT. Na conta do dono isso daria "35 trades em aberto"
   para trades que nunca existiram.
2. **NUNCA deduzir qual análise marcar pela lista.** A 1ª versão usava
   `rawAnalyses.find(completed)`; como o `refetchAnalyses()` roda ao fim da análise,
   a lista trocava no meio e o clique marcava o trade ERRADO. Corrigido: o id vem do
   `createAnalysis` (`lastAnalysisId`).
3. **O filtro `OPEN` do My Trades só vem pré-aplicado pelo "ver todas".** A 1ª versão
   aplicava sempre que houvesse trade aberto — quem clicasse em My Trades no menu via
   1 análise em vez de 39. Usar `openMyTrades(filter?)`.
- O `MyTrades` **não usa** `getPerformance()`; calcula tudo do `useAnalyses(40)` +
  localStorage. O Dashboard faz igual, de propósito: o Render hiberna, o endpoint conta
  até 1000 análises e a tela carrega 40 — os números discordariam.

### Distribuição — números REAIS conferidos em 28/07 (os do CLAUDE.md estavam velhos)
- **Instagram @tickrify: 82 seguidores · 5 posts · 0 seguindo · ZERO reels.**
  (O registro antigo dizia 53 seguidores e "reels 1-2k views" — não há reels no perfil
  hoje; ou foram arquivados ou viraram post de feed.) Bio já em inglês e com UTM.
  Diagnóstico: conta não está morta, está **subalimentada** — e publicando no formato
  que menos distribui (feed em vez de reel).
- **Thread do X reescrita** em `_local/Thread_X_Receipts_2026-07.md` (fora do git).
  A antiga (`marketing-sprint/EXECUTAR_AGORA_X_REDDIT_YT.md`) está OBSOLETA: em PT para
  público BR, cupom FUNDADOR50 que não existe (o vivo é EARLY35), promete win rate
  público que agora já É público, e cita "~30s" (não medível).
- **A bio do Instagram diz "in 30s"** — mesmo claim não verificável do card 16s.
- `marketing-sprint/` (22 arquivos) estava VERSIONADO no git — **resolvido em 28/07**,
  movido para `_local/marketing-sprint/`. Varri o `CONTAS-E-CHAVES.md`: **não há segredo**.

## 🚫 REGRA PERMANENTE — não encher o repo de arquivo (28/07/2026)

O dono reclamou, com razão: **toda sessão de trabalho terminava com o projeto cheio de
documento solto.** Chegou a 9 `.md` na raiz + `marketing-sprint/` (22 arquivos
versionados) + 3 documentos de estratégia dentro de `docs/`.

**A regra, sem exceção:**

1. **Nenhuma sessão cria arquivo novo no repositório** a não ser que seja **código que
   roda** (`.ts`, `.tsx`, `.sql`, config, migração). Se você acha que precisa de um
   arquivo que não é código, a resposta padrão é: **não crie — pergunte.**
2. **Documento (plano, relatório, prompt, thread, roteiro, análise, handoff) vai para
   `_local/`**, que está no `.gitignore` — ou é entregue pelo chat. Nunca no git.
3. **Nada de `RESUMO.md`, `HANDOFF.md`, `PLANO_X.md`, `README` novo, `NOTES.md`.** O
   histórico do trabalho mora **aqui, no `CLAUDE.md`** — atualize este arquivo em vez de
   criar outro. Um arquivo de contexto, não vinte.
4. **Um arquivo de código novo precisa de justificativa** dita em voz alta antes de
   criar: por que não cabe num arquivo existente. Preferir editar a criar.
5. O `.gitignore` já bloqueia: `.md`/`.png`/`.csv`/`.xlsx`/`.pdf` na raiz, `_local/`,
   `marketing-sprint/`, `handoff/`, `planos/`, `relatorios/`, `prompts/` e
   `*.docx`/`*.xlsx`/`*.pptx`/`*.pdf` em qualquer pasta. **Se você precisar
   desligar uma dessas regras, você está fazendo a coisa errada.**

Limpeza de 28/07: 9 `.md`/`.csv` da raiz → `_local/arquivo/` · `marketing-sprint/` →
`_local/marketing-sprint/` · os 3 `.docx`/`.xlsx` de `docs/` → `_local/arquivo/`.
`docs/` continua no git só com doc **técnica** (ENV_VARIABLES, PROMPTS, runbooks).

## Sprint 29/07 — bug de cobranca em moeda + politica de privacidade

**Como apareceu:** a `/pricing` mostrava US$ 29 e o checkout da Stripe abria em
**R$ 57,00/mes**. Achado a partir de print do dono. Nao era um bug — eram tres.

### 1. A moeda do checkout era escolhida pelo cliente (bug de RECEITA + seguranca)
- `PricingCards.tsx` fazia certo (`const currency: Currency = "usd"`), mas o
  backend sobrescrevia: `stripe.service.createCheckoutSession` chamava
  `detectExistingCustomerCurrency()` e fazia `existingCurrency ?? currency`. A
  conta do dono tem assinatura de teste em BRL → todo checkout dele resolvia
  para o price BRL.
- **O price BRL do starter (`price_1TRv2f...`) esta congelado em R$ 57 desde
  jun/2026**, quando o plano custava US$ 12. As tres edicoes de preco
  ($12 → $19 → $29) foram feitas SO no objeto USD. Os 12 objetos BRL/EUR de
  todos os planos seguem nos valores antigos.
- Pior: `stripe.controller` aceitava `body.currency` do cliente. Um POST com
  `currency:'brl'` assinava o plano de US$ 29 por ~US$ 10. Mesmo furo no
  `ticks.controller` (`body.currency ?? 'usd'` escolhia a linha de preco do
  pacote). **Sem trafego ninguem explorou, mas era porta aberta.**
- `DashboardPage` (botao "Unlock analysis") usava
  `detectCurrency(navigator.language)` → qualquer visitante com navegador pt-BR
  caia em BRL.

### 2. O paywall vendia outro plano
`DashboardPage:386` chamava `createCheckoutSession('pro', ...)`. O `pro` e
LEGADO e da **150 ticks**; o `starter` da **200**. Em USD os dois custam $29 —
entao quem entrava pelo paywall pagava igual e levava 50 ticks a menos que quem
passou pelo `/pricing`. O default do `stripe.controller` quando o body vinha sem
`planType` tambem era `'pro'`.

### Decisao do dono: MOEDA UNICA, USD, para todo mundo
Manter 18 price IDs (3 planos × 2 ciclos × 3 moedas) sincronizados a mao foi o
que criou o bug e o recriaria no proximo reajuste. Agora sobra 1 preco para
manter, e a Stripe converte para a moeda local no checkout via **Adaptive
Pricing** (ja ligado — o `checkout.sessions.create` omite `payment_method_types`
de proposito, ver comentario no `stripe.service`).
- `frontend/lib/stripe.ts`: `detectCurrency` virou casca `@deprecated` que
  sempre devolve `'usd'`. **Nao foi apagada** so porque
  `__tests__/DashboardPage.test.tsx` declara ela no mock e o export sumindo
  daria erro de tipo. Apagar as duas juntas depois.
- `stripe.controller` e `ticks.controller`: moeda fixa em `'usd'`, ignorando o
  body. **Isso e fronteira de seguranca, nao preferencia — nao reverter.**
- `stripe.service`: `detectExistingCustomerCurrency` virou DIAGNOSTICO. So loga
  aviso; nao decide mais. Se sobrar cliente com compromisso legado em BRL/EUR, a
  Stripe recusa o checkout com "You cannot combine currencies on a single
  customer" — **falhar alto e o comportamento certo**, cobrar errado calado nao.
- Os price IDs BRL/EUR ficam no `stripe.config.ts`: assinaturas legadas ainda
  precisam deles para creditar os ticks certos. Nenhum checkout novo os alcanca.
- **PENDENTE do dono:** cancelar as 2 assinaturas de teste em BRL no Stripe,
  senao a propria conta dele bate no erro de moeda ao testar o checkout.

### 3. Politica de privacidade
- `PrivacyPolicyPage.tsx` estava **inteira em portugues** num site cujo padrao e
  ingles desde jun/2026 — e o rodape rotulava o link como "Privacy Policy".
  Reescrita em ingles.
- **Claim falso da mesma familia dos que a auditoria de 27/07 matou:** o "Ultima
  atualizacao" era `new Date().toLocaleDateString(...)`, ou seja, a pagina sempre
  afirmava ter sido atualizada HOJE, em qualquer dia que o visitante abrisse.
  Virou a constante `LAST_UPDATED`. **Ao editar o texto, atualize a data na mao.**
- Rota canonica agora e `/privacy`; `/privacidade` continua respondendo (link
  antigo/indexacao). Rodape aponta para `/privacy`.
- Texto ganhou paragrafo sobre transferencia internacional de dados e sobre
  usuarios fora do Brasil, ja que o produto vende global. **Nao houve revisao
  juridica** — LGPD segue como lei regente porque a operacao e brasileira.
- Nao existe pagina de Termos: o rodape usa `TermsOfServiceDialog` (modal).

### Verificacao
`tsc --noEmit` do frontend: **0 erros**. Backend: **7 erros**, todos do `outcome`
(Prisma Client local desatualizado) — nenhum novo.

---

## Sprint 29-30/07 — motor v9 + dois bugs silenciosos que quebravam produção

Objetivo do dono: um prompt novo, do zero, "com estratégias validadas e leitura de
fluxo". O prompt v9 saiu (`common/prompts/trading-system-prompt-v9.ts`, ~64k chars,
arquivo separado — **não** importado por ninguém, portanto não vai a produção sozinho).
Mas o que valeu mais foram os bugs achados no caminho.

### 🔴 BUG 1 — GPT-5 rejeita `temperature` E `top_p` (produção NÃO foi afetada — verificado)

```
400 Unsupported value: 'temperature' does not support 0.1 with this model.
    Only the default (1) value is supported.
```

`openai-params.ts` só tratava `max_tokens` e `seed` (achados em 27/07). O erro do
`temperature` estava **escondido atrás** do primeiro: só aparece depois de corrigir
o anterior. Corrigido — `temperature`/`top_p` agora só vão para a família 4o.

✅ **VERIFICADO no painel do Render em 30/07: NENHUMA das três variáveis
(`AI_MODEL`, `AI_MODEL_QUICK`, `AI_MODEL_DEEP`) está setada.** A lista de env vars
começa em `ALLOW_UNAUTHENTICATED` e é alfabética — `AI_*` viria antes e não está lá.
Ou seja: produção continua rodando `gpt-4o-mini`/`gpt-4o` (o default do
`resolveModel`) e **o bug nunca chegou ao usuário**. `ENABLE_QUICK_GROUNDING` está
setada (grounding ligado, como esperado).

**Consequência para o rollout do v9:** o v9 **não roda no mini** (nunca termina).
Então a ordem obrigatória é: (1) setar `AI_MODEL_QUICK=gpt-5.6-luna` no Render —
agora seguro, com o bug corrigido; (2) confirmar que as análises voltam e medir o
custo real (~US$0,032 vs ~US$0,013 no mini, ~2,4x); (3) só então ligar
`AB_PROMPT_V9_PERCENT`. Ligar o A/B antes da troca de modelo faria a perna B
falhar 100%.

**Consequência conceitual, não só técnica:** nos modelos GPT-5 **não existe controle
de sampling**. A `temperature: 0.1` que o motor usava para forçar consistência
sumiu. Confirmado na prática: o MESMO gráfico foi avaliado como compra numa rodada
e como venda na seguinte. A consistência agora depende só do prompt — o
`DETERMINISTIC_CONSISTENCY_INSTRUCTION` deixou de ser reforço e passou a ser a
única linha de defesa. Isso é risco de produto real (usuário sobe o mesmo print
duas vezes e vê leituras diferentes).

### 🔴 BUG 2 — a ordem do `json_schema` fazia o modelo decidir ANTES de analisar

Em structured outputs a ordem das chaves no schema **é** a ordem de geração. Estava:

```
is_financial_chart → recommendation → confidence → analysis (reasoning no fim)
```

Ou seja: o modelo escolhia BUY/SELL/HOLD e o número da confiança **sem ter escrito
uma palavra de análise**. Todo o resto era racionalização do que já estava decidido.
**Isso explica o mistério do backtest v2**: por que a confiança só saía 30, 45, 68
ou 72 — não era análise, era pescar um número da memória antes de olhar o gráfico.

Reordenado para `is_financial_chart → analysis (reasoning PRIMEIRO) → recommendation
→ confidence`. Efeito medido no mini, mesmo gráfico: o `reasoning` saltou de 212
chars de "not defined" para 965 chars com ARR, preços, playbook e a conta da
confiança. **Vale para a v7.3 também**, não só para o v9.

⚠️ Efeito colateral: com a decisão no fim, truncar deixou de ser "resposta cortada"
e passou a ser "veredito perdido" (o `repairTruncatedJson` fecha o JSON e
recommendation/confidence caem no padrão HOLD/0). Por isso o teto de saída do quick
subiu de 8.000 para 16.000 e o teto de tempo permitido de 120s para 180s (default
segue 55s).

### 💡 A imagem sempre foi o custo, não o prompt

Mesmo prompt + mesma imagem, tokens de ENTRADA cobrados:

| | gpt-4o-mini | gpt-5.6-luna |
|---|---|---|
| entrada | **52.953** | **17.077** |
| saída | 8.000 (truncado) | 2.422 (completo) |
| tempo | nunca terminava | 18s |
| custo/análise | ~US$0,013 | ~US$0,032 |

O prompt em texto são ~15k tokens nos dois. **O mini cobra ~38k tokens só pela
imagem em alta resolução**; o luna cobra ~2k. Conclusão: o medo de "prompt grande
é caro" era falso — v9 e v7.3 custam praticamente o mesmo no luna (US$0,032 vs
US$0,030), porque o prompt maior gasta na entrada o que o OUTPUT BUDGET economiza
na saída. E **o v9 não roda no mini**: nunca termina (>120s, satura o teto de saída).

### Veredito do v9 (medido, não opinado)

10 amostras espalhadas (BTC/ETH/XAU/EUR, 30m e 4h), mesmo modelo, mesmos dados,
só o prompt muda:

| | v7.3 | v9 |
|---|---|---|
| sinais | 2/10 | **0-1/10** |
| regimes distintos | trending 9, volatile 1 | ranging 4-6, trending 3-5, volatile 1 |
| força de tendência | **moderate 10 de 10** | weak 4, moderate 6 |
| confianças distintas | 6 de 10 | **8 de 10** |

**O v9 é melhor analista e pior gerador de sinal.** Na leitura ele ganha claramente:
discrimina regime onde a v7.3 escreve a mesma constante dez vezes, calcula a
confiança (`base 45 −5 sem gatilho −5 pressão divergente = 35`) em vez de decorar
quatro números, e acha spring/upthrust com preço.

Abstenção de 90-100%. Diagnóstico pelos portões: G6 (geometria) reprova 9/10, mas
**porque** G3 (playbook) e G4 (pressão) já reprovaram — em range com rotação de
duas vias e preço no meio não existe pressão direcional, então nenhum plano é
construído e não há geometria para avaliar. 6 dos 10 gráficos são exatamente isso.

**Isso não é bug, é disciplina.** Um trader passaria batido em 9 desses 10. A v7.3
chamou 9 de 10 de "tendência" — factualmente errado — e é assim que ela fabrica
sinal. Cruzando com o que já estava medido (expectancy −0,19R, faixa 60-70 acertando
25%), **a abstenção do v9 pode ser a resposta certa para o motivo pelo qual a v7.3
perde dinheiro.**

Quatro rodadas de ajuste (~US$1,20) não tiraram a abstenção de 90%. Parei de propósito:
mais voltas seria esculpir o prompt em cima de dez gráficos (p-hacking).

### ✅ A/B de prompt em PRODUÇÃO — a medição que não custa API

Em vez de gastar ~US$5/perna no backtest, a produção mede sozinha:

- **`AB_PROMPT_V9_PERCENT`** (default 0 = desligado). `20` → ~20% dos usuários recebem
  o v9. Sorteio **por usuário** (hash FNV-1a estável), não por análise: o mesmo
  usuário fica sempre do mesmo lado. Por análise seria pior justamente porque GPT-5
  não tem mais temperatura para atenuar variação.
- **`promptVer = -9`** marca a perna B. Negativo de propósito: nunca colide com versão
  real de `PromptConfig` e não exige tabela nova.
- **Coluna `Analysis.model`** — sem ela é impossível comparar calibração antes/depois
  de trocar de modelo. Aplicada no Supabase em 30/07 (`ADD COLUMN IF NOT EXISTS` +
  `Analysis_promptVer_outcome_idx`), e replicada no `onModuleInit` como rede.
- **`/accuracy` agora devolve `byPrompt` (v9 vs current) e `byModel`**, reaproveitando
  o mesmo `tally` com intervalo de Wilson.

**Por que isso é melhor que o backtest:** a limitação nº 1 do relatório interno é
*"gráfico renderizado ≠ print real de usuário"*. Os 300 gráficos do manifest são
matplotlib sem indicador e sem desenho. A produção mede com print de verdade, de
graça, e cresce sozinha — o `outcome.sweeper` já fecha TP1/SL 48h depois.

### Grounding: o que passou a ir no prompt

Os candles que o backend já baixava traziam **volume na coluna 5 e o código descartava**.
Agora vai: volume relativo à média de 20 (`2.4x SPIKE`), **mapa de volume por preço**
(POC + área de valor + gaps de baixo volume, aproximados distribuindo o volume no
range do candle) e **mapa de eventos** calculado (última perna de impulso com origem,
reversões recentes por CHoCH, base de acumulação e para que lado saiu, rompimento
falho spring/upthrust). Contar e localizar é o que modelo de visão faz pior — virou
aritmética determinística.

**Guarda de print velho** (`detectStaleChart`): o `extractSymbol` passou a ler também
o preço do último candle visível. Se ele divergir mais de 3 ATR do close real, o bloco
de dados é **retido** e entra um aviso de que o print é histórico. Sem isso, um print
de três dias atrás fazia o backend injetar "preço atual = X" e a IA montava
entrada/stop/alvo num preço que não é o do gráfico — errado com cara de certo.

### Backtest runner

- **`--prompt-file <caminho>`**: testa um prompt candidato sem tocar no ativo. Aceita
  `.ts` (extrai o template literal) ou `.md`/`.txt`.
- **Uma fonte da verdade**: o runner tinha cópia própria do bloco de dados reais e
  ficou defasada (sem volume, sem mapa de eventos) — passou a importar
  `buildRealDataBlock` de `ai.adapter`. Antes, o backtest media um motor que não era
  o de produção.
- **`BT_DEBUG_FIELDS=1`** grava tamanho de cada campo, o checklist e o reasoning
  íntegros. **`AI_DEBUG_DUMP_RAW=<arquivo>`** grava a resposta crua + tokens +
  `finish_reason` (só a resposta; o prompt do sistema nunca vai para arquivo).
- **`scripts/backtest/rodar-teste-v9.sh piloto|completo|avaliar [ambas|v73|v9]`**:
  trava antes de gastar se `AI_MODEL*` estiver setado (o teste tem de rodar no modelo
  da baseline) ou se `ENABLE_QUICK_GROUNDING=true` (injetaria dados em duplicidade).

### ⚠️ Pendências que só o dono resolve

1. ~~Conferir `AI_MODEL_QUICK` no Render~~ — **FEITO em 30/07: não está setada,
   produção nunca quebrou.** O que resta é a decisão de migrar para o luna (ver Bug 1),
   que é pré-requisito do v9 e obrigatória até 23/10 por causa do shutdown do gpt-4o.
2. `AB_PROMPT_V9_PERCENT` continua **desligada** — ligar em 20 é a decisão que
   transforma cada usuário real num ponto de medição.
3. Um teste de win rate honesto custa ~US$5/perna no luna. Saldo era US$2,42. Com
   n=25/perna o intervalo de confiança é largo demais para decidir nada.

---

## Sprint 10/08/2026 — auditoria de SEO + card de preço desalinhado

### O card de preço encostado na esquerda
`PricingCards.tsx` tinha `grid-cols-1 md:grid-cols-3` FIXO, herdado de quando eram
3 tiers. Desde o plano único (27/07) o card sozinho caía na **primeira coluna de
três** — o título e o banner acima seguiam centralizados e só o card ficava torto.
Agora a largura sai de `PLANS.length` (1 → `max-w-md`, 2 → `md:grid-cols-2`, 3+ →
`md:grid-cols-3`), então não quebra de novo se um segundo plano voltar.

### 🔴 O achado nº 1: todas as rotas serviam o mesmo `<title>`
SPA Vite sem SSR e sem helmet → toda rota React devolvia o `index.html` único.
**Verificado ao vivo antes da correção:** buscar `tickrify.com/pricing` devolvia
`"Tickrify — AI chart analysis for traders"`, o título do home. `/pricing`,
`/accuracy`, `/try` e `/privacy` eram a mesma página aos olhos do Google e nenhuma
podia rankear para nada específico.

**Correção:** `hooks/useSeo.ts` (arquivo novo, justificado: 5 páginas usam, não
cabe dentro de nenhuma). ~40 linhas mexendo direto no `document.head`, **sem
dependência nova** (`react-helmet-async` não entra — o lockfile não atualiza local).
Exporta `useSeo` (title/description/canonical/og/twitter/robots) e `useJsonLd`.
Ambos restauram o padrão no unmount: sem isso a meta de uma rota grudaria na
seguinte, porque o Router não recarrega o documento.

⚠️ **Isto resolve o Googlebot, que renderiza JS. NÃO resolve crawler que não
executa JS** (Bing, crawlers de IA, prévia de link do WhatsApp/Slack) — a meta só
existe depois da hidratação. A correção completa é **pré-renderizar as rotas
públicas no build** (`vite-plugin-ssg` ou pré-render), que continua PENDENTE e é o
item de maior retorno da lista inteira.

### 🔴 A marca não aparece no Google
Busquei `Tickrify` e `tickrify AI chart analysis` em 10/08: **o tickrify.com não
apareceu em nenhuma das duas.** Voltaram Tickify (ingressos), Ticklify (cripto) e,
na segunda, os concorrentes diretos. Ou o domínio não está indexado de verdade, ou
está com autoridade zero sendo canibalizado por marcas foneticamente próximas.
**PENDENTE DO DONO: abrir o Search Console (domínio já verificado via
`google66729000cdbf71c6.html`) e conferir Cobertura + Inspeção de URL.** Se o site
não estiver indexado, nenhuma outra recomendação de SEO importa.

### A `/accuracy` era órfã
Fora do sitemap, sem meta própria, e o único link era o do rodapé do app — que só
existe depois do JS carregar. É o ativo mais raro do site: auditei SnappChart e
Tickrad e **nenhum dos dois publica acurácia real**. Agora tem título próprio, está
no sitemap e recebe link dos 6 posts do blog e do índice — o blog é a única parte
estática e rastreável do site, então é de lá que o link precisa sair.

### Demais correções deste commit
- **sitemap.xml:** entraram `/try` e `/accuracy`; `/privacidade` saiu e virou
  `/privacy`. Todas ganharam `<lastmod>` (único dos três campos opcionais que o
  Google ainda usa); `changefreq` e `priority` saíram — são ignorados desde 2023.
- **Duplicata de privacidade:** as duas rotas renderizam o mesmo componente, e o
  sitemap listava justamente a NÃO canônica. O `useSeo` do `PrivacyPolicyPage` fixa
  o canonical em `/privacy` independente da rota servida.
- **Schema da /pricing:** `SoftwareApplication` + `Offer` ($29 USD) + `FAQPage`,
  montados a partir do MESMO objeto `PRICING_COPY` que a tela renderiza — se a copy
  mudar, o markup muda junto. Sem `aggregateRating`: não há avaliação real e
  inventar uma seria o claim que a Fase 1 removeu.
  ⚠️ **O FAQPage NÃO gera mais rich result** — o Google desativou FAQ rich results
  em **07/05/2026**. Ficou porque ainda é assim que buscador de IA lê a página.
- **og:image saiu do imgur** (`i.imgur.com/3Z3gY8A.png`, host de terceiros gratuito
  segurando todos os cards de compartilhamento) para `/public/og.png`, 1200x630, na
  identidade do site. Com `og:image:width/height` e alt corrigido.
- **`maximum-scale=1.0`** removido do viewport (bloqueava zoom com pinça =
  penalidade de acessibilidade e sinal negativo de mobile).
- **Descriptions cortadas** para 130–150 chars em `vs-chatgpt` (era 225),
  `vs-tradingview` (238), `best-ai-chart-analysis-tools` (178) e no `index.html` (171).
- **Canonical no `index.html`** — sem ele, `/` e cada variação de UTM que o próprio
  blog gera contavam como URLs distintas.

**NÃO fiz de propósito:** `dateModified` nos posts do blog. Adicionar um link não é
atualização de conteúdo, e carimbar "modificado hoje" por isso seria a mesma mentira
do `new Date()` que foi removido da política de privacidade em 29/07. Entra quando o
conteúdo for de fato aprofundado.

### Concorrência (auditada em 10/08)
| | Tickrify | SnappChart | Tickrad |
|---|---|---|---|
| páginas indexáveis | 7 (só o blog) | 25+ | ~10+ |
| profundidade média | ~660 palavras | 2.500–3.000 | n/d |
| landings plataforma/ativo | nenhuma | TradingView, cTrader, XAUUSD, forex, scalp/swing | TradingView, MT, Binance |
| ferramentas grátis | **nenhuma** | position size, breakeven win rate | risk calc, glossário, journal |
| **acurácia pública medida** | **sim** | não | não |

Perde em toda dimensão de infraestrutura (corrigível com engenharia) e ganha sozinho
na única que o concorrente não copia sem se expor.

### PENDENTE de SEO (ordenado por retorno)
1. **Search Console** — só o dono. Antes de tudo.
2. **Pré-renderizar as rotas públicas** — a correção de verdade por baixo do `useSeo`.
3. **Aprofundar os 6 posts** para 1.800–2.500 palavras (concorrente tem 5.500 na
   mesma query). Sem página nova, sem rota nova.
4. **3 calculadoras grátis** (position size, risk/reward, breakeven win rate) — é a
   Fase 1 do plano de crescimento que nunca saiu, e o formato que mais atrai link
   natural em finanças.
5. **Decisão de i18n do dono:** as 6 traduções vivem em `localStorage`, sem URL e sem
   `hreflang` → geram **zero** orgânico hoje. Ou rotas `/pt/`, `/es/`… com hreflang,
   ou assumir inglês como único idioma indexável (mais barato e alinhado com a meta
   US/UK), mantendo as traduções só como UX pós-login.
6. **Zero imagens em todos os 7 arquivos do blog** — num produto que é literalmente
   ler gráficos. Print real de análise em cada post = prova de produto + image pack.
