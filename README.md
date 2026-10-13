# Tickrify

SaaS freemium de **análise de gráficos com IA** para traders. O usuário sobe o print de um gráfico → a IA devolve uma leitura estruturada: entry, stop, targets, confiança, confluência, risco e cenários.

Produto global, site em inglês por padrão (6 idiomas). Domínio: **tickrify.com**.

> Este README descreve o estado operacional atual. O [`CLAUDE.md`](./CLAUDE.md) é um diário técnico extenso e pode conter registros históricos já superados. Para publicar, use o [`DEPLOY.md`](./DEPLOY.md).

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
| Backend | NestJS + Prisma | **Render** (`tickrify`) |
| Worker | BullMQ + Redis | Embutido no serviço Render `tickrify` |
| Banco | Postgres (**Supabase**, região `us-west-2`) | — |
| IA | Camada única de provedor (`modules/ai/vision-model.ts`): OpenAI ativa, modelo por tipo (`AI_MODEL_QUICK/DEEP`); outro provedor opcional por env | — |
| Pagamento | Stripe (Checkout + webhooks) | — |
| Observabilidade | PostHog (funil) + Sentry (frontend) | — |
| E-mail | Resend | — |

Monorepo **pnpm** (`pnpm-workspace.yaml`, `pnpm-lock.yaml`). O Render instala e compila com PNPM a partir do `Dockerfile` da raiz. A Vercel usa os comandos definidos em `apps/frontend/vercel.json`.

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
infra/docker-entrypoint.sh   inicializa API, migrações opcionais e worker embutido
docs/ · .github/workflows/
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
- Assinatura atual: **US$29/mês ou US$290/ano**, com 200 Ticks mensais. IDs antigos de Starter/Pro/Elite continuam no backend apenas para honrar assinaturas legadas.
- Ticks acumulam (`TicksService.addTicks` faz `increment`, sem reset mensal).

---

## Rodar local

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
pnpm migrate
pnpm dev                  # web + api + worker
```

Frontend em `http://localhost:5173`, API em `http://localhost:3001`.

```bash
pnpm test                              # testes do backend
pnpm --dir apps/frontend test          # testes do frontend
pnpm --dir apps/frontend typecheck     # type-check do frontend
pnpm build                             # builds dos dois aplicativos
```

---

## Deploy

O frontend está no projeto Vercel `tickrify-frontend`, com raiz `apps/frontend`. O backend está no serviço Render `tickrify`, com contexto na raiz do repositório e `./Dockerfile`. Não existe um serviço de worker separado: `infra/docker-entrypoint.sh` inicia o worker no mesmo contêiner quando `RUN_EMBEDDED_WORKER` não é `false`.

**Migrações:** `MIGRATIONS_DATABASE_URL` deve apontar para o session pooler IPv4 do Supabase. O entrypoint executa `migrate:deploy` quando `RUN_MIGRATIONS_ON_START=true`; o valor real da variável deve ser conferido no painel antes de assumir o comportamento de produção.

**Anti-cold-start:** o serviço está no plano pago do Render (`0.5c-512mb`), que não hiberna. O antigo `keep-warm.yml` foi removido em 21/09/2026: pingava a cada 5 min e esgotou os minutos gratuitos do GitHub Actions.
**Backup:** `.github/workflows/backup.yml` — `pg_dump` diário às 07:00 UTC, artifact privado por 7 dias (44 MB cada; 30 dias estourava os 500 MB gratuitos).

Variáveis sensíveis vivem no env group do Render e no dashboard da Vercel. **Nunca commitar chave.**

---

## Workflow

- Instale dependências com `pnpm install --frozen-lockfile`.
- Antes de publicar, rode lint, typecheck, testes, builds e `pnpm auditoria` conforme [`DEPLOY.md`](./DEPLOY.md).
- Não faça push ou deploy com arquivos não relacionados misturados no mesmo commit.
- Variáveis sensíveis vivem nos painéis dos provedores e nunca entram no Git.

---

## Changelog resumido

- **24/07/2026** — Auditoria de claims. Removidos dados de análise fabricados da landing (fallback e esteira), o claim "2:1 validated minimum R/R", a confiança 80% e o badge "LIVE" dos mocks, os bullets de pricing inexistentes (priority/institutional) e os resíduos de "Ações BR" nos 6 idiomas.
- **20-21/07/2026** — Migrações consertadas (session pooler), e-mails 100% funcionando, e-mail de recuperação, "What would change my mind" no WAIT, calendário econômico nos 6 idiomas, heatmap de consistência, backup diário, grounding turbinado (RSI + range + momentum).
- **17-19/07/2026** — Grounding do quick e outcome tracking no ar.
- **13/07/2026** — Prompt v7.3 (calibração de confiança) + UI de tier de convicção + primeiro backtest reprodutível.

---

Repositório privado. Uso interno.
