# Tickrify

SaaS freemium de **análise de gráficos com IA** para traders. O usuário sobe o print de um gráfico → a IA devolve uma leitura estruturada: entry, stop, targets, confiança, confluência, risco e cenários.

Produto global, site em inglês por padrão (6 idiomas). Domínio: **tickrify.com**.

> **Fonte de verdade do projeto: [`CLAUDE.md`](./CLAUDE.md).** Este README cobre stack, estrutura e deploy. Decisões, estado atual e pendências ficam no `CLAUDE.md`.

---

## Posicionamento (regra de produto, não de marketing)

> *"A second opinion that confirms or kills your read."*

Não é serviço de sinais. A decisão é sempre do trader. Consequência prática, aplicada em toda a vitrine desde a auditoria de 24/07/2026:

- **Nenhum número aparece no site sem ser verdadeiro e verificável** contra o backtest ou contra o banco de produção.
- **Nenhum card de feature descreve algo que não está no ar.**
- A palavra "sinal" só existe como rótulo técnico do tier ≥70 (`getConvictionTier`), nunca como promessa.

---

## Stack

| Camada | Tecnologia | Deploy |
|---|---|---|
| Frontend | Vite + React 19 + TypeScript + Tailwind + Clerk + React Router 7 + TanStack Query | **Vercel** (`tickrify-frontend`) |
| Backend | NestJS + Prisma | **Render** (`tickrify`, plano free — **hiberna**, ~30-50s de cold start) |
| Worker | BullMQ + Redis | **Render** (`tickrify-worker`) |
| Banco | Postgres (**Supabase**, região `us-west-2`) | — |
| IA | OpenAI — `gpt-4o-mini` (quick) / `gpt-4o` (deep), via `AI_MODEL` | — |
| Pagamento | Stripe (Checkout + webhooks) | — |
| Observabilidade | PostHog (funil) + Sentry (frontend) | — |
| E-mail | Resend | — |

Monorepo **pnpm** (`pnpm-workspace.yaml`, `pnpm-lock.yaml`). Atenção: os scripts do root ainda usam `npm run -w` por herança — é assim que Vercel e Render buildam hoje, então **não mexa neles sem testar o deploy**.

---

## Estrutura

```
apps/
  frontend/           Vite + React
    src/components/landing/     vitrine (hero, features, pricing, FAQ...)
    src/components/dashboard/   painel logado (AnalysisResult, MyTrades, heatmap...)
    src/lib/i18n/               pt · en · es · fr · de · ja (o TIPO vem de pt.ts)
    src/lib/trading-ui.ts       getConvictionTier, normalizações de recomendação
    public/blog/                artigos de SEO (estáticos)
  backend/            NestJS
    src/modules/ai/             análise, fila, endpoints públicos
    src/modules/ticks/          créditos ("Ticks")
    src/modules/calendar/       calendário econômico
    src/common/prompts/         trading-system-prompt.ts  ← o motor
    src/worker/                 outcome.sweeper.ts (outcome tracking)
    scripts/backtest-runner.ts  runner do backtest com o motor real
scripts/backtest/     pipeline reprodutível (amostragem, render, evaluate.py)
infra/ · docs/ · .github/workflows/
```

---

## O motor de IA

Arquivo único: `apps/backend/src/common/prompts/trading-system-prompt.ts` — **prompt v7.3**.

- **Núcleo ICT / Smart Money Concepts:** order blocks, fair value gaps, FVOB, mapa de liquidez, premium/discount, BOS/CHoCH.
- **Wyckoff** para continuação (re-acumulação/re-distribuição, spring, LPS).
- **Elliott** só para o padrão "flat A-B-C", como detector de armadilha de duplo stop.
- **Calibração de confiança (v7.3):** bandas 62-78, `>70` é raro, confiança = probabilidade de TP1 antes do SL.
- **Regra eliminatória de R:R ≥ 1.5.** (O normalizador usa 1.2 como piso conservador.)

**Grounding com candles ao vivo** (`AIAdapter.buildQuickGrounding`, flag `ENABLE_QUICK_GROUNDING`, no ar desde 17/07/2026): injeta candles reais + RSI(14) Wilder + posição no range + momentum, de OKX (primário), Binance (fallback) e Twelve Data (XAU/EUR), **antes** de a IA ler o print.

