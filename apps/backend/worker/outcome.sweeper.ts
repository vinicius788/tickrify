import { flagBool } from '../src/common/flags/feature-flags';
/**
 * Outcome tracking — a régua objetiva do motor, em produção.
 *
 * 48h (ou mais) depois de cada análise real completada, este sweeper busca os
 * candles reais do período e responde: o plano da IA teria dado certo?
 * A regra é a MESMA do backtest (scripts/backtest/evaluate.py) de propósito —
 * o que foi medido offline é o que é medido em produção:
 *
 *   - A posição só "existe" quando o preço TOCA o entry (fill). Sem toque → NO_FILL.
 *   - WIN  = TP1 tocado antes do SL (a partir do candle do fill, inclusive).
 *   - LOSS = SL tocado antes do TP1; mesmo candle tocando ambos → LOSS (conservador).
 *   - TIMEOUT = fill aconteceu mas nem TP1 nem SL até o fim da janela de 48h.
 *   - WAIT → ABSTAIN (fora do win rate; taxa própria).
 *   - Níveis ausentes/incoerentes → INCOMPLETE. Sem candles disponíveis → UNTRACKABLE.
 *
 * A avaliação roda em candles de 30m (96 candles = 48h), independente do
 * timeframe do gráfico: granularidade fina decide a corrida TP×SL com mais
 * precisão do que candles do TF original.
 *
 * Fontes de candles: src/modules/market/candles.ts (OKX, Binance de reserva,
 * Twelve Data para forex/ouro). Sem fonte → UNTRACKABLE (marcado, não
 * re-escaneado para sempre).
 *
 * Kill-switch: ENABLE_OUTCOME_TRACKING='false' desliga sem redeploy.
 * Best-effort absoluto: nenhuma falha aqui derruba o worker de análises.
 */
import { PrismaClient } from '@prisma/client';
import { fetchWindowFor, type Candle } from '../src/modules/market/candles';
import { TwelveDataUnavailableError } from '../src/modules/market/twelve-data';
import { FILL_CANDLE_RULE, type FillCandleRule } from '../src/modules/ai/accuracy.util';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1h
const FIRST_SWEEP_DELAY_MS = 3 * 60 * 1000; // 3min após o boot (deixa o worker estabilizar)
const MATURITY_MS = 48 * 60 * 60 * 1000; // análise só é avaliada 48h após criada
const WINDOW_MS = 48 * 60 * 60 * 1000; // janela de avaliação: 48h a partir da análise
const BATCH_SIZE = 25; // análises por varredura (mantém a varredura leve)
// Candidatas lidas por varredura: forex/metal adiado pela cota do Twelve Data
// (twelve-data.ts) nao conta no lote, para nao travar o resto atras dele.
const CANDIDATES = BATCH_SIZE * 4;
// WAIT por varredura. So o WAIT com niveis busca candles (7% deles em 20/10/2026).
const WAIT_BATCH_SIZE = 50;

type Outcome = 'WIN' | 'LOSS' | 'TIMEOUT' | 'NO_FILL' | 'ABSTAIN' | 'INCOMPLETE' | 'UNTRACKABLE';

export interface TradePlan {
  recommendation: 'BUY' | 'SELL';
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
}

/**
 * O que aconteceu DEPOIS do TP1 (20/10/2026, so medicao: nada aqui muda o
 * outcome). Permite avaliar TP2 e a hipotese de break-even sem chamar a IA.
 */
export interface AfterTp1 {
  /** TP2 antes do stop original, stop antes, nenhum ate o fim da janela, ou plano sem TP2. */
  tp2: 'hit' | 'stop' | 'timeout' | 'none';
  tp2Index: number | null;
  /** 1o candle DEPOIS do candle do TP1 que toca a entrada (gatilho do break-even). */
  entryRetouchIndex: number | null;
  /** O candle do TP1 tambem toca a entrada: em 30m a ordem dos dois e desconhecida. */
  tp1CandleTouchesEntry: boolean;
}

/**
 * Corrida TP1×SL. Com `rule = 'legacy'` e o evaluate_trade() do
 * scripts/backtest/evaluate.py com fill_candle_rule="legacy"; com `stop_only`, o
 * mesmo com fill_candle_rule="stop_only". Retorna o outcome e detalhes para auditoria.
 */
