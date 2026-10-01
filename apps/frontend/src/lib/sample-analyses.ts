// Tres analises de exemplo FIXAS do painel (SampleAnalyses.tsx).
//
// Nao sao escritas a mao: cada `fullResponse` e a coluna `result` de uma
// analise real da conta do dono (manual_owner_1), copiada sem editar (so as
// URLs do Storage, que sao privadas, viraram o print no bundle). Os campos do
// topo seguem as colunas da linha, como o `serializeAnalysis` devolve.
// O "depois" mora em `t.samples.after` (6 idiomas) e so afirma o que foi
// medido: `outcomeDetail` do sweeper (candles de 30m, 48h) nos dois com
// entrada; candles BTCUSDT 5m da Binance no WAIT.
// Nada aqui chama a IA nem passa pela cota: e so dado no bundle.
//
// Trocar um exemplo = trocar a analise inteira (texto, grafico e o "depois"
// nos 6 idiomas) por outra real. Nunca editar o texto do motor nem inventar
// o resultado.
import type { AIAnalysisResponse } from './api';
import bullishChart from '@/assets/sample-bullish-eurjpy.png';
import bearishChart from '@/assets/sample-bearish-xauusd.png';
import neutralChart from '@/assets/sample-neutral-btcusd.png';

export type SampleKind = 'bullish' | 'bearish' | 'neutral';

export interface SampleAnalysis {
  kind: SampleKind;
  analysis: AIAnalysisResponse;
}

