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
- **Regras:** nenhum número vai pra marketing sem decisão explícita + metodologia + disclaimer. Posicionamento validado: "second opinion, not signals".
- **Backlog barato:** testar grounding isolado (~US$0,75), testar deep/gpt-4o vs mini (~US$4), ampliar amostra XAU/EUR 4h.

- **Grounding do quick (NO AR — commits 2e97324/bf2c0f5, 17/07/2026):** `AIAdapter.buildQuickGrounding` injeta candles reais no prompt (OKX primário — Binance bloqueia IP dos EUA/Render —, Binance fallback, XAU/EUR via Twelve Data se `TWELVE_DATA_API_KEY` no env) + contexto do MarketService. Flag `ENABLE_QUICK_GROUNDING` — **decisão consciente do dono: ligar em produção SEM backtest prévio** (tráfego ~0, kill-switch disponível, outcome tracking mede de graça). PENDENTE confirmar `=true` no env group do Render + linha `[QuickGrounding]` no log do tickrify-worker após análise de teste. Matemática idêntica ao `--ground` do runner.
- **Outcome tracking (NO AR — commit 2e97324, 17/07/2026):** `worker/outcome.sweeper.ts` + migração `20260716120000_analysis_outcome` (campos `outcome/outcomeAt/outcomeDetail` no Analysis). A cada 1h avalia análises completadas há 48h+: fill no entry → corrida TP1×SL em candles 30m (regra idêntica ao `evaluate.py`; mesmo candle TP+SL = LOSS). Outcomes: WIN/LOSS/TIMEOUT/NO_FILL/ABSTAIN/INCOMPLETE/UNTRACKABLE. Lotes 25/h com backfill. Kill-switch `ENABLE_OUTCOME_TRACKING='false'`. Com ~30–50 outcomes: calcular win rate real de produção (separar com/sem grounding pela data do deploy). Cria o dataset proprietário; depois expor "taxa de acerto histórica" na UI.
- **v7.4 (playbooks) segue LOCAL, não commitada** — `trading-system-prompt.ts` + `backtest-runner.ts` (strategyLine) + `evaluate.py`. Só sobe depois de medir (teste ~US$1,50). Pro teste de grounding isolado: `git stash push -- apps/backend/src/common/prompts/trading-system-prompt.ts` antes (volta pra v7.3), `git stash pop` depois.
- **19/07/2026 — grounding LIGADO em produção + incidente de migração resolvido:** `ENABLE_QUICK_GROUNDING=true` e `TWELVE_DATA_API_KEY` adicionadas no env do Render. Na sequência descobriu-se produção quebrada (P2022: colunas outcome/outcomeAt/outcomeDetail não existiam — a migração nunca rodou porque `RUN_MIGRATIONS_ON_START=false`, e ligar não resolve: `prisma migrate deploy` falha com P1001 porque `MIGRATIONS_DATABASE_URL` aponta pro host direto do Supabase, IPv6-only, inalcançável do Render). Correção: SQL da migração aplicado manualmente no SQL Editor do Supabase + INSERT no `public._prisma_migrations` com o checksum correto (sha256 do migration.sql). `RUN_MIGRATIONS_ON_START` voltou pra `false`. **REGRA: toda migração nova precisa ser aplicada manualmente no Supabase (SQL Editor) + registrada no `_prisma_migrations`, OU corrigir de vez `MIGRATIONS_DATABASE_URL` pro session pooler IPv4 do Supabase (aws-0-<região>.pooler.supabase.com:5432).**

## PENDENTE
- ~~Verificação de domínio no Resend~~ **RESOLVIDO 20/07:** domínio verificou sozinho em 10/07 (DNS propagou). `MAIL_FROM = "Tickrify <noreply@tickrify.com>"` setado no Render em 20/07.
- ~~E-mail de recuperação~~ **LIGADO 20/07:** gatilho em `ai.service.triggerRecoveryEmail` — dispara quando o free bate o limite, dedup permanente via AdminAudit (`action='recovery_email_sent'`). ⚠️ CONFERIR: o e-mail promete cupom **EARLY35**, mas o cupom documentado aqui é **EARLY50** — validar qual existe no Stripe e alinhar.
- **Causa raiz dos e-mails que nunca saíam (corrigida 20/07):** o session token do Clerk NÃO inclui e-mail → `User.email` ficava NULL nos 27 usuários. Fix: `common/utils/clerk-email.ts` busca na API do Clerk + backfill no `auth.controller` (getMe) e no gatilho de recuperação.

## 20/07/2026 — Sprint de fundação
- Blog SEO estático no ar (`apps/frontend/public/blog/`, 4 artigos EN) + sitemap reenviado no Search Console (8 páginas encontradas).
- i18n do Calendário Econômico corrigido (strings hardcoded PT → 6 línguas, chaves `cal*` em `analysis.result`).
- **"What would change my mind"** no `AnalysisResult` para WAIT/HOLD (chaves `flip*`): compõe entryCondition/alternativeScenario/invalidation/whyNotOpposite — SÓ campos que o motor já devolve, zero mudança de prompt.
- `MIGRATIONS_DATABASE_URL` corrigida no Render → session pooler IPv4 (`aws-0-us-west-2.pooler.supabase.com:5432`). `prisma migrate deploy` volta a funcionar; fim do SQL manual.
- **v7.4 fora do working tree:** backup em `tmp/v74-playbooks-backup/` (gitignored), árvore limpa na v7.3. Restaurar do backup antes de medir (~US$1,50).
- **Dado de tração:** 27 contas registradas (2 novas em 19/07), usuários reais analisando; usuários novos recebendo WAIT 30% nas 3 análises grátis → motivação direta do flip-card e do recovery email.

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