export function evaluateTrade(
  plan: TradePlan,
  window: Candle[],
  rule: FillCandleRule = FILL_CANDLE_RULE,
): {
  outcome: Outcome;
  fillIndex: number | null;
  resolvedIndex: number | null;
  tp2Hit: boolean;
  afterTp1: AfterTp1 | null;
} {
  const isBuy = plan.recommendation === 'BUY';
  const slHit = (c: Candle) => (isBuy ? c[3] <= plan.stopLoss : c[2] >= plan.stopLoss);
  const tpHit = (c: Candle, tp: number) => (isBuy ? c[2] >= tp : c[3] <= tp);
  const touches = (c: Candle, p: number) => c[3] <= p && p <= c[2];

  // Fill: a posição só existe quando o preço TOCA o entry.
  let fillIndex: number | null = null;
  for (let i = 0; i < window.length; i++) {
    if (touches(window[i], plan.entry)) {
      fillIndex = i;
      break;
    }
  }
  if (fillIndex === null) {
    return { outcome: 'NO_FILL', fillIndex: null, resolvedIndex: null, tp2Hit: false, afterTp1: null };
  }

  // Corrida a partir do candle do fill (inclusive). SL primeiro = LOSS,
  // inclusive quando o mesmo candle toca TP e SL (convenção conservadora).
  // stop_only: no candle do fill so o SL conta.
  let outcome: Outcome = 'TIMEOUT';
  let resolvedIndex: number | null = null;
  for (let i = fillIndex; i < window.length; i++) {
    if (slHit(window[i])) {
      outcome = 'LOSS';
      resolvedIndex = i;
      break;
    }
    if ((rule === 'legacy' || i > fillIndex) && tpHit(window[i], plan.takeProfit1)) {
      outcome = 'WIN';
      resolvedIndex = i;
      break;
    }
  }

  if (outcome !== 'WIN' || resolvedIndex === null) {
    return { outcome, fillIndex, resolvedIndex, tp2Hit: false, afterTp1: null };
  }

  // Mesmo laco de sempre para o TP2 (stop antes = nao atingiu); agora tambem
  // diz se parou no stop ou no fim da janela.
  let tp2: AfterTp1['tp2'] = plan.takeProfit2 == null ? 'none' : 'timeout';
  let tp2Index: number | null = null;
  if (plan.takeProfit2 != null) {
    for (let i = resolvedIndex; i < window.length; i++) {
      if (slHit(window[i])) {
        tp2 = 'stop';
        tp2Index = i;
        break;
      }
      if (tpHit(window[i], plan.takeProfit2)) {
        tp2 = 'hit';
        tp2Index = i;
        break;
      }
    }
  }

  let entryRetouchIndex: number | null = null;
  for (let i = resolvedIndex + 1; i < window.length; i++) {
    if (touches(window[i], plan.entry)) {
      entryRetouchIndex = i;
      break;
    }
  }

  return {
    outcome,
    fillIndex,
    resolvedIndex,
    tp2Hit: tp2 === 'hit',
    afterTp1: {
      tp2,
      tp2Index,
      entryRetouchIndex,
      tp1CandleTouchesEntry: touches(window[resolvedIndex], plan.entry),
    },
  };
}

/**
 * Plano de um WAIT que guardou os niveis (rebaixado por codigo: guard de R/R,
 * validador, news guard, guard de cripto). WAIT do proprio modelo vem sem
 * niveis e da null: nao ha plano para simular. O lado sai da geometria
 * (stop < entrada < TP1 = compra); TP2 so conta se estiver alem do TP1.
 */
export function extractShadowPlan(result: unknown): TradePlan | null {
  const root = result && typeof result === 'object' ? (result as Record<string, any>) : {};
  const a = root.analysis && typeof root.analysis === 'object' ? root.analysis : root;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  // WATCH do v10.1 nao tem entrada nem stop (saem da vela de gatilho que
  // ainda nao existe): fica fora da sombra, que so simula niveis guardados.
  const entry = num(a.entry);
  const stopLoss = num(a.stopLoss);
  const takeProfit1 = num(a.takeProfit1);
  const tp2 = num(a.takeProfit2);
  const symbol = String(a.symbol || root.symbol || '').trim();
  if (entry == null || stopLoss == null || takeProfit1 == null || !symbol) return null;

  const recommendation = stopLoss < entry && entry < takeProfit1
    ? 'BUY'
    : stopLoss > entry && entry > takeProfit1 ? 'SELL' : null;
  if (!recommendation) return null;
  const takeProfit2 = tp2 != null && (recommendation === 'BUY' ? tp2 > takeProfit1 : tp2 < takeProfit1) ? tp2 : null;
  return { recommendation, symbol, entry, stopLoss, takeProfit1, takeProfit2 };
}