/** Analysis cmu6aeuiz000nl407swre06nq (18/09/2026), outcome WIN, tp2Hit true. */
const BULLISH_EURJPY = {
  bias: 'bullish',
  symbol: 'EURJPY',
  analysis: {
    tp1Y: 0.043,
    tp2Y: 0,
    entry: 179.25,
    stopY: 0.409,
    entryY: 0.261,
    symbol: 'EURJPY',
    stopLoss: 179.08,
    chartType: 'Candlestick',
    entryType: 'limit',
    reasoning:
      '[HTF+MTF] Bullish bias; M5 bullish, M15 bullish, H1 neutral, 2/3 aligned. [MATURITY] mature; sharp multi-leg rally near 179.391. [CHART] Candlestick, New York session. [ICT] Bullish OB/FVG near 179.200-179.270; buy-side liquidity 179.450. [LIQUIDITY MAP] sell-side 179.080 below entry; filter against until swept. [CONTINUATION] Re-accumulation favors continuation; no confirmed reversal. [CANDLE] Bullish displacement from 179.050. [ANTI-RETAIL] Avoid chasing extended highs. [RISCO] Invalidation 179.050; limit pullback, partial at 179.500. [DECISAO] 5/7; liquidity filter against, BUY limit only.',
    timeframe: '5M',
    riskFactors:
      'Late-stage trend; pullback risk is elevated. Unswept sell-side liquidity below entry may be taken first. Close below 179.050 invalidates the bullish thesis.',
    takeProfit1: 179.5,
    takeProfit2: 179.65,
    currentPrice: 179.391,
    marketRegime: 'trending',
    keyIndicators: 'Pure price action analysis; no volume visible. Planned stop is 17 pips; TP1 25 pips; TP2 40 pips.',
    riskRewardTp1: 1.47,
    riskRewardTp2: 2.35,
    trendStrength: 'moderate',
    entryCondition: 'Buy only near 179.250 after sell-side sweep/reclaim; do not chase 179.391.',
    factorsPresent: 5,
    probabilityTp1: 58,
    probabilityTp2: 40,
    whyNotOpposite:
      'Bearish reversal lacks CHoCH and follow-through. Liquidity filter: AGAINST — unswept sell-side near 179.080 sits below entry; wait for a sweep/reclaim, with stop below 179.080.',
    confluenceScore: 71.43,
    marketStructure: {
      bias: 'bullish',
      priceZone: 'Premium zone near 179.391; wait for discount pullback.',
      orderBlock: 'Bullish OB at 179.200-179.270',
      lastStructure: 'Higher highs and higher lows after bullish displacement from 178.950.',
      breakOfStructure: 'BOS bullish confirmed',
    },
    probabilityStop: 42,
    riskFactorsList: [
      'Late-stage trend; pullback risk is elevated. Unswept sell-side liquidity below entry may be taken first. Close below 179.050 invalidates the bullish thesis.',
    ],
    riskRewardRatio: '1:2.4',
    stopLossPercent: -0.095,
    tp1ClosePercent: 50,
    tp2ClosePercent: 50,
    breakevenTrigger: 'After TP1 at 179.500 is hit.',
    executiveSummary:
      'HTF structure is bullish, with M5 BOS and a fresh bullish OB/FVG near 179.200-179.270. The current rally is mature, so chasing 179.391 is unfavorable.\nChecklist passes 5/7; H1 is neutral and sell-side liquidity remains below the planned entry.\nPlace a limit buy near 179.250 after a sweep/reclaim, stop 179.080, targets 179.500 and 179.650. Action: wait for the pullback.',
    invalidationNote: 'Setup invalidated if price closes below 179.050, breaking the bullish displacement and protected swing low.',
    marketRegimeNote: 'Trending bullish regime; favor pullback continuation entries, not market chasing.',
    technicalSummary:
      'HTF structure is bullish, with M5 BOS and a fresh bullish OB/FVG near 179.200-179.270. The current rally is mature, so chasing 179.391 is unfavorable.\nChecklist passes 5/7; H1 is neutral and sell-side liquidity remains below the planned entry.\nPlace a limit buy near 179.250 after a sweep/reclaim, stop 179.080, targets 179.500 and 179.650. Action: wait for the pullback.',
    invalidationLevel: 179.05,
    technicalAnalysis:
      'HTF bias is bullish from the visible higher-high/higher-low sequence. M5 shows bullish BOS and strong displacement, but price is mature and extended into premium. Favor a limit buy at the bullish OB/FVG near 179.250, only after sell-side liquidity is swept or reclaimed.',
    trendStrengthNote: 'Strong impulse, but multiple completed legs and extended premium pricing reduce continuation quality.',
    identifiedPatterns: 'Bullish BOS; bullish OB/FVG 179.200-179.270; buy-side liquidity 179.450; late-stage displacement.',
    takeProfit1Percent: 0.14,
    takeProfit2Percent: 0.223,
    alternativeScenario:
      'If price closes below 179.050, bullish structure fails; consider SELL on retest near 179.080, targeting 178.900.',
    partialExitStrategy: 'Close 50% at 179.500. Move stop to entry after TP1; trail remaining 50% toward 179.650.',
    structureValidation:
      '✅ HTF bullish | ✅ Discount OB 179.250 | ✅ OB/FVG present | ✅ No reversal trap | ✅ BOS 179.300 | ✅ R:R 1:2.35 | ❌ MTF H1 neutral → 5/7 → BUY limit',
    multiTimeframeAlignment: 'M5 BULLISH | M15 BULLISH | H1 NEUTRAL → 2/3 aligned — moderate setup',
  },
  reasoning:
    '[HTF+MTF] Bullish bias; M5 bullish, M15 bullish, H1 neutral, 2/3 aligned. [MATURITY] mature; sharp multi-leg rally near 179.391. [CHART] Candlestick, New York session. [ICT] Bullish OB/FVG near 179.200-179.270; buy-side liquidity 179.450. [LIQUIDITY MAP] sell-side 179.080 below entry; filter against until swept. [CONTINUATION] Re-accumulation favors continuation; no confirmed reversal. [CANDLE] Bullish displacement from 179.050. [ANTI-RETAIL] Avoid chasing extended highs. [RISCO] Invalidation 179.050; limit pullback, partial at 179.500. [DECISAO] 5/7; liquidity filter against, BUY limit only.',
  timeframe: '5M',
  confidence: 57.99999999999999,
  drawing_plan: null,
  drawing_failed: true,
  recommendation: 'BUY',
};