**Outcome tracking** (`src/worker/outcome.sweeper.ts`, no ar desde 17/07/2026): a cada hora avalia análises completadas há 48h+ — fill no entry → corrida TP1×SL em candles de 30m. Outcomes: `WIN / LOSS / TIMEOUT / NO_FILL / ABSTAIN / INCOMPLETE / UNTRACKABLE`.

### Régua objetiva — o que foi medido

| | v1 (prompt v7.2) | v2 (v7.3 + grounding) |
|---|---|---|
| Amostra | 300 análises | 150 pareadas |
| Win rate | 45,3% (IC 35-56) | ~37,5% |
| Expectancy | +0,02R | −0,19R |
| Taxa de WAIT | 68% | **72,7%** |
| Confiança | "75" fixa, sem informação | **discrimina**: 60-70 → 25% real · ≥70 → **56%** real |

O limiar 70 da UI ("Read" abaixo, "Signal" acima) sai daí. Relatórios ficam locais e gitignored (`Tickrify_Backtest_Report*.md`).

**Regra:** nenhum número vai para marketing sem decisão explícita + metodologia + disclaimer.

---

## Monetização

**Ticks** = créditos internos. Análise rápida = 1 tick · profunda = 3 ticks · PDF = 2 ticks.

- Free: **3 análises grátis** (só rápida — deep é travada para assinante), depois paywall com valor trancado (`LockedAnalysis`).
- Planos: Starter $12 · Pro $29 · Elite $59 /mês. **Hoje os planos diferem apenas em volume de ticks** — nenhuma diferença de motor, fila ou suporte. Não vender o que não existe.
- Ticks acumulam (`TicksService.addTicks` faz `increment`, sem reset mensal).

---

## Rodar local

```bash
pnpm install
cp .env.example .env      # preencher: DATABASE_URL, CLERK_*, OPENAI_API_KEY, STRIPE_*, REDIS_URL
pnpm migrate
pnpm dev                  # web + api + worker
```

Frontend em `http://localhost:5173`, API em `http://localhost:3000`.

```bash
pnpm test                 # testes do backend
cd apps/frontend && ./node_modules/.bin/tsc --noEmit   # type-check do frontend
```

---

## Deploy

Frontend na **Vercel** e backend/worker no **Render** buildam sozinhos a partir do push na branch principal. Não há deploy manual.

**Migrações:** `MIGRATIONS_DATABASE_URL` aponta para o session pooler IPv4 do Supabase (`aws-0-us-west-2.pooler.supabase.com:5432`) — `prisma migrate deploy` funciona a partir do Render. `RUN_MIGRATIONS_ON_START` fica em `false`; migrações são aplicadas de propósito, não no boot.

**Anti-cold-start:** `.github/workflows/keep-warm.yml` pinga `/api/health/live` a cada 10 min.
**Backup:** `.github/workflows/backup.yml` — `pg_dump` diário às 07:00 UTC, artifact privado por 30 dias (o plano free do Supabase não tem backup).

Variáveis sensíveis vivem no env group do Render e no dashboard da Vercel. **Nunca commitar chave.**

---

## Workflow (importante)

- A máquina do dono não roda build local. Fluxo: **editar código → `git add/commit/push` → Vercel/Render buildam remoto**.
- **Evitar dependências novas** (o lockfile não atualiza localmente).
- Frontend é seguro de editar; backend é crítico (no sandbox só dá para checar sintaxe).
- `.git/index.lock` travado → `rm -f .git/index.lock`.

---

## Changelog resumido

- **24/07/2026** — Auditoria de claims. Removidos dados de análise fabricados da landing (fallback e esteira), o claim "2:1 validated minimum R/R", a confiança 80% e o badge "LIVE" dos mocks, os bullets de pricing inexistentes (priority/institutional) e os resíduos de "Ações BR" nos 6 idiomas.
- **20-21/07/2026** — Migrações consertadas (session pooler), e-mails 100% funcionando, e-mail de recuperação, "What would change my mind" no WAIT, calendário econômico nos 6 idiomas, heatmap de consistência, backup diário, grounding turbinado (RSI + range + momentum).
- **17-19/07/2026** — Grounding do quick e outcome tracking no ar.
- **13/07/2026** — Prompt v7.3 (calibração de confiança) + UI de tier de convicção + primeiro backtest reprodutível.

---

Repositório privado. Uso interno.
