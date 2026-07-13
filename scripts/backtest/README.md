# Backtest estatístico do motor Tickrify (análise quick)

Mede o win rate REAL do motor em dados históricos, com amostragem cega e
regras de avaliação fixadas antes de rodar (ver docstring de `evaluate.py`).
Objetivo: número verdadeiro para calibração de produto — não marketing.

## Pipeline

| Etapa | Script | Onde roda |
|---|---|---|
| A. Dados cripto (Binance, 12m) | `node scripts/backtest/fetch-data.mjs` | **seu terminal** (sandbox do Claude não alcança a Binance) |
| A2. XAUUSD + EURUSD (Yahoo: 4h=12m agregado de 1h, 30m=60d) | `node scripts/backtest/fetch-extra.mjs` | **seu terminal** |
| B. Amostragem cega (seed 20260713) | `node scripts/backtest/sample.mjs` | qualquer um |
| C1. Render dos gráficos | `python3 scripts/backtest/render.py` | sandbox do Claude (matplotlib) |
| C2. Análises via motor real | `cd apps/backend && npx ts-node scripts/backtest-runner.ts --limit 10` | **seu terminal** (com `OPENAI_API_KEY` exportada) |
| D. Avaliação + relatório | `python3 scripts/backtest/evaluate.py` | sandbox do Claude |

## Ordem de execução

1. `node scripts/backtest/fetch-data.mjs` (você)
2. Claude roda B + C1 e mostra a distribuição da amostra
3. **Piloto:** `cd apps/backend && export OPENAI_API_KEY=... && npx ts-node scripts/backtest-runner.ts --limit 10` (você)
4. Claude avalia o piloto → você aprova o custo (~US$3) → `npx ts-node scripts/backtest-runner.ts` (retomável; `--yes` pula a confirmação)
5. Claude roda a avaliação final → `Tickrify_Backtest_Report.md` + `Tickrify_Backtest_Results.csv` na raiz

## Regras inegociáveis

- Seed fixa; amostra nunca é re-sorteada depois de ver resultados (p-hacking proibido).
- Convenções sempre conservadoras (TP+SL no mesmo candle = LOSS).
- O prompt do sistema nunca é gravado em arquivo nenhum.
- Nada vai para site/marketing sem decisão explícita depois do relatório completo.
- XAUUSD/EURUSD entram via Yahoo Finance com janelas menores (30m = 60 dias; 4h = agregado de 1h) — limitação dita no relatório. Metas por série fixadas antes de rodar: 75 cripto, 40 (4h) e 25 (30m) em XAU/EUR ≈ 430 análises.

## Diferenças deliberadas vs produção (documentadas no relatório)

- `ENABLE_NEWS_GUARD=false` — o guard consulta o calendário de HOJE; aplicado a
  gráficos históricos contaminaria o resultado. Ele só rebaixa sinais → produção
  é igual ou mais conservadora que o número medido.
- Prompt resolvido do arquivo (`TRADING_SYSTEM_PROMPT`) a menos que `DATABASE_URL`
  esteja no ambiente — aí usa o PromptConfig ativo do banco, como produção.

`data/`, `charts/` e `results/` são cache local (gitignored). Código + seed
versionados = qualquer um reproduz.