/** Extrai o plano de trade do JSON persistido; null = sem plano avaliável. */
function extractPlan(recommendation: string | null, result: unknown): TradePlan | null | 'incoherent' {
  if (recommendation !== 'BUY' && recommendation !== 'SELL') return null;
  const root = result && typeof result === 'object' ? (result as Record<string, any>) : {};
  const a = root.analysis && typeof root.analysis === 'object' ? root.analysis : root;

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const entry = num(a.entry);
  const stopLoss = num(a.stopLoss);
  const takeProfit1 = num(a.takeProfit1);
  const takeProfit2 = num(a.takeProfit2);
  const symbol = String(a.symbol || root.symbol || '').trim();

  if (entry == null || stopLoss == null || takeProfit1 == null || !symbol) return 'incoherent';

  // Coerência dos níveis (mesma régua do evaluate.py):
  // BUY exige SL < entry < TP1; SELL o espelho.
  const coherent =
    recommendation === 'BUY'
      ? stopLoss < entry && entry < takeProfit1
      : stopLoss > entry && entry > takeProfit1;
  if (!coherent) return 'incoherent';

  return { recommendation, symbol, entry, stopLoss, takeProfit1, takeProfit2 };
}

export async function sweepOnce(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - MATURITY_MS);

  // 1) BUY/SELL maduras sem outcome (antes do WAIT: a fonte de candles e
  //    gratis e limitada, e o resultado real vem primeiro).
  await sweepTrades(prisma, cutoff);
  // 2) WAIT → ABSTAIN, com o resultado hipotetico ao lado (shadow).
  await sweepWaits(prisma, cutoff);
}

/**
 * WAIT → ABSTAIN (fora do win rate, como sempre). Desde 20/10/2026, o WAIT que
 * guardou os niveis tambem e simulado nos candles e o resultado vai para
 * `outcomeDetail.shadow`. A coluna `outcome` continua ABSTAIN: /accuracy,
 * vitrine, e-mail de resultado e My Trades leem so a coluna e nao mudam. So
 * passa por aqui WAIT com outcome null: o historico ja marcado nao e tocado.
 */
