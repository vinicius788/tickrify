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
 * Fontes de candles: OKX primário (Binance bloqueia IPs dos EUA, onde o Render
 * roda), Binance spot fallback; forex/ouro via Twelve Data se TWELVE_DATA_API_KEY
 * existir. Sem fonte → UNTRACKABLE (marcado, não re-escaneado para sempre).
 *
 * Kill-switch: ENABLE_OUTCOME_TRACKING='false' desliga sem redeploy.
 * Best-effort absoluto: nenhuma falha aqui derruba o worker de análises.
 */
import { PrismaClient } from '@prisma/client';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1h
const FIRST_SWEEP_DELAY_MS = 3 * 60 * 1000; // 3min após o boot (deixa o worker estabilizar)
const MATURITY_MS = 48 * 60 * 60 * 1000; // análise só é avaliada 48h após criada
const WINDOW_MS = 48 * 60 * 60 * 1000; // janela de avaliação: 48h a partir da análise
const BATCH_SIZE = 25; // análises por varredura (mantém a varredura leve)

type Candle = [number, number, number, number, number]; // [ts, o, h, l, c]

type Outcome = 'WIN' | 'LOSS' | 'TIMEOUT' | 'NO_FILL' | 'ABSTAIN' | 'INCOMPLETE' | 'UNTRACKABLE';

interface TradePlan {
  recommendation: 'BUY' | 'SELL';
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
}

async function fetchJson<T>(url: string, timeoutMs = 6_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'tickrify/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Candles 30m de CRIPTO cobrindo [startMs, endMs].
 * OKX history-candles aceita `after` (retorna candles ANTERIORES ao ts) — um
 * pedido ancorado no fim da janela cobre os 96 candles de 48h em qualquer idade.
 */
async function fetchCryptoWindow(base: string, startMs: number, endMs: number): Promise<Candle[] | null> {
  const okx = await fetchJson<{ data?: string[][] }>(
    `https://www.okx.com/api/v5/market/history-candles?instId=${base}-USDT&bar=30m&after=${endMs + 1}&limit=100`,
  );
  const rows = okx?.data;
  if (Array.isArray(rows) && rows.length > 0) {
    const candles = rows
      .map((r): Candle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])])
      .filter((c) => c.every((v) => Number.isFinite(v)) && c[0] >= startMs && c[0] <= endMs)
      .sort((a, b) => a[0] - b[0]);
    if (candles.length >= 24) return candles; // >=12h de dados já decide a maioria dos casos
  }
  const bin = await fetchJson<Array<Array<string | number>>>(
    `https://api.binance.com/api/v3/klines?symbol=${base}USDT&interval=30m&startTime=${startMs}&limit=100`,
  );
  if (Array.isArray(bin) && bin.length > 0) {
    const candles = bin
      .map((r): Candle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])])
      .filter((c) => c.every((v) => Number.isFinite(v)) && c[0] <= endMs);
    if (candles.length >= 24) return candles;
  }
  return null;
}

/** Candles 30m de FOREX/METAIS via Twelve Data (se houver chave). */
async function fetchFxWindow(symbol: string, startMs: number, endMs: number): Promise<Candle[] | null> {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!key) return null;
  const m = symbol
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .match(/^(XAU|XAG|EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)(USD|JPY|CHF|CAD|GBP|EUR|AUD|NZD)$/);
  if (!m) return null;
  const startIso = new Date(startMs).toISOString().slice(0, 19).replace('T', ' ');
  const endIso = new Date(endMs).toISOString().slice(0, 19).replace('T', ' ');
  const td = await fetchJson<{
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
  }>(
    `https://api.twelvedata.com/time_series?symbol=${m[1]}/${m[2]}&interval=30min&timezone=UTC` +
      `&start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}&outputsize=120&apikey=${key}`,
    8_000,
  );
  const values = td?.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const candles = values
    .map((v): Candle => [
      Date.parse(`${v.datetime.replace(' ', 'T')}Z`),
      Number(v.open),
      Number(v.high),
      Number(v.low),
      Number(v.close),
    ])
    .filter((c) => c.every((n) => Number.isFinite(n)))
    .sort((a, b) => a[0] - b[0]);
  // Forex fecha no fim de semana — 24 candles (12h) bastam pra decidir a maioria.
  return candles.length >= 24 ? candles : null;
}