/** Analysis cmu1fex61002nn207krsc0puj (14/09/2026), outcome WIN, tp2Hit false. */
const BEARISH_XAUUSD = {
  bias: 'bearish',
  symbol: 'XAUUSD',
  analysis: {
    tp1Y: 0.57,
    tp2Y: 0.66,
    entry: 4308,
    stopY: 0.34,
    entryY: 0.49,
    symbol: 'XAUUSD',
    stopLoss: 4330,
    chartType: 'Candlestick',
    entryType: 'limit',
    reasoning:
      '[HTF+MTF] 5m bearish; 1H bearish LH+LL; 4H corrective bearish, conflict macro. [MATURITY] mid, rebound remains below 4310. [CHART] Candlestick, overlap. [ICT] Bearish OB 4305-4315; sell-side 4260. [LIQUIDITY MAP] buy-side 4315, sell-side 4260; filter favors sell. [CONTINUATION] 1H redistribution-like decline; no flat confirmed. [CANDLE] Rejection near 4300, no confirmed zone engulfing. [ANTI-RETAIL] Buying rebound risks inducement into bearish OB. [RISCO] Invalidate 4330; limit 4308; partial 4280. [DECISAO] 6/7; liquidity favorable; SELL limit.',
    timeframe: '5M',
    riskFactors: 'Late rebound may extend before entry.\n4H macro support near $4290 can react.\nInvalidate on close above $4330.',
    takeProfit1: 4280,
    takeProfit2: 4258,
    currentPrice: 4290.94,
    marketRegime: 'trending',
    keyIndicators: 'Pure price action analysis; volume not visible. XAUUSD risk: $22 stop, TP1 $28, TP2 $50.',
    riskRewardTp1: 1.27,
    riskRewardTp2: 2.27,
    trendStrength: 'moderate',
    entryCondition: 'Place a sell limit at $4308 within the $4305-$4315 OB; require rejection before entry.',
    factorsPresent: 6,
    probabilityTp1: 63,
    probabilityTp2: 43,
    whyNotOpposite:
      '1H bearish LH+LL rejects a bullish read; the 5m rebound may induce buyers into $4305-$4315. Liquidity filter: IN FAVOR—sell-side at $4260 is below entry; stop above $4330.',
    confluenceScore: 85.71,
    marketStructure: {
      bias: 'bearish',
      priceZone: 'Premium zone relative to the recent 4260-4300 rebound',
      orderBlock: 'Bearish OB at $4305-$4315',
      lastStructure: '5m shows lower highs and lower lows after the 4300 rebound.',
      breakOfStructure: 'BOS bearish confirmed',
    },
    probabilityStop: 37,
    riskFactorsList: [
      'Late rebound may extend before entry.',
      '4H macro support near $4290 can react.',
      'Invalidate on close above $4330.',
    ],
    riskRewardRatio: '1:2.3',
    stopLossPercent: -0.51,
    tp1ClosePercent: 50,
    tp2ClosePercent: 50,
    breakevenTrigger: 'After TP1 at $4280 is hit',
    executiveSummary:
      'HTF: 1H is bearish with LH+LL; 4H is correcting lower after a major rally. Execution: 5m rebound is corrective into the $4305-$4315 bearish OB.\nSix of seven checks pass; sell-side liquidity near $4260 supports the short. Place a limit sell, not a market chase.\nSell $4308, SL $4330, TP1 $4280, TP2 $4258. Watch $4330 for invalidation; above it, abandon shorts.',
    invalidationNote: 'Setup invalidated if price closes above $4330, breaking the 5m bearish sequence and OB rejection.',
    marketRegimeNote: 'Bearish trending conditions favor selling pullbacks to the OB rather than chasing lows.',
    technicalSummary:
      'HTF: 1H is bearish with LH+LL; 4H is correcting lower after a major rally. Execution: 5m rebound is corrective into the $4305-$4315 bearish OB.\nSix of seven checks pass; sell-side liquidity near $4260 supports the short. Place a limit sell, not a market chase.\nSell $4308, SL $4330, TP1 $4280, TP2 $4258. Watch $4330 for invalidation; above it, abandon shorts.',
    invalidationLevel: 4330,
    technicalAnalysis:
      'Top-down bias is bearish: 1H shows persistent LH+LL, while 4H is pulling back from a major high and remains under recent distribution. The 5m rebound is corrective into a bearish OB; favor a limit sell, not a market chase.',
    trendStrengthNote: '1H bearish structure is clear, but 4H support and overlapping candles reduce strength.',
    identifiedPatterns: 'Bearish OB $4305-$4315; sell-side liquidity $4260; 5m lower-high sequence; rejection near $4300.',
    takeProfit1Percent: 0.65,
    takeProfit2Percent: 1.16,
    alternativeScenario: 'If price closes above $4330, cancel the short; bullish continuation may target $4350, with no long until a bullish BOS.',
    partialExitStrategy: 'Close 50% at $4280. Move stop to entry after TP1; trail remaining 50% to $4258.',
    structureValidation:
      '✅ HTF 1H LH/LL | ✅ Premium $4308 | ✅ OB $4305-15 | ✅ No bullish confirmation | ✅ Bearish BOS | ✅ R:R 1:2.3 | ✅ MTF 2/3 → SELL',
    multiTimeframeAlignment:
      '5m BEARISH | 1H BEARISH LH+LL | 4H BEARISH CORRECTION after bullish impulse → 3/3 directional bearish, but 4H macro context is mixed',
  },
  reasoning:
    '[HTF+MTF] 5m bearish; 1H bearish LH+LL; 4H corrective bearish, conflict macro. [MATURITY] mid, rebound remains below 4310. [CHART] Candlestick, overlap. [ICT] Bearish OB 4305-4315; sell-side 4260. [LIQUIDITY MAP] buy-side 4315, sell-side 4260; filter favors sell. [CONTINUATION] 1H redistribution-like decline; no flat confirmed. [CANDLE] Rejection near 4300, no confirmed zone engulfing. [ANTI-RETAIL] Buying rebound risks inducement into bearish OB. [RISCO] Invalidate 4330; limit 4308; partial 4280. [DECISAO] 6/7; liquidity favorable; SELL limit.',
  timeframe: '5M',
  confidence: 63,
  drawing_plan: null,
  drawing_failed: true,
  recommendation: 'SELL',
};

