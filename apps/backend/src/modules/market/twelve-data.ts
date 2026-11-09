/**
 * Twelve Data: o UNICO caminho para api.twelvedata.com no backend (27/10/2026).
 *
 * Por que existe: em 27/10/2026 a cota gratis (800 creditos/dia, 8/minuto)
 * estourou (886 de 800). Sem cota, a analise de ouro/forex sai sem candles
 * reais (o grounding que a vitrine promete; ouro e ~59% do uso), o monitor de
 * alertas para de checar ouro/forex e o sweeper marcava a analise como
 * UNTRACKABLE para sempre. Decisao do dono: nada pago.
 *
 * Quem consome (cada um com o seu rotulo no medidor):
 *   analysis  grounding do quick e do deep (market/candle-store.ts, pelo ai.adapter.ts)
 *   monitor   monitor de alertas e preco na criacao do alerta (setup-alerts.service.ts)
 *   sweeper   outcome sweeper 48h depois (worker/outcome.sweeper.ts via candles.ts)
 *   calibration  calibracao do motor (replay-variants.ts --calibrate), so com
 *             o dia abaixo de calibrationMaxDayTotal no MESMO medidor
 * Scripts de medicao (prompt-replay, backtest-runner, analysis-pilot-runner,
 * scripts/backtest/fetch-extra.mjs) NUNCA usam a chave de producao: entram em
 * modo experimento e leem TWELVE_DATA_API_KEY_EXPERIMENTS.
 *
 * Regras:
 * - Medidor unico por dia UTC e por minuto, compartilhado entre as 2 instancias
 *   do Render e o worker (Redis). Sem Redis, conta em memoria e loga degradado
 *   (a calibracao nao roda sem Redis).
 * - Prioridade: analise primeiro, depois monitor, depois sweeper. Quem tem menos
 *   prioridade nunca gasta a reserva de quem tem mais; analise nunca fica sem
 *   candle por causa do monitor ou do sweeper.
 * - Monitor: o intervalo sai da reserva que ainda resta no dia, dividida pelos
 *   ativos vigiados (ouro pesa mais). Acima de 80% do dia: monitor de forex a
 *   cada 30 min e sweeper de forex so no dia seguinte. Acima de 95%: so analise.
 * - Fim de semana (forex/metal fechado): monitor e sweeper nao chamam.
 * - Twelve Data disse "acabaram os creditos": ninguem chama de novo ate a virada
 *   do dia UTC.
 * - Cache das respostas "ultimos N candles" compartilhado entre grounding e
 *   monitor: mesma requisicao (ativo, intervalo, tamanho) dentro da validade =
 *   a MESMA resposta, sem nova chamada.
 */
import { RedisConnection } from 'bullmq';

export type TwelveDataConsumer = 'analysis' | 'monitor' | 'sweeper' | 'calibration';
export type TwelveDataDenyReason = 'no_key' | 'market_closed' | 'budget' | 'rate_limited' | 'quota_exhausted';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Orcamento num lugar so. Ajustar pela linha `[twelvedata]` do worker. */
export const TWELVE_DATA_BUDGET = {
  dailyLimit: 800,
  perMinute: 8,
  /** Reserva do dia por prioridade. O sweeper fica com o resto. */
  reserve: { analysis: 550, monitor: 200 },
  /** A calibracao so pede com o total do dia abaixo disto (sobram 250 para os usuarios). */
  calibrationMaxDayTotal: 550,
  /** Monitor e sweeper deixam sempre 3 vagas do minuto para a analise. */
  lowPriorityPerMinute: 5,
  slowAbove: 0.8,
  analysisOnlyAbove: 0.95,
  /** Menor intervalo por ativo: as velas sao de 5m, abaixo disto nao muda quase nada. */
  monitorMinIntervalMs: 2 * MINUTE,
  monitorSlowIntervalMs: 30 * MINUTE,
  /** Peso na divisao da reserva do monitor; quem nao esta aqui pesa 1. Ouro e ~59% do uso. */
  monitorWeight: { XAUUSD: 3 } as Record<string, number>,
  /** Minuto cheio: a analise espera a virada se faltar ate isto. */
  analysisMinuteWaitMs: 4_000,
} as const;

