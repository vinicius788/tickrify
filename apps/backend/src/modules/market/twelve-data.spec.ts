import {
  MemoryTwelveDataStore,
  RedisTwelveDataStore,
  type RedisLike,
  TWELVE_DATA_BUDGET,
  __setTwelveDataForTests,
  enterTwelveDataExperimentMode,
  enterTwelveDataCalibrationMode,
  experimentRefusesFx,
  fxMarketClosed,
  fxOpenMinutesLeftToday,
  monitorFxIntervals,
  twelveDataApiKey,
  twelveDataDecision,
  twelveDataTimeSeries,
  twelveDataUrl,
  twelveDataUsage,
} from './twelve-data';
import { fetchFxLatest5m, fetchFxWindow } from './candles';
import { TwelveDataUnavailableError } from './twelve-data';

const TUESDAY = new Date('2026-10-27T12:00:10Z');
const SATURDAY = new Date('2026-10-31T12:00:00Z');
const usage = (u: Partial<{ total: number; minute: number; analysis: number; monitor: number; exhausted: boolean }>) => ({
  total: 0, minute: 0, analysis: 0, monitor: 0, exhausted: false, ...u,
});

const values = (n: number, from = Date.parse('2026-10-27T02:00:00Z')) =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(from + (n - 1 - i) * 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    return { datetime: t, open: '4000', high: '4010', low: '3990', close: String(4000 + i), volume: '0' };
  });
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

let now = TUESDAY;
let fetchSpy: jest.SpyInstance;
const oldKey = process.env.TWELVE_DATA_API_KEY;
const oldExp = process.env.TWELVE_DATA_API_KEY_EXPERIMENTS;