/** Analysis cmulh8wz20007nu07vy3d4rkk (28/09/2026), WAIT, outcome ABSTAIN. */
const NEUTRAL_BTCUSD = {
  bias: 'neutral',
  symbol: 'BTCUSD',
  analysis: {
    tp1Y: null,
    tp2Y: null,
    entry: null,
    stopY: null,
    entryY: null,
    symbol: 'BTCUSD',
    stopLoss: null,
    chartType: 'Candlestick',
    entryType: null,
    reasoning:
      '[HTF+MTF] 5m bullish rebound, 1H neutral-bearish range, 4H bullish macro; conflict. [MATURITY] mature 5m rebound into 84,000 resistance. [CHART] Candlestick, session unknown. [ICT] Bearish supply near 84,000-84,200; demand near 82,600-82,800. [LIQUIDITY MAP] Buy-side 84,000-84,200 above; sell-side 82,600 below; filter mixed. [CONTINUATION] 4H bullish consolidation, no confirmed continuation entry. [CANDLE] Rejection near 84,000, no decisive zone confirmation. [ANTI-RETAIL] Avoid chasing resistance amid conflicting HTF. [RISCO] No valid entry; await sweep and BOS. [DECISAO] 3/7 + mixed liquidity filter + HOLD.',
    timeframe: '5M',
    riskFactors: '1H/4H conflict.\nRejection near 84,000 resistance.\nBreak below 82,600 weakens bullish structure.',
    takeProfit1: null,
    takeProfit2: null,
    currentPrice: 83670,
    marketRegime: 'ranging',
    keyIndicators: 'Pure price action analysis; volume not visible.',
    riskRewardTp1: null,
    riskRewardTp2: null,
    trendStrength: 'weak',
    entryCondition: null,
    factorsPresent: 3,
    probabilityTp1: null,
    probabilityTp2: null,
    whyNotOpposite:
      'Neither side has clean confirmation. Liquidity filter: MIXED — buy-side at 84,000-84,200 above and sell-side at 82,600-82,800 below; avoid the middle.',
    confluenceScore: 42.86,
    marketStructure: {
      bias: 'neutral',
      priceZone: 'Near equilibrium',
      orderBlock: 'Bearish OB at 84,000-84,200',
      lastStructure: '5m rebound made higher lows, but remains below 84,000 resistance.',
      breakOfStructure: 'No structural break visible',
    },
    probabilityStop: null,
    riskFactorsList: ['1H/4H conflict.', 'Rejection near 84,000 resistance.', 'Break below 82,600 weakens bullish structure.'],
    riskRewardRatio: null,
    stopLossPercent: null,
    tp1ClosePercent: null,
    tp2ClosePercent: null,
    breakevenTrigger: null,
    executiveSummary:
      'HTF context conflicts: 4H is bullish, but 1H is range-bound and the 5m rebound rejected near 84,000. Only 3/7 checklist factors pass, with no clean entry zone or confirmed structural break. Wait for a sweep and BOS; do not trade the middle.',
    invalidationNote: null,
    marketRegimeNote: 'The 1H range dominates; favor edge reactions and avoid entries near equilibrium.',
    technicalSummary:
      'HTF context conflicts: 4H is bullish, but 1H is range-bound and the 5m rebound rejected near 84,000. Only 3/7 checklist factors pass, with no clean entry zone or confirmed structural break. Wait for a sweep and BOS; do not trade the middle.',
    invalidationLevel: null,
    technicalAnalysis:
      'Execution 5m shows a sharp bullish rebound from approximately 82,600 toward 84,000, followed by rejection. The 1H is range-bound with bearish short-term pressure, while the 4H remains broadly bullish but consolidating. HTF conflict favors waiting for a liquidity sweep and confirmed BOS.',
    trendStrengthNote: 'Overlapping 1H candles and conflicting 5m impulse within a broad range.',
    identifiedPatterns:
      'Liquidity: buy-side near 84,000-84,200; sell-side near 82,600-82,800. Bearish rejection at resistance; no confirmed FVG entry.',
    takeProfit1Percent: null,
    takeProfit2Percent: null,
    alternativeScenario:
      'If price sweeps below 82,600 and reclaims it with bullish BOS, reassess a long toward 84,000. If price closes below 82,600, reassess bearish continuation.',
    partialExitStrategy: null,
    structureValidation:
      '✅ HTF 4H bullish | ❌ Zone equilibrium | ✅ ICT liquidity | ✅ Anti-retail wait | ❌ Structure mixed | ✅ R:R planned | ❌ MTF conflict → 3/7 → HOLD',
    multiTimeframeAlignment: '5m BULLISH rebound | 1H NEUTRAL-BEARISH range | 4H BULLISH consolidation → CONFLICT, 1/3 aligned',
  },
  evidence: {
    version: 1,
    calendar: 'not_confirmed',
    candleFeedAttached: false,
    marketContextAttached: false,
    additionalChartsDelivered: 2,
  },
  reasoning:
    '[HTF+MTF] 5m bullish rebound, 1H neutral-bearish range, 4H bullish macro; conflict. [MATURITY] mature 5m rebound into 84,000 resistance. [CHART] Candlestick, session unknown. [ICT] Bearish supply near 84,000-84,200; demand near 82,600-82,800. [LIQUIDITY MAP] Buy-side 84,000-84,200 above; sell-side 82,600 below; filter mixed. [CONTINUATION] 4H bullish consolidation, no confirmed continuation entry. [CANDLE] Rejection near 84,000, no decisive zone confirmation. [ANTI-RETAIL] Avoid chasing resistance amid conflicting HTF. [RISCO] No valid entry; await sweep and BOS. [DECISAO] 3/7 + mixed liquidity filter + HOLD.',
  timeframe: '5M',
  confidence: 42,
  drawing_plan: null,
  drawing_failed: true,
  recommendation: 'WAIT',
};