/**
 * Corrida TP1×SL — espelho fiel do evaluate_trade() do evaluate.py.
 * Retorna o outcome e detalhes para auditoria.
 */
export function evaluateTrade(
  plan: TradePlan,
  window: Candle[],
): { outcome: Outcome; fillIndex: number | null; resolvedIndex: number | null; tp2Hit: boolean } {
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
    return { outcome: 'NO_FILL', fillIndex: null, resolvedIndex: null, tp2Hit: false };
  }

  // Corrida a partir do candle do fill (inclusive). SL primeiro = LOSS,
  // inclusive quando o mesmo candle toca TP e SL (convenção conservadora).
  let outcome: Outcome = 'TIMEOUT';
  let resolvedIndex: number | null = null;
  for (let i = fillIndex; i < window.length; i++) {
    if (slHit(window[i])) {
      outcome = 'LOSS';
      resolvedIndex = i;
      break;
    }
    if (tpHit(window[i], plan.takeProfit1)) {
      outcome = 'WIN';
      resolvedIndex = i;
      break;
    }
  }

  let tp2Hit = false;
  if (outcome === 'WIN' && plan.takeProfit2 != null && resolvedIndex != null) {
    for (let i = resolvedIndex; i < window.length; i++) {
      if (slHit(window[i])) break;
      if (tpHit(window[i], plan.takeProfit2)) {
        tp2Hit = true;
        break;
      }
    }
  }

  return { outcome, fillIndex, resolvedIndex, tp2Hit };
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

async function sweepOnce(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - MATURITY_MS);

  // 1) WAIT → ABSTAIN em lote (sem candles; abstenção fica fora do win rate).
  await prisma.analysis.updateMany({
    where: {
      status: 'completed',
      outcome: null,
      recommendation: 'WAIT',
      createdAt: { lt: cutoff },
    },
    data: { outcome: 'ABSTAIN', outcomeAt: new Date() },
  });

  // 2) BUY/SELL maduras sem outcome.
  const pending = await prisma.analysis.findMany({
    where: {
      status: 'completed',
      outcome: null,
      recommendation: { in: ['BUY', 'SELL'] },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true, recommendation: true, result: true, createdAt: true, isDemo: true },
  });

  if (pending.length === 0) return;
  console.log(`[Outcome] Avaliando ${pending.length} análise(s) madura(s)...`);

  for (const row of pending) {
    try {
      const plan = extractPlan(row.recommendation, row.result);
      const startMs = row.createdAt.getTime();
      const endMs = startMs + WINDOW_MS;

      let outcome: Outcome;
      let detail: Record<string, unknown> = { evaluatedOn: '30m', windowHours: 48 };

      if (plan === null || plan === 'incoherent') {
        outcome = 'INCOMPLETE';
        detail.reason = plan === null ? 'sem plano de trade' : 'níveis ausentes ou incoerentes';
      } else {
        const { isCrypto, base } = normalizeToBinancePerp(plan.symbol);
        const window = isCrypto && base
          ? await fetchCryptoWindow(base, startMs, endMs)
          : await fetchFxWindow(plan.symbol, startMs, endMs);

        if (!window) {
          outcome = 'UNTRACKABLE';
          detail.reason = `sem candles disponíveis para ${plan.symbol}`;
        } else {
          const res = evaluateTrade(plan, window);
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
            isDemo: row.isDemo,
          };
        }
      }

      await prisma.analysis.update({
        where: { id: row.id },
        data: { outcome, outcomeAt: new Date(), outcomeDetail: detail as any },
      });
      console.log(`[Outcome] ${row.id} → ${outcome}`);
    } catch (err) {
      // Nunca derruba a varredura: loga e segue pro próximo. A análise fica
      // outcome=null e será re-tentada na próxima varredura.
      console.warn(
        `[Outcome] Falha ao avaliar ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
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