export class TwelveDataUnavailableError extends Error {
  constructor(readonly reason: TwelveDataDenyReason) {
    super(`Twelve Data indisponivel: ${reason}`);
    this.name = 'TwelveDataUnavailableError';
  }
}

/** Forex e metais fecham do fim da sexta (22h UTC) ao fim do domingo (22h UTC). */
export function fxMarketClosed(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22);
}

// ── Modo experimento (scripts de medicao) ───────────────────────────────────

let experimentMode = false;
let calibrationMode = false;
const refusedLogged = new Set<string>();

/**
 * Chamado no topo de todo script de medicao. A partir dai so a chave
 * TWELVE_DATA_API_KEY_EXPERIMENTS vale (nunca a de producao) e o medidor fica
 * em memoria, fora dos contadores de producao.
 */
export function enterTwelveDataExperimentMode(): void {
  experimentMode = true;
  store = null;
}

/**
 * Calibracao do motor (replay-variants.ts --calibrate, decisao do dono em
 * 02/11/2026): chave de PRODUCAO e o MESMO medidor de producao (Redis), que ja
 * conta analises, monitor e sweeper. Sem Redis, nao chama.
 */
export function enterTwelveDataCalibrationMode(): void {
  calibrationMode = true;
}

export function twelveDataApiKey(): string | null {
  const key = experimentMode ? process.env.TWELVE_DATA_API_KEY_EXPERIMENTS : process.env.TWELVE_DATA_API_KEY;
  return key?.trim() || null;
}

/**
 * Script sem a chave de experimento: forex/metal nao roda (mensagem clara uma
 * vez por script). Devolve true quando o item deve ser pulado.
 */
export function experimentRefusesFx(script: string): boolean {
  if (!experimentMode || twelveDataApiKey()) return false;
  if (!refusedLogged.has(script)) {
    refusedLogged.add(script);
    console.warn(
      `[${script}] Forex/metal RECUSADO: defina TWELVE_DATA_API_KEY_EXPERIMENTS (conta gratis separada do Twelve Data). ` +
        'Scripts nunca usam a chave de producao, para nao gastar a cota das analises.',
    );
  }
  return true;
}

// ── Contadores (Redis ou memoria) ───────────────────────────────────────────

export type TwelveDataUsage = {
  day: string;
  total: number;
  minute: number;
  analysis: number;
  monitor: number;
  sweeper: number;
  calibration: number;
  exhausted: boolean;
  store: 'redis' | 'memory';
};

export interface TwelveDataStore {
  readonly kind: 'redis' | 'memory';
  /** INCR de cada chave, com o TTL de cada uma. */
  incr(entries: Array<[key: string, ttlSec: number]>): Promise<number[]>;
  decr(keys: string[]): Promise<void>;
  get(keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** true so na primeira vez (SET NX). */
  once(key: string, ttlSec: number): Promise<boolean>;
}

export class MemoryTwelveDataStore implements TwelveDataStore {
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private read(key: string): string | null {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.values.delete(key);
      return null;
    }
    return hit.value;
  }

  async incr(entries: Array<[string, number]>): Promise<number[]> {
    return entries.map(([key, ttlSec]) => {
      const current = this.read(key);
      const next = Number(current ?? 0) + 1;
      const expiresAt = current === null ? this.now() + ttlSec * 1000 : this.values.get(key)!.expiresAt;
      this.values.set(key, { value: String(next), expiresAt });
      return next;
    });
  }

  async decr(keys: string[]): Promise<void> {
    for (const key of keys) {
      const hit = this.values.get(key);
      if (hit) hit.value = String(Math.max(0, Number(hit.value) - 1));
    }
  }

  async get(keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.read(key));
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.values.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
  }

  async once(key: string, ttlSec: number): Promise<boolean> {
    if (this.read(key) !== null) return false;
    await this.set(key, '1', ttlSec);
    return true;
  }
}