/** Monta a resposta como a API devolve: colunas no topo, `result` em `fullResponse`. */
function asApiResponse(
  id: string,
  createdAt: string,
  chart: string,
  result: { recommendation: string; bias: string; confidence: number; reasoning: string },
  confidence: number,
): AIAnalysisResponse {
  return {
    id,
    status: 'completed',
    recommendation: result.recommendation as AIAnalysisResponse['recommendation'],
    bias: result.bias as AIAnalysisResponse['bias'],
    confidence,
    reasoning: result.reasoning,
    original_image_url: chart,
    imageUrl: chart,
    fullResponse: { ...result, original_image_url: chart } as unknown as AIAnalysisResponse['fullResponse'],
    createdAt,
    updatedAt: createdAt,
  };
}

export const SAMPLE_ANALYSES: SampleAnalysis[] = [
  {
    kind: 'bullish',
    analysis: asApiResponse('sample-bullish', '2026-09-18T01:36:06.155Z', bullishChart, BULLISH_EURJPY, 58),
  },
  {
    kind: 'bearish',
    analysis: asApiResponse('sample-bearish', '2026-09-14T15:57:16.777Z', bearishChart, BEARISH_XAUUSD, 63),
  },
  {
    kind: 'neutral',
    analysis: asApiResponse('sample-neutral', '2026-09-28T16:43:59.342Z', neutralChart, NEUTRAL_BTCUSD, 42),
  },
];