beforeEach(() => {
  now = TUESDAY;
  __setTwelveDataForTests({ store: new MemoryTwelveDataStore(() => now.getTime()), now: () => now });
  process.env.TWELVE_DATA_API_KEY = 'prod-key';
  delete process.env.TWELVE_DATA_API_KEY_EXPERIMENTS;
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ values: values(120), meta: { exchange_timezone: 'UTC' } }) as any);
});
afterEach(() => {
  fetchSpy.mockRestore();
  if (oldKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
  else process.env.TWELVE_DATA_API_KEY = oldKey;
  if (oldExp === undefined) delete process.env.TWELVE_DATA_API_KEY_EXPERIMENTS;
  else process.env.TWELVE_DATA_API_KEY_EXPERIMENTS = oldExp;
});

describe('orcamento por prioridade (puro)', () => {
  it('analise usa o dia inteiro; monitor e sweeper nunca comem a reserva dela', () => {
    expect(twelveDataDecision('analysis', usage({ total: 799, analysis: 799 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('analysis', usage({ total: 800 }), TUESDAY)).toBe('quota_exhausted');
    // Sem analise nenhuma ainda: monitor pode ate 250 (800 - 550), mas o teto dele e 200.
    expect(twelveDataDecision('monitor', usage({ total: 199, monitor: 199 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('monitor', usage({ total: 200, monitor: 200 }), TUESDAY)).toBe('budget');
    // Sweeper fica com o resto: 800 - 550 - 200 = 50 enquanto ninguem gastou.
    expect(twelveDataDecision('sweeper', usage({ total: 49 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('sweeper', usage({ total: 50 }), TUESDAY)).toBe('budget');
    // Analise ja gastou a reserva dela: o sweeper so nao come a reserva do monitor (800 - 200).
    expect(twelveDataDecision('sweeper', usage({ total: 599, analysis: 599 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('sweeper', usage({ total: 600, analysis: 600 }), TUESDAY)).toBe('budget');
  });

  it('acima de 80%: sweeper espera o dia seguinte; acima de 95%: so analise', () => {
    expect(twelveDataDecision('sweeper', usage({ total: 640, analysis: 640 }), TUESDAY)).toBe('budget');
    expect(twelveDataDecision('monitor', usage({ total: 640, analysis: 600, monitor: 40 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('monitor', usage({ total: 760, analysis: 700, monitor: 60 }), TUESDAY)).toBe('budget');
    expect(twelveDataDecision('analysis', usage({ total: 760, analysis: 700, monitor: 60 }), TUESDAY)).toBeNull();
  });

  it('8 por minuto: monitor e sweeper deixam 3 vagas para a analise', () => {
    expect(twelveDataDecision('monitor', usage({ minute: 4 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('monitor', usage({ minute: 5 }), TUESDAY)).toBe('rate_limited');
    expect(twelveDataDecision('analysis', usage({ minute: 7 }), TUESDAY)).toBeNull();
    expect(twelveDataDecision('analysis', usage({ minute: 8 }), TUESDAY)).toBe('rate_limited');
  });

  it('calibracao: so com o dia abaixo de 550 (sobram 250) e deixando 3 vagas do minuto', () => {
    const base = { minute: 0, analysis: 0, monitor: 0, exhausted: false };
    expect(twelveDataDecision('calibration', { ...base, total: 549 }, TUESDAY)).toBeNull();
    expect(twelveDataDecision('calibration', { ...base, total: 550 }, TUESDAY)).toBe('budget');
    expect(twelveDataDecision('calibration', { ...base, total: 100, minute: 5 }, TUESDAY)).toBe('rate_limited');
    expect(twelveDataDecision('calibration', { ...base, total: 100, exhausted: true }, TUESDAY)).toBe('quota_exhausted');
  });

  it('fim de semana: monitor e sweeper nao chamam; a analise segue', () => {
    expect(fxMarketClosed(new Date('2026-10-30T21:59:00Z'))).toBe(false);
    expect(fxMarketClosed(new Date('2026-10-30T22:00:00Z'))).toBe(true);
    expect(fxMarketClosed(SATURDAY)).toBe(true);
    expect(fxMarketClosed(new Date('2026-11-01T21:30:00Z'))).toBe(true);
    expect(fxMarketClosed(new Date('2026-11-01T22:00:00Z'))).toBe(false);
    expect(twelveDataDecision('monitor', usage({}), SATURDAY)).toBe('market_closed');
    expect(twelveDataDecision('sweeper', usage({}), SATURDAY)).toBe('market_closed');
    expect(twelveDataDecision('analysis', usage({}), SATURDAY)).toBeNull();
  });

  describe('intervalo do monitor', () => {
    const MIN = 60_000;
    const MONDAY = new Date('2026-11-09T00:00:00Z');
    const idle = { total: 0, analysis: 0, monitor: 0 };

    it('ouro sozinho usa a reserva inteira do dia', () => {
      expect(monitorFxIntervals(['XAUUSD'], idle, MONDAY).get('XAUUSD')).toBe(8 * MIN);
    });

    it('com outros ativos, o ouro pesa 3 vezes', () => {
      const intervals = monitorFxIntervals(['XAUUSD', 'EURUSD'], idle, MONDAY);
      expect(intervals.get('XAUUSD')).toBe(10 * MIN);
      expect(intervals.get('EURUSD')).toBe(29 * MIN);
    });

    it('dia com folga fica mais rapido, com piso de 2 min', () => {
      const evening = new Date('2026-11-09T20:00:00Z');
      expect(monitorFxIntervals(['XAUUSD'], idle, evening).get('XAUUSD')).toBe(2 * MIN);
    });

    it('nunca conta com a reserva de quem tem prioridade', () => {
      // Sobram 100 do monitor, mas so 50 cabem sem tocar a reserva da analise.
      const usage = { total: 350, analysis: 150, monitor: 100 };
      expect(monitorFxIntervals(['EURUSD'], usage, MONDAY).get('EURUSD')).toBe(29 * MIN);
    });

    it('acima de 80% do dia ou sem reserva: 30 min', () => {
      expect(monitorFxIntervals(['XAUUSD'], { total: 640, analysis: 550, monitor: 0 }, MONDAY).get('XAUUSD')).toBe(30 * MIN);
      expect(monitorFxIntervals(['XAUUSD'], { total: 200, analysis: 0, monitor: 200 }, MONDAY).get('XAUUSD')).toBe(30 * MIN);
    });

    it('sexta conta so ate o mercado fechar, as 22h UTC', () => {
      expect(fxOpenMinutesLeftToday(new Date('2026-11-13T21:00:00Z'))).toBe(60);
      expect(fxOpenMinutesLeftToday(new Date('2026-11-09T21:00:00Z'))).toBe(180);
    });
  });
});

describe('medidor com relogio falso', () => {
  const req = (consumer: 'analysis' | 'monitor' | 'sweeper') => ({ consumer, pair: 'XAUUSD', interval: '15min', outputsize: 120 });

  it('conta por quem gastou, por minuto e por dia UTC', async () => {
    await twelveDataTimeSeries(req('analysis'));
    await twelveDataTimeSeries(req('monitor'));
    await twelveDataTimeSeries(req('monitor'));
    expect(await twelveDataUsage()).toMatchObject({ total: 3, minute: 3, analysis: 1, monitor: 2, sweeper: 0, store: 'memory' });
    now = new Date(TUESDAY.getTime() + 60_000);
    expect((await twelveDataUsage()).minute).toBe(0);
    now = new Date('2026-10-28T00:00:01Z');
    expect((await twelveDataUsage()).total).toBe(0);
  });

  it('minuto cheio do monitor: pula a rodada sem chamar', async () => {
    for (let i = 0; i < TWELVE_DATA_BUDGET.lowPriorityPerMinute; i++) await twelveDataTimeSeries(req('monitor'));
    fetchSpy.mockClear();
    await expect(twelveDataTimeSeries(req('monitor'))).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await twelveDataUsage()).minute).toBe(TWELVE_DATA_BUDGET.lowPriorityPerMinute);
  });

  it('o provedor disse que os creditos do dia acabaram: ninguem chama de novo ate a virada UTC', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ code: 429, status: 'error', message: 'You have run out of API credits for the day. 886 API credits were used' }, 429) as any);
    await expect(twelveDataTimeSeries(req('analysis'))).resolves.toEqual({ ok: false, reason: 'quota_exhausted' });
    fetchSpy.mockClear();
    await expect(twelveDataTimeSeries(req('analysis'))).resolves.toEqual({ ok: false, reason: 'quota_exhausted' });
    expect(fetchSpy).not.toHaveBeenCalled();
    now = new Date('2026-10-28T00:01:00Z');
    await expect(twelveDataTimeSeries(req('analysis'))).resolves.toMatchObject({ ok: true });
  });

  it('limite do minuto no provedor so pula a rodada (nao trava o dia)', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ code: 429, status: 'error', message: 'You have run out of API credits for the current minute.' }, 429) as any);
    await expect(twelveDataTimeSeries(req('monitor'))).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect((await twelveDataUsage()).exhausted).toBe(false);
  });

  it('sem chave: nao chama', async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    await expect(twelveDataTimeSeries(req('analysis'))).resolves.toEqual({ ok: false, reason: 'no_key' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('cache compartilhado: mesma requisicao, mesma resposta', () => {
  it('a URL do grounding e a de sempre (sem fuso, ultimos 120)', () => {
    expect(twelveDataUrl({ consumer: 'analysis', pair: 'XAUUSD', interval: '5min', outputsize: 120 }, 'k')).toBe(
      'https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=120&apikey=k',
    );
    const start = Date.parse('2026-10-25T00:00:00Z');
    expect(twelveDataUrl({ consumer: 'sweeper', pair: 'EURUSD', interval: '30min', outputsize: 120, window: { startMs: start, endMs: start + 3600_000 } }, 'k')).toBe(
      'https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=30min&timezone=UTC&start_date=2026-10-25%2000%3A00%3A00&end_date=2026-10-25%2001%3A00%3A00&outputsize=120&apikey=k',
    );
  });

  it('dentro da validade devolve exatamente a mesma serie, sem gastar credito', async () => {
    const r = { consumer: 'analysis' as const, pair: 'XAUUSD', interval: '5min', outputsize: 120, cacheMaxAgeMs: 60_000 };
    const first = await twelveDataTimeSeries(r);
    now = new Date(TUESDAY.getTime() + 30_000);
    const second = await twelveDataTimeSeries(r);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect((second as any).series.values).toEqual((first as any).series.values);
    expect((await twelveDataUsage()).total).toBe(1);
    now = new Date(TUESDAY.getTime() + 61_000);
    await twelveDataTimeSeries(r);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('monitor reaproveita a resposta do grounding de 5m (horario em UTC)', async () => {
    await twelveDataTimeSeries({ consumer: 'analysis', pair: 'XAUUSD', interval: '5min', outputsize: 120, cacheMaxAgeMs: 60_000 });
    now = new Date(TUESDAY.getTime() + 5 * 60_000);
    const candles = await fetchFxLatest5m('XAUUSDm', 'monitor', 10 * 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(candles).toHaveLength(120);
    // Em ordem do mais antigo para o mais novo, horario lido como UTC.
    expect(candles![0][0]).toBe(Date.parse('2026-10-27T02:00:00Z'));
    expect(candles![119][0]).toBe(Date.parse('2026-10-27T02:00:00Z') + 119 * 5 * 60_000);
    expect((await twelveDataUsage()).monitor).toBe(0);
  });

  it('horario fora de UTC: o monitor nao reaproveita e pede de novo em UTC', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ values: values(120), meta: { exchange_timezone: 'America/New_York' } }) as any);
    await fetchFxLatest5m('XAUUSD', 'monitor', 10 * 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('&timezone=UTC&');
  });

  it('janela fixa (sweeper) nunca usa cache', async () => {
    await fetchFxWindow('XAUUSD', Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-22T00:00:00Z'), '30m', 1);
    await fetchFxWindow('XAUUSD', Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-22T00:00:00Z'), '30m', 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('recusa do orcamento LANCA (quem chama adia), falha comum devolve null', async () => {
    now = SATURDAY;
    await expect(fetchFxWindow('XAUUSD', 0, 1, '30m', 1)).rejects.toBeInstanceOf(TwelveDataUnavailableError);
    now = TUESDAY;
    fetchSpy.mockResolvedValueOnce(ok({ status: 'error', code: 400, message: 'bad symbol' }, 400) as any);
    await expect(fetchFxWindow('XAUUSD', 0, 1, '30m', 1)).resolves.toBeNull();
  });
});

describe('scripts: chave de experimento', () => {
  it('modo experimento nunca usa a chave de producao', async () => {
    enterTwelveDataExperimentMode();
    expect(twelveDataApiKey()).toBeNull();
    await expect(twelveDataTimeSeries({ consumer: 'analysis', pair: 'XAUUSD', interval: '5min', outputsize: 120 })).resolves.toEqual({
      ok: false,
      reason: 'no_key',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sem TWELVE_DATA_API_KEY_EXPERIMENTS: recusa forex/metal com mensagem clara (uma vez)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    enterTwelveDataExperimentMode();
    expect(experimentRefusesFx('prompt-replay')).toBe(true);
    expect(experimentRefusesFx('prompt-replay')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TWELVE_DATA_API_KEY_EXPERIMENTS');
    warn.mockRestore();
  });

  it('calibracao sem o medidor de producao (Redis): nao chama', async () => {
    enterTwelveDataCalibrationMode();
    expect(twelveDataApiKey()).toBe('prod-key');
    expect(experimentRefusesFx('replay-variants')).toBe(false);
    await expect(twelveDataTimeSeries({ consumer: 'calibration', pair: 'XAUUSD', interval: '1h', outputsize: 5000 })).rejects.toThrow('Redis');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('com a chave de experimento: usa so ela, com o medidor separado do de producao', async () => {
    process.env.TWELVE_DATA_API_KEY_EXPERIMENTS = 'exp-key';
    enterTwelveDataExperimentMode();
    expect(experimentRefusesFx('backtest-runner')).toBe(false);
    await twelveDataTimeSeries({ consumer: 'sweeper', pair: 'XAUUSD', interval: '30min', outputsize: 120 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('apikey=exp-key');
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('prod-key');
  });

  it('fora do modo experimento (app): usa a chave de producao', () => {
    expect(twelveDataApiKey()).toBe('prod-key');
    expect(experimentRefusesFx('app')).toBe(false);
  });
});

describe('store do Redis (cliente falso com os comandos do ioredis)', () => {
  function fakeRedis() {
    const data = new Map<string, string>();
    const ttl = new Map<string, number>();
    const redis: RedisLike = {
      multi() {
        const ops: Array<() => [null, unknown]> = [];
        const tx = {
          incr: (k: string) => { ops.push(() => { const v = Number(data.get(k) ?? 0) + 1; data.set(k, String(v)); return [null, v]; }); return tx; },
          expire: (k: string, sec: number) => { ops.push(() => { if (!ttl.has(k)) ttl.set(k, sec); return [null, 1]; }); return tx; },
          exec: async () => ops.map((op) => op()),
        };
        return tx;
      },
      decr: async (k: string) => { const v = Number(data.get(k) ?? 0) - 1; data.set(k, String(v)); return v; },
      mget: async (...keys: string[]) => keys.map((k) => data.get(k) ?? null),
      set: async (...args: Array<string | number>) => {
        const [k, v, , sec, nx] = args as [string, string, string, number, string?];
        if (nx === 'NX' && data.has(k)) return null;
        data.set(k, v); ttl.set(k, sec); return 'OK';
      },
    };
    return { redis, data, ttl };
  }

  it('INCR com TTL por chave, MGET, SET EX e SET NX', async () => {
    const { redis, data, ttl } = fakeRedis();
    const s = new RedisTwelveDataStore(redis);
    await expect(s.incr([['td:day:x', 172800], ['td:min:y', 120]])).resolves.toEqual([1, 1]);
    await expect(s.incr([['td:day:x', 172800], ['td:min:y', 120]])).resolves.toEqual([2, 2]);
    expect(ttl.get('td:min:y')).toBe(120);
    await s.decr(['td:day:x']);
    await expect(s.get(['td:day:x', 'nada'])).resolves.toEqual(['1', null]);
    await expect(s.once('warn', 60)).resolves.toBe(true);
    await expect(s.once('warn', 60)).resolves.toBe(false);
    await s.set('cache', '{}', 900);
    expect(data.get('cache')).toBe('{}');
  });

  it('calibracao: com o medidor de producao em 780, nao faz nenhum pedido', async () => {
    const { redis, data } = fakeRedis();
    __setTwelveDataForTests({ store: new RedisTwelveDataStore(redis), now: () => now });
    data.set('td:day:20261027', '780');
    enterTwelveDataCalibrationMode();
    const res = await twelveDataTimeSeries({ consumer: 'calibration', pair: 'XAUUSD', interval: '1h', outputsize: 5000 });
    expect(res).toEqual({ ok: false, reason: 'budget' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await twelveDataUsage()).total).toBe(780);
  });

  it('calibracao conta no medidor de producao e para no 550', async () => {
    const { redis, data } = fakeRedis();
    __setTwelveDataForTests({ store: new RedisTwelveDataStore(redis), now: () => now });
    data.set('td:day:20261027', '549');
    enterTwelveDataCalibrationMode();
    const req = { consumer: 'calibration' as const, pair: 'XAUUSD', interval: '1h', outputsize: 5000 };
    await expect(twelveDataTimeSeries(req)).resolves.toMatchObject({ ok: true });
    await expect(twelveDataTimeSeries(req)).resolves.toEqual({ ok: false, reason: 'budget' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('apikey=prod-key');
    expect(await twelveDataUsage()).toMatchObject({ total: 550, calibration: 1, store: 'redis' });
  });

  it('calibracao recusa outro consumidor (nunca gasta como sweeper)', async () => {
    const { redis } = fakeRedis();
    __setTwelveDataForTests({ store: new RedisTwelveDataStore(redis), now: () => now });
    enterTwelveDataCalibrationMode();
    await expect(twelveDataTimeSeries({ consumer: 'sweeper', pair: 'XAUUSD', interval: '1h', outputsize: 5000 })).rejects.toThrow('consumer calibration');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('duas instancias no mesmo Redis: o teto do minuto vale para as duas juntas', async () => {
    const { redis } = fakeRedis();
    const shared = new RedisTwelveDataStore(redis);
    __setTwelveDataForTests({ store: shared, now: () => now });
    const req = { consumer: 'monitor' as const, pair: 'XAUUSD', interval: '15min', outputsize: 120 };
    const results = await Promise.all(Array.from({ length: 8 }, () => twelveDataTimeSeries(req)));
    expect(results.filter((r) => r.ok)).toHaveLength(TWELVE_DATA_BUDGET.lowPriorityPerMinute);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'rate_limited')).toBe(true);
    expect((await twelveDataUsage()).minute).toBe(TWELVE_DATA_BUDGET.lowPriorityPerMinute);
  });
});