export type RedisLike = {
  multi(): { incr(k: string): unknown; expire(k: string, s: number): unknown; exec(): Promise<Array<[Error | null, unknown]> | null> };
  decr(k: string): Promise<number>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(...args: Array<string | number>): Promise<unknown>;
};

export class RedisTwelveDataStore implements TwelveDataStore {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: RedisLike) {}

  async incr(entries: Array<[string, number]>): Promise<number[]> {
    const tx = this.redis.multi();
    for (const [key, ttlSec] of entries) {
      tx.incr(key);
      tx.expire(key, ttlSec);
    }
    const out = (await tx.exec()) ?? [];
    return entries.map((_, i) => Number(out[i * 2]?.[1] ?? 0));
  }

  async decr(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.redis.decr(key)));
  }

  async get(keys: string[]): Promise<Array<string | null>> {
    return keys.length ? this.redis.mget(...keys) : [];
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSec);
  }

  async once(key: string, ttlSec: number): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', ttlSec, 'NX')) === 'OK';
  }
}

let store: TwelveDataStore | null = null;
let storePromise: Promise<TwelveDataStore> | null = null;
let clock: () => Date = () => new Date();

function redisOptions() {
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      return null;
    }
  }
  if (process.env.REDIS_HOST) return { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || '6379', 10) };
  return null;
}

async function getStore(): Promise<TwelveDataStore> {
  if (store) return store;
  if (!storePromise) {
    storePromise = (async () => {
      const opts = experimentMode ? null : redisOptions();
      if (opts) {
        try {
          const connection = new RedisConnection(
            { ...opts, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3_000 },
            { shared: false, blocking: false, skipVersionCheck: true },
          );
          const client = await Promise.race([
            connection.client,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000).unref()),
          ]);
          store = new RedisTwelveDataStore(client as unknown as RedisLike);
          return store;
        } catch (error) {
          console.warn(`[twelvedata] Redis indisponivel, contando em memoria (degradado): ${(error as Error)?.message ?? error}`);
        }
      } else if (!experimentMode) {
        console.warn('[twelvedata] Sem Redis configurado: contando em memoria por processo (degradado).');
      }
      store = new MemoryTwelveDataStore(() => clock().getTime());
      return store;
    })();
  }
  return storePromise;
}

export function __setTwelveDataForTests(options: { store?: TwelveDataStore | null; now?: () => Date } = {}): void {
  store = options.store ?? new MemoryTwelveDataStore(() => (options.now ?? (() => new Date()))().getTime());
  storePromise = null;
  clock = options.now ?? (() => new Date());
  experimentMode = false;
  calibrationMode = false;
  refusedLogged.clear();
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10).replace(/-/g, '');
const minuteOf = (now: Date) => now.toISOString().slice(0, 16).replace(/[-T:]/g, '');
const KEYS = (now: Date) => {
  const day = dayOf(now);
  return {
    total: `td:day:${day}`,
    analysis: `td:day:${day}:analysis`,
    monitor: `td:day:${day}:monitor`,
    sweeper: `td:day:${day}:sweeper`,
    calibration: `td:day:${day}:calibration`,
    minute: `td:min:${minuteOf(now)}`,
    exhausted: `td:exhausted:${day}`,
    day,
  };
};

export async function twelveDataUsage(now: Date = clock()): Promise<TwelveDataUsage> {
  const k = KEYS(now);
  const s = await getStore();
  const [total, analysis, monitor, sweeper, calibration, minute, exhausted] = await s.get([
    k.total, k.analysis, k.monitor, k.sweeper, k.calibration, k.minute, k.exhausted,
  ]);
  return {
    day: k.day,
    total: Number(total ?? 0),
    analysis: Number(analysis ?? 0),
    monitor: Number(monitor ?? 0),
    sweeper: Number(sweeper ?? 0),
    calibration: Number(calibration ?? 0),
    minute: Number(minute ?? 0),
    exhausted: exhausted !== null,
    store: s.kind,
  };
}

/**
 * Pode gastar 1 credito agora? Recebe o uso ANTES deste pedido. null = pode.
 * Puro, para teste: as regras de prioridade moram so aqui.
 */