async function sweepWaits(prisma: PrismaClient, cutoff: Date): Promise<void> {
  const waits = await prisma.analysis.findMany({
    where: {
      status: 'completed',
      outcome: null,
      recommendation: 'WAIT',
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: WAIT_BATCH_SIZE,
    select: { id: true, result: true, createdAt: true },
  });

  let deferred = 0;
  for (const row of waits) {
    try {
      const plan = extractShadowPlan(row.result);
      let detail: Record<string, unknown> | undefined;
      if (plan) {
        const startMs = row.createdAt.getTime();
        const window = await fetchWindowFor(plan.symbol, startMs, startMs + WINDOW_MS);
        const engine = (row.result as Record<string, any> | null)?.engine;
        const reasons = Array.isArray(engine?.validator_reasons) ? engine.validator_reasons : null;
        const base = {
          version: 1,
          side: plan.recommendation,
          sideFrom: 'levels',
          reasons,
          symbol: plan.symbol,
          entry: plan.entry,
          stopLoss: plan.stopLoss,
          takeProfit1: plan.takeProfit1,
          takeProfit2: plan.takeProfit2,
          evaluatedOn: '30m',
          windowHours: 48,
          fillCandleRule: FILL_CANDLE_RULE,
        };
        if (!window) {
          detail = { shadow: { ...base, outcome: 'UNTRACKABLE' } };
        } else {
          const res = evaluateTrade(plan, window, FILL_CANDLE_RULE);
          detail = {
            shadow: {
              ...base,
              candles: window.length,
              outcome: res.outcome,
              fillIndex: res.fillIndex,
              resolvedIndex: res.resolvedIndex,
              tp2Hit: res.tp2Hit,
              afterTp1: res.afterTp1,
            },
          };
        }
      }
      await prisma.analysis.update({
        where: { id: row.id },
        data: { outcome: 'ABSTAIN', outcomeAt: new Date(), ...(detail ? { outcomeDetail: detail as any } : {}) },
      });
    } catch (err) {
      // Fica outcome=null e tenta de novo na proxima varredura.
      if (err instanceof TwelveDataUnavailableError) deferred++;
      else console.warn(`[Outcome] Falha no WAIT ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (deferred > 0) console.log(`[Outcome] ${deferred} WAIT de forex/metal adiado(s): cota do Twelve Data.`);
}

async function sweepTrades(prisma: PrismaClient, cutoff: Date): Promise<void> {
  const pending = await prisma.analysis.findMany({
    where: {
      status: 'completed',
      outcome: null,
      recommendation: { in: ['BUY', 'SELL'] },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: CANDIDATES,
    select: { id: true, recommendation: true, result: true, createdAt: true, isDemo: true },
  });

  if (pending.length === 0) return;
  console.log(`[Outcome] Avaliando ${Math.min(pending.length, BATCH_SIZE)} análise(s) madura(s)...`);

  let evaluated = 0;
  const deferred = new Map<string, number>();
  for (const row of pending) {
    if (evaluated >= BATCH_SIZE) break;
    try {
      const plan = extractPlan(row.recommendation, row.result);
      const startMs = row.createdAt.getTime();
      const endMs = startMs + WINDOW_MS;

      let outcome: Outcome;
      let detail: Record<string, unknown> = { evaluatedOn: '30m', windowHours: 48, fillCandleRule: FILL_CANDLE_RULE };

      if (plan === null || plan === 'incoherent') {
        outcome = 'INCOMPLETE';
        detail.reason = plan === null ? 'sem plano de trade' : 'níveis ausentes ou incoerentes';
      } else {
        const window = await fetchWindowFor(plan.symbol, startMs, endMs);

        if (!window) {
          outcome = 'UNTRACKABLE';
          detail.reason = `sem candles disponíveis para ${plan.symbol}`;
        } else {
          const res = evaluateTrade(plan, window, FILL_CANDLE_RULE);
          outcome = res.outcome;
          detail = {
            ...detail,
            symbol: plan.symbol,
            entry: plan.entry,
            stopLoss: plan.stopLoss,
            takeProfit1: plan.takeProfit1,
            takeProfit2: plan.takeProfit2,
            candles: window.length,
            fillIndex: res.fillIndex,
            resolvedIndex: res.resolvedIndex,
            tp2Hit: res.tp2Hit,
            afterTp1: res.afterTp1,
            isDemo: row.isDemo,
          };
        }
      }

      await prisma.analysis.update({
        where: { id: row.id },
        data: { outcome, outcomeAt: new Date(), outcomeDetail: detail as any },
      });
      console.log(`[Outcome] ${row.id} → ${outcome}`);
      evaluated++;
    } catch (err) {
      // Nunca derruba a varredura: loga e segue pro próximo. A análise fica
      // outcome=null e será re-tentada na próxima varredura. Cota do Twelve
      // Data (orcamento, fim de semana, acabou no dia) e adiamento, nunca
      // UNTRACKABLE: antes de 27/10 o dia sem cota marcava para sempre.
      if (err instanceof TwelveDataUnavailableError) {
        deferred.set(err.reason, (deferred.get(err.reason) ?? 0) + 1);
        continue;
      }
      evaluated++;
      console.warn(
        `[Outcome] Falha ao avaliar ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (deferred.size > 0) {
    const parts = [...deferred.entries()].map(([reason, n]) => `${reason}=${n}`).join(' ');
    console.log(`[Outcome] Forex/metal adiado pela cota do Twelve Data: ${parts}`);
  }
}

/** Liga o sweeper no processo do worker. Chamar uma vez, após o boot. */
export function startOutcomeSweeper(prisma: PrismaClient): void {
  if (!flagBool('ENABLE_OUTCOME_TRACKING')) {
    console.log('[Outcome] Outcome tracking DESLIGADO via env.');
    return;
  }
  const run = () =>
    sweepOnce(prisma).catch((err) =>
      console.warn(`[Outcome] Varredura falhou: ${err instanceof Error ? err.message : err}`),
    );
  setTimeout(run, FIRST_SWEEP_DELAY_MS);
  setInterval(run, SWEEP_INTERVAL_MS);
  console.log('[Outcome] Outcome tracking ligado (varredura a cada 1h, maturidade 48h).');
}
