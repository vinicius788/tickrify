# [RASCUNHO — NÃO PUBLICAR SEM SUA DECISÃO EXPLÍCITA]

> **Por que está em rascunho:** a regra interna do projeto (CLAUDE.md) diz que nenhum número de backtest
> vai para marketing sem decisão explícita + metodologia + disclaimer. Este draft já inclui metodologia
> e disclaimer — mas a decisão de publicar é sua. Quando aprovar, eu converto para HTML no padrão do blog
> e adiciono ao sitemap.
> **Sugestão:** publicar como "evento" quando o outcome tracking de produção tiver ~50–100 outcomes,
> atualizando o artigo com os números REAIS de produção — história ainda mais forte.

---

# We Backtested Our Own AI Against a Year of Market Data. Here's the Ugly Truth.

Every AI trading tool claims accuracy. Almost none of them show a measurement. We decided to measure ours — blind, reproducibly, against a full year of real market data — and publish what we found, including the parts that hurt.

## The methodology (so you can judge it)

- **Data:** real candles — BTC and ETH (30m and 4h, 12 months, Binance spot), gold and EURUSD (Twelve Data; 4h covers 12 months, 30m covers ~60 days).
- **Sampling:** blind, with a fixed random seed and a minimum 24h gap between samples, so we couldn't cherry-pick charts.
- **Test:** the exact production engine analyzed each rendered chart. A "win" = price hits TP1 before the stop loss, and only counts if the entry was actually filled.
- **Scale:** hundreds of analyses across two engine versions.

## What we found

**Finding 1: the raw win rate is unimpressive — and that's the honest baseline of this entire industry.** Our engine's decided trades won less than half the time in this test. If anyone tells you their chart AI wins 80–90% of the time, ask for their methodology. We'll wait.

**Finding 2: the first version of our confidence score was decoration.** It said "75" on almost every chart. Zero information. We suspect — but can't prove — that most tools in this niche still work this way, because without a backtest you'd never find out.

**Finding 3 (the one that changed our product): confidence can be made honest.** After rebuilding the engine with calibration in mind, high-confidence reads won at roughly **double** the rate of low-confidence reads. That measured threshold is now in the product: reads below it are labeled "Read" (context, not a trade), and only calibrated high-confidence reads are labeled "Signal".

**Finding 4: the engine says WAIT most of the time.** On the majority of blind charts, it refused to trade. We think that's its most valuable behavior — most charts, most of the time, don't offer a trade worth taking.

## What this means for you

We can't sell you an edge. Nobody honestly can — a chart contains no news, no order flow, no liquidity. What we can sell you is a **calibrated second opinion**: a checkpoint that commits to entry, stop, targets and invalidation, tells you how much its own confidence has been worth historically, and isn't afraid to say "no trade."

*Past performance does not predict future results. Backtests use rendered charts that differ from real user screenshots, exclude spreads/slippage/fees, and cover specific assets and periods only. Nothing here is financial advice. Trading involves substantial risk of loss.*

---

> **Nota pro Vini:** os números exatos (37,5%, 25% vs 56%, 72,7% WAIT, n, ICs) estão de fora de propósito
> nesta versão — o texto usa "less than half", "roughly double", "majority". Se você decidir publicar COM
> os números exatos + tabela de calibração (mais forte, mais crível), me avisa que eu insiro direto do
> Tickrify_Backtest_Report_v2.md com os intervalos de confiança.