export function twelveDataDecision(
  consumer: TwelveDataConsumer,
  usage: Pick<TwelveDataUsage, 'total' | 'minute' | 'analysis' | 'monitor' | 'exhausted'>,
  now: Date,
  budget = TWELVE_DATA_BUDGET,
  experiment = false,
): TwelveDataDenyReason | null {
  if (usage.exhausted || usage.total >= budget.dailyLimit) return 'quota_exhausted';
  if (experiment || consumer === 'analysis') return usage.minute >= budget.perMinute ? 'rate_limited' : null;
  if (consumer === 'calibration') {
    if (usage.total >= budget.calibrationMaxDayTotal) return 'budget';
    return usage.minute >= budget.lowPriorityPerMinute ? 'rate_limited' : null;
  }
  if (fxMarketClosed(now)) return 'market_closed';
  const used = usage.total / budget.dailyLimit;
  if (used >= budget.analysisOnlyAbove) return 'budget';
  if (usage.minute >= budget.lowPriorityPerMinute) return 'rate_limited';
  const analysisLeft = Math.max(0, budget.reserve.analysis - usage.analysis);
  if (consumer === 'monitor') {
    if (usage.monitor >= budget.reserve.monitor) return 'budget';
    return usage.total + 1 > budget.dailyLimit - analysisLeft ? 'budget' : null;
  }
  if (used >= budget.slowAbove) return 'budget';
  const monitorLeft = Math.max(0, budget.reserve.monitor - usage.monitor);
  return usage.total + 1 > budget.dailyLimit - analysisLeft - monitorLeft ? 'budget' : null;
}

/** Minutos de mercado aberto ate a virada do dia UTC, quando a reserva recomeca. */
export function fxOpenMinutesLeftToday(now: Date): number {
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const close = now.getUTCDay() === 5 ? 22 * 60 : 24 * 60;
  return Math.max(0, close - minute);
}

/**
 * Intervalo por ativo de forex/metal: o menor que a reserva do monitor ainda
 * paga ate o fim do dia, com o ouro pesando mais. Refeito a cada volta, entao
 * dia com folga fica mais rapido sozinho e nunca passa do orcamento. Acima de
 * 80% do dia, 30 min.
 */
export function monitorFxIntervals(
  symbols: readonly string[],
  usage: Pick<TwelveDataUsage, 'total' | 'analysis' | 'monitor'>,
  now: Date,
  budget = TWELVE_DATA_BUDGET,
): Map<string, number> {
  const left = Math.max(0, Math.min(budget.reserve.monitor - usage.monitor, budget.dailyLimit - usage.total - Math.max(0, budget.reserve.analysis - usage.analysis)));
  const minutes = Math.max(1, fxOpenMinutesLeftToday(now));
  const weightOf = (symbol: string) => budget.monitorWeight[symbol] ?? 1;
  const totalWeight = symbols.reduce((sum, symbol) => sum + weightOf(symbol), 0);
  const slow = usage.total / budget.dailyLimit >= budget.slowAbove;
  return new Map(
    symbols.map((symbol) => {
      const credits = (left * weightOf(symbol)) / totalWeight;
      const spread = credits > 0 ? Math.ceil(minutes / credits) * MINUTE : budget.monitorSlowIntervalMs;
      const interval = Math.max(budget.monitorMinIntervalMs, spread);
      return [symbol, slow ? Math.max(interval, budget.monitorSlowIntervalMs) : interval];
    }),
  );
}

async function take(consumer: TwelveDataConsumer, now: Date): Promise<TwelveDataDenyReason | null> {
  const s = await getStore();
  const k = KEYS(now);
  const before = await twelveDataUsage(now);
  const preliminary = twelveDataDecision(consumer, before, now, TWELVE_DATA_BUDGET, experimentMode);
  if (preliminary) return preliminary;
  // INCR devolve valores em sequencia entre processos: quem passa do limite
  // pelo proprio valor desfaz e recua. Nunca estoura; na corrida, recusa a mais.
  const DAY_TTL = 2 * 24 * 3600;
  const [total, mine, minute] = await s.incr([[k.total, DAY_TTL], [k[consumer], DAY_TTL], [k.minute, 120]]);
  const after = { ...before, total: total - 1, minute: minute - 1, [consumer]: mine - 1 };
  const denied = twelveDataDecision(consumer, after, now, TWELVE_DATA_BUDGET, experimentMode);
  if (denied) {
    await s.decr([k.total, k[consumer], k.minute]);
    return denied;
  }
  const used = total / TWELVE_DATA_BUDGET.dailyLimit;
  for (const [threshold, label] of [
    [TWELVE_DATA_BUDGET.slowAbove, '80% (monitor de forex a cada 30 min, sweeper de forex amanha)'],
    [TWELVE_DATA_BUDGET.analysisOnlyAbove, '95% (so analise)'],
  ] as const) {
    if (used >= threshold && !experimentMode && (await s.once(`td:warn:${Math.round(threshold * 100)}:${k.day}`, DAY_TTL))) {
      console.warn(`[twelvedata] Passou de ${label}: ${total}/${TWELVE_DATA_BUDGET.dailyLimit} creditos hoje.`);
    }
  }
  return null;
}

// ── Chamada e cache ─────────────────────────────────────────────────────────

export type TwelveDataValue = { datetime: string; open: string; high: string; low: string; close: string; volume?: string };
export type TwelveDataSeries = { values: TwelveDataValue[]; fetchedAt: number };
export type TwelveDataResult =
  | { ok: true; series: TwelveDataSeries; cached: boolean }
  | { ok: false; reason: TwelveDataDenyReason | 'error' };

export type TwelveDataRequest = {
  consumer: TwelveDataConsumer;
  /** Par canonico (XAUUSD). */
  pair: string;
  /** Intervalo do Twelve Data (5min, 30min, 1h...). */
  interval: string;
  outputsize: number;
  /** Janela fixa (sweeper). Com janela, nada de cache. */
  window?: { startMs: number; endMs: number };
  /** Aceita resposta "ultimos N" guardada ha ate isto. */
  cacheMaxAgeMs?: number;
  timeoutMs?: number;
};

const CACHE_TTL_SEC = 15 * 60;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Abertura da vela em ms. Toda URL pede `timezone=UTC`, entao o texto
 * ("2026-11-09 13:05:00", ou so a data no 1d) e sempre lido como UTC. Unico
 * parser do horario do Twelve Data.
 */
export const twelveDataOpenMs = (datetime: string): number =>
  Date.parse(/\d:\d/.test(datetime) ? `${datetime.replace(' ', 'T')}Z` : `${datetime}T00:00:00Z`);

const INTERVAL_MS_OF: Record<string, number> = { min: MINUTE, h: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR };
const intervalMs = (interval: string): number => {
  const m = /^(\d+)(min|h|day|week)$/.exec(interval);
  return m ? Number(m[1]) * INTERVAL_MS_OF[m[2]] : 0;
};

/**
 * Sempre em UTC (09/11/2026): sem `timezone=UTC` o forex e o ouro vem no fuso do
 * provedor (11h a frente em novembro) e o `meta` nem traz `exchange_timezone`
 * para perceber. Exportada para o teste provar a URL.
 */
export function twelveDataUrl(req: TwelveDataRequest, key: string): string {
  const symbol = `${req.pair.slice(0, 3)}/${req.pair.slice(3)}`;
  if (req.window) {
    return (
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${req.interval}&timezone=UTC` +
      `&start_date=${encodeURIComponent(iso(req.window.startMs))}&end_date=${encodeURIComponent(iso(req.window.endMs))}` +
      `&outputsize=${req.outputsize}&apikey=${key}`
    );
  }
  return (
    `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${req.interval}&timezone=UTC` +
    `&outputsize=${req.outputsize}&apikey=${key}`
  );
}

const cacheKeyOf = (req: TwelveDataRequest) =>
  req.window ? null : `td:cache:${req.pair}:${req.interval}:${req.outputsize}:utc`;

export async function twelveDataTimeSeries(req: TwelveDataRequest): Promise<TwelveDataResult> {
  const key = twelveDataApiKey();
  if (!key) return { ok: false, reason: 'no_key' };
  const s = await getStore();
  if (calibrationMode && (req.consumer !== 'calibration' || s.kind !== 'redis')) {
    throw new Error('[twelvedata] Calibracao so roda com consumer calibration e o medidor de producao (Redis).');
  }
  const cacheKey = cacheKeyOf(req);
  if (cacheKey && req.cacheMaxAgeMs) {
    const [raw] = await s.get([cacheKey]);
    if (raw) {
      try {
        const series = JSON.parse(raw) as TwelveDataSeries;
        if (clock().getTime() - series.fetchedAt <= req.cacheMaxAgeMs) return { ok: true, series, cached: true };
      } catch {
        /* cache ruim = busca de novo */
      }
    }
  }

  let denied = await take(req.consumer, clock());
  if (denied === 'rate_limited' && req.consumer === 'analysis') {
    const now = clock();
    const toNextMinute = MINUTE - (now.getTime() % MINUTE);
    if (toNextMinute <= TWELVE_DATA_BUDGET.analysisMinuteWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, toNextMinute + 50));
      denied = await take(req.consumer, clock());
    }
  }
  if (denied) return { ok: false, reason: denied };

  type Body = { status?: string; code?: number; message?: string; values?: TwelveDataValue[] };
  let series: TwelveDataSeries;
  try {
    const res = await fetch(twelveDataUrl(req, key), {
      headers: { 'User-Agent': 'tickrify/1.0' },
      signal: AbortSignal.timeout(req.timeoutMs ?? 8_000),
    });
    const body = (await res.json().catch(() => null)) as Body | null;
    const message = String(body?.message ?? '');
    const outOfCredits = res.status === 429 || body?.code === 429 || /run out of api credits/i.test(message);
    // "for the current minute" e o limite de 8/min: so pula a rodada.
    if (outOfCredits && /minute/i.test(message)) return { ok: false, reason: 'rate_limited' };
    if (outOfCredits) {
      const day = KEYS(clock());
      await s.set(day.exhausted, '1', 2 * 24 * 3600);
      if (!experimentMode && (await s.once(`td:warn:exhausted:${day.day}`, 2 * 24 * 3600))) {
        console.warn(`[twelvedata] Cota do dia acabou no provedor: ninguem chama de novo ate a virada UTC. ${message.slice(0, 120)}`);
      }
      return { ok: false, reason: 'quota_exhausted' };
    }
    if (!res.ok || !body || !Array.isArray(body.values)) return { ok: false, reason: 'error' };
    // Vela no futuro = horario errado: descarta a resposta inteira, nunca grava nem usa.
    const newest = body.values.reduce((max, v) => Math.max(max, twelveDataOpenMs(v.datetime) || 0), 0);
    if (newest > clock().getTime() + intervalMs(req.interval)) {
      console.warn(`[twelvedata] Resposta descartada: vela no futuro pair=${req.pair} interval=${req.interval} newest=${new Date(newest).toISOString()}`);
      return { ok: false, reason: 'error' };
    }
    series = { values: body.values, fetchedAt: clock().getTime() };
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (cacheKey) await s.set(cacheKey, JSON.stringify(series), CACHE_TTL_SEC).catch(() => undefined);
  return { ok: true, series, cached: false };
}

/** Linha de hora em hora no worker: o consumo do dia por quem gastou. */
export function startTwelveDataReport(log: (message: string) => void = console.log): void {
  const report = async () => {
    try {
      const u = await twelveDataUsage();
      log(
        `[twelvedata] day=${u.total}/${TWELVE_DATA_BUDGET.dailyLimit} minute=${u.minute}/${TWELVE_DATA_BUDGET.perMinute} ` +
          `analysis=${u.analysis} monitor=${u.monitor} sweeper=${u.sweeper} calibration=${u.calibration}${u.exhausted ? ' exhausted=1' : ''}${u.store === 'memory' ? ' store=memory(degradado)' : ''}`,
      );
    } catch (error) {
      log(`[twelvedata] Relatorio falhou: ${(error as Error)?.message ?? error}`);
    }
  };
  setTimeout(() => void report(), 60_000).unref();
  setInterval(() => void report(), HOUR).unref();
}
