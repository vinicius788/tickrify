/**
 * Sweeper (20/10/2026): o que acontece depois do TP1 e o resultado hipotetico
 * (shadow) do WAIT que guardou os niveis. `afterTp1` e `shadow` so medem: nao
 * mudam o `outcome` (WAIT continua ABSTAIN) e `tp2Hit` mantem o significado
 * antigo. A regra do candle do fill e outra coisa: com `stop_only` (padrao das
 * avaliacoes novas) o `outcome` de um trade novo pode mudar em relacao a
 * `legacy`, quando o TP1 so foi tocado no candle do fill.
 */
import { FILL_CANDLE_RULE } from '../modules/ai/accuracy.util';
import {
  evaluateTrade,
  extractShadowPlan,
  sweepOnce,
  type TradePlan,
} from '../../worker/outcome.sweeper';
import type { Candle } from '../modules/market/candles';
import { __setTwelveDataForTests } from '../modules/market/twelve-data';

const buy: TradePlan = { recommendation: 'BUY', symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 };
const sell: TradePlan = { recommendation: 'SELL', symbol: 'BTCUSDT', entry: 100, stopLoss: 105, takeProfit1: 90, takeProfit2: 80 };
// [ts, open, high, low, close]; so high/low importam para a corrida.
const c = (high: number, low: number, i = 0): Candle => [i, low, high, low, high];

// Copia do laco de TP2 de antes de 20/10: o significado de tp2Hit nao pode mudar.
function legacyTp2Hit(plan: TradePlan, w: Candle[], resolvedIndex: number): boolean {
  const isBuy = plan.recommendation === 'BUY';
  for (let i = resolvedIndex; i < w.length; i++) {
    if (isBuy ? w[i][3] <= plan.stopLoss : w[i][2] >= plan.stopLoss) return false;
    if (isBuy ? w[i][2] >= (plan.takeProfit2 as number) : w[i][3] <= (plan.takeProfit2 as number)) return true;
  }
  return false;
}

describe('evaluateTrade: depois do TP1', () => {
  it('TP2 antes do stop: hit, com o indice', () => {
    const r = evaluateTrade(buy, [c(101, 99), c(111, 104), c(121, 112)]);
    expect(r).toMatchObject({ outcome: 'WIN', resolvedIndex: 1, tp2Hit: true });
    expect(r.afterTp1).toEqual({ tp2: 'hit', tp2Index: 2, entryRetouchIndex: null, tp1CandleTouchesEntry: false });
  });

  it('stop antes do TP2: stop, e a entrada foi retocada no caminho', () => {
    const r = evaluateTrade(buy, [c(101, 99), c(111, 104), c(105, 99), c(103, 94)]);
    expect(r).toMatchObject({ outcome: 'WIN', tp2Hit: false });
    expect(r.afterTp1).toEqual({ tp2: 'stop', tp2Index: 3, entryRetouchIndex: 2, tp1CandleTouchesEntry: false });
  });

  it('nem TP2 nem stop ate o fim da janela: timeout', () => {
    const r = evaluateTrade(buy, [c(101, 99), c(111, 104), c(115, 106)]);
    expect(r.afterTp1).toMatchObject({ tp2: 'timeout', tp2Index: null, entryRetouchIndex: null });
  });

  it('plano sem TP2: none, mas o reteste da entrada continua medido', () => {
    const r = evaluateTrade({ ...buy, takeProfit2: null }, [c(101, 99), c(111, 104), c(102, 99.5)]);
    expect(r.afterTp1).toEqual({ tp2: 'none', tp2Index: null, entryRetouchIndex: 2, tp1CandleTouchesEntry: false });
  });

  it('candle do TP1 que tambem toca a entrada fica marcado (ordem desconhecida em 30m)', () => {
    // O fill e no candle 0; o TP1 so conta no candle 1, que tambem toca a entrada.
    const r = evaluateTrade(buy, [c(101, 99), c(111, 99)]);
    expect(r).toMatchObject({ outcome: 'WIN', fillIndex: 0, resolvedIndex: 1 });
    expect(r.afterTp1?.tp1CandleTouchesEntry).toBe(true);
    expect(r.afterTp1?.entryRetouchIndex).toBeNull();
  });

  it('venda: espelho', () => {
    const r = evaluateTrade(sell, [c(101, 99), c(96, 89), c(100.5, 92), c(91, 79)]);
    expect(r).toMatchObject({ outcome: 'WIN', tp2Hit: true });
    expect(r.afterTp1).toEqual({ tp2: 'hit', tp2Index: 3, entryRetouchIndex: 2, tp1CandleTouchesEntry: false });
  });

  it('stop e TP2 no mesmo candle: stop (conservador), tp2Hit false', () => {
    const r = evaluateTrade(buy, [c(101, 99), c(111, 104), c(121, 94)]);
    expect(r).toMatchObject({ outcome: 'WIN', tp2Hit: false });
    expect(r.afterTp1).toMatchObject({ tp2: 'stop', tp2Index: 2 });
  });

  it('LOSS, TIMEOUT e NO_FILL nao tem afterTp1', () => {
    expect(evaluateTrade(buy, [c(101, 94)]).afterTp1).toBeNull();
    expect(evaluateTrade(buy, [c(101, 99), c(105, 98)]).afterTp1).toBeNull();
    expect(evaluateTrade(buy, [c(108, 102)])).toMatchObject({ outcome: 'NO_FILL', afterTp1: null });
  });

  it('tp2Hit igual ao algoritmo antigo em 2.000 janelas aleatorias', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 2000; n++) {
      const plan = n % 2 ? buy : sell;
      const w: Candle[] = Array.from({ length: 20 }, (_, i) => {
        const mid = 100 + (rand() - 0.5) * 50;
        const span = rand() * 12;
        return [i, mid, mid + span, mid - span, mid];
      });
      const r = evaluateTrade(plan, w);
      if (r.outcome === 'WIN') expect(r.tp2Hit).toBe(legacyTp2Hit(plan, w, r.resolvedIndex as number));
      else expect(r.tp2Hit).toBe(false);
    }
  });
});

describe('evaluateTrade: candle do fill (FILL_CANDLE_RULE = stop_only, 20/10/2026)', () => {
  it('TP1 tocado no mesmo candle do fill nao vira WIN: o stop depois decide', () => {
    expect(FILL_CANDLE_RULE).toBe('stop_only');
    expect(evaluateTrade(buy, [c(111, 99), c(102, 94)])).toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 1 });
  });

  it('TP1 no candle do fill e de novo depois: WIN no candle seguinte', () => {
    expect(evaluateTrade(buy, [c(111, 99), c(112, 101)])).toMatchObject({ outcome: 'WIN', fillIndex: 0, resolvedIndex: 1 });
  });

  it('TP1 so no candle do fill e nada depois: TIMEOUT, nunca WIN', () => {
    expect(evaluateTrade(buy, [c(111, 99), c(104, 98)])).toMatchObject({ outcome: 'TIMEOUT', resolvedIndex: null, afterTp1: null });
  });

  it('o stop continua valendo no candle do fill (convencao conservadora intacta)', () => {
    expect(evaluateTrade(buy, [c(111, 94)])).toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 0 });
    expect(evaluateTrade(sell, [c(106, 89)])).toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 0 });
  });

  it('venda: espelho', () => {
    expect(evaluateTrade(sell, [c(101, 89), c(106, 99)])).toMatchObject({ outcome: 'LOSS', resolvedIndex: 1 });
    expect(evaluateTrade(sell, [c(101, 89), c(99, 88)])).toMatchObject({ outcome: 'WIN', resolvedIndex: 1 });
  });

  it('caso real (XAUUSD 30m, 25/09/2026): o candle abriu acima do TP1 e so depois encheu a entrada', () => {
    // Analise cmugsp1hr001nr5071vh62jyo: compra limit 4.285,5, stop 4.279,5, TP1 4.298.
    // Em 1m: TP1 nos minutos 0 a 2 do candle, entrada so no minuto 25, stop no candle seguinte.
    // O sweeper gravou WIN; a regra nova da LOSS, como o 1m.
    const plan: TradePlan = { recommendation: 'BUY', symbol: 'XAUUSD', entry: 4285.5, stopLoss: 4279.5, takeProfit1: 4298, takeProfit2: 4302.5 };
    const w: Candle[] = [
      [1790341200000, 4299.15, 4299.48, 4280.09, 4280.42],
      [1790343000000, 4280.87, 4284.12, 4274.78, 4277.57],
    ];
    expect(evaluateTrade(plan, w)).toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 1 });
    expect(evaluateTrade(plan, w, 'legacy')).toMatchObject({ outcome: 'WIN', fillIndex: 0, resolvedIndex: 0 });
  });
});

// Copia literal do laco de outcome de antes de 20/10/2026 (regra legacy).
function legacyOracle(plan: TradePlan, w: Candle[]): { outcome: string; fillIndex: number | null; resolvedIndex: number | null } {
  const isBuy = plan.recommendation === 'BUY';
  const fill = w.findIndex((k) => k[3] <= plan.entry && plan.entry <= k[2]);
  if (fill < 0) return { outcome: 'NO_FILL', fillIndex: null, resolvedIndex: null };
  for (let i = fill; i < w.length; i++) {
    if (isBuy ? w[i][3] <= plan.stopLoss : w[i][2] >= plan.stopLoss) return { outcome: 'LOSS', fillIndex: fill, resolvedIndex: i };
    if (isBuy ? w[i][2] >= plan.takeProfit1 : w[i][3] <= plan.takeProfit1) return { outcome: 'WIN', fillIndex: fill, resolvedIndex: i };
  }
  return { outcome: 'TIMEOUT', fillIndex: fill, resolvedIndex: null };
}

describe('evaluateTrade: regra explicita legacy | stop_only', () => {
  it('o padrao das avaliacoes novas e stop_only', () => {
    expect(FILL_CANDLE_RULE).toBe('stop_only');
    const w = [c(111, 99), c(102, 94)];
    expect(evaluateTrade(buy, w)).toEqual(evaluateTrade(buy, w, 'stop_only'));
  });

  it('legacy reproduz a regra antiga em 2.000 janelas aleatorias', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let fillCandleWins = 0;
    for (let n = 0; n < 2000; n++) {
      const plan = n % 2 ? buy : sell;
      const w: Candle[] = Array.from({ length: 20 }, (_, i) => {
        const mid = 100 + (rand() - 0.5) * 50;
        const span = rand() * 12;
        return [i, mid, mid + span, mid - span, mid];
      });
      const want = legacyOracle(plan, w);
      expect(evaluateTrade(plan, w, 'legacy')).toMatchObject(want);
      const stopOnly = evaluateTrade(plan, w, 'stop_only');
      // stop_only nunca resolve um WIN no candle do fill...
      if (stopOnly.outcome === 'WIN') expect(stopOnly.resolvedIndex).toBeGreaterThan(stopOnly.fillIndex as number);
      // ...e so diverge do legacy quando o legacy deu WIN no candle do fill.
      if (want.outcome === 'WIN' && want.resolvedIndex === want.fillIndex) fillCandleWins += 1;
      else expect(stopOnly).toMatchObject(want);
    }
    expect(fillCandleWins).toBeGreaterThan(0);
  });

  // Janelas de 30m reais (cache de 12/10/2026, mesmas fontes do sweeper), cortadas do
  // candle do fill ate a resolucao. `prod` = o que o sweeper gravou. Em 1m, os 4
  // primeiros foram LOSS (TP1 antes do fill); o ultimo foi WIN (o TP1 voltou ainda
  // no candle do fill, depois da entrada): o caso que stop_only erra.
  const REAL: Array<{ id: string; plan: TradePlan; prod: string; stopOnly: string; truth1m: string; w: Candle[] }> = [
    { id: 'cmugsp1hr001nr5071vh62jyo', prod: 'WIN', stopOnly: 'LOSS', truth1m: 'LOSS',
      plan: { recommendation: 'BUY', symbol: 'XAUUSD', entry: 4285.5, stopLoss: 4279.5, takeProfit1: 4298, takeProfit2: 4302.5 },
      w: [[1790341200000, 4299.15, 4299.48, 4280.09, 4280.42], [1790343000000, 4280.87, 4284.12, 4274.78, 4277.57]] },
    { id: 'cmuh92l5h0003j0077h6nzeq2', prod: 'WIN', stopOnly: 'LOSS', truth1m: 'LOSS',
      plan: { recommendation: 'SELL', symbol: 'XAUUSD', entry: 4288.5, stopLoss: 4292.6, takeProfit1: 4284.2, takeProfit2: 4281.2 },
      w: [[1790359200000, 4283.01341, 4290.82252, 4283.003, 4285.54542], [1790361000000, 4286.26215, 4296.27084, 4286.26215, 4294.57788]] },
    { id: 'cmump2m6z0003h3073cpfft3g', prod: 'WIN', stopOnly: 'LOSS', truth1m: 'LOSS',
      plan: { recommendation: 'BUY', symbol: 'XAUUSD', entry: 4150, stopLoss: 4143, takeProfit1: 4160, takeProfit2: 4168 },
      w: [[1790694000000, 4171.49336, 4171.49336, 4149.7414, 4150.21563], [1790695800000, 4151.17771, 4159.56075, 4147.65241, 4158.52228],
        [1790697600000, 4157.94141, 4157.94141, 4150.29765, 4153.91368], [1790699400000, 4153.76045, 4154.91863, 4144.45985, 4144.65905],
        [1790701200000, 4145.12124, 4148.37256, 4144.47809, 4147.17254], [1790703000000, 4147.2573, 4148.86114, 4142.62417, 4143.00197]] },
    { id: 'cmuu81tfs0003gl079w0lgu1v', prod: 'WIN', stopOnly: 'LOSS', truth1m: 'LOSS',
      plan: { recommendation: 'BUY', symbol: 'BTCUSDT', entry: 85200, stopLoss: 85050, takeProfit1: 85600, takeProfit2: 85800 },
      w: [[1791214200000, 85556.7, 85602.2, 85184.5, 85266.4], [1791216000000, 85267.6, 85325.2, 84979.5, 85138.9]] },
    { id: 'cmusqvk0f002jm906g6c4ny72', prod: 'WIN', stopOnly: 'LOSS', truth1m: 'WIN',
      plan: { recommendation: 'BUY', symbol: 'SOLUSDT', entry: 119.45, stopLoss: 119.15, takeProfit1: 119.84, takeProfit2: 120.25 },
      w: [[1791210600000, 120.28, 120.28, 119.2, 119.52], [1791212400000, 119.51, 119.76, 119.34, 119.69],
        [1791214200000, 119.69, 119.74, 119.24, 119.35], [1791216000000, 119.37, 119.54, 118.95, 119.08]] },
  ];

  it.each(REAL)('caso real $id: legacy = o que o sweeper gravou; stop_only = $stopOnly (1m: $truth1m)', ({ plan, w, prod, stopOnly }) => {
    expect(evaluateTrade(plan, w, 'legacy').outcome).toBe(prod);
    expect(evaluateTrade(plan, w, 'stop_only').outcome).toBe(stopOnly);
  });
});

describe('extractShadowPlan', () => {
  const result = (analysis: Record<string, unknown>) => ({ analysis: { symbol: 'BTCUSDT', ...analysis } });

  it('WAIT do modelo, sem niveis: null (nao ha plano para simular)', () => {
    expect(extractShadowPlan(result({ entry: null, stopLoss: null, takeProfit1: null }))).toBeNull();
    expect(extractShadowPlan(null)).toBeNull();
  });

  it('lado pela geometria dos niveis', () => {
    expect(extractShadowPlan(result({ entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 })))
      .toEqual({ recommendation: 'BUY', symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 });
    expect(extractShadowPlan(result({ entry: 100, stopLoss: 105, takeProfit1: 90 }))?.recommendation).toBe('SELL');
  });

  it('geometria incoerente ou sem simbolo: null', () => {
    expect(extractShadowPlan(result({ entry: 100, stopLoss: 95, takeProfit1: 90 }))).toBeNull();
    expect(extractShadowPlan({ analysis: { entry: 100, stopLoss: 95, takeProfit1: 110 } })).toBeNull();
  });

  it('TP2 aquem do TP1 nao entra (mediria um alvo que ja passou)', () => {
    expect(extractShadowPlan(result({ entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 105 }))?.takeProfit2).toBeNull();
  });
});

describe('sweepOnce com WAIT em shadow', () => {
  const created = new Date('2026-10-10T00:00:00Z');
  const t0 = created.getTime();
  // 30 candles de 30m a partir da criacao; OKX devolve do mais novo para o mais velho.
  const okxBody = (path: Array<[number, number]>) => ({
    data: Array.from({ length: 30 }, (_, i) => {
      const [high, low] = path[Math.min(i, path.length - 1)];
      return [String(t0 + i * 1_800_000), String(low), String(high), String(low), String(high)];
    }).reverse(),
  });

  let fetchSpy: jest.SpyInstance;
  // Medidor do Twelve Data num dia util, com contador zerado a cada teste.
  beforeEach(() => __setTwelveDataForTests({ now: () => new Date('2026-10-27T12:00:00Z') }));
  afterEach(() => fetchSpy?.mockRestore());

  function fakePrisma(rows: { trades?: any[]; waits?: any[] }) {
    const update = jest.fn().mockResolvedValue({});
    const findMany = jest.fn(async (args: any) =>
      args.where.recommendation === 'WAIT' ? rows.waits ?? [] : rows.trades ?? []);
    return { prisma: { analysis: { findMany, update } } as any, update, findMany };
  }

  it('so le WAIT com outcome null (o historico ja marcado nao e tocado)', async () => {
    const { prisma, findMany } = fakePrisma({});
    await sweepOnce(prisma);
    const waitQuery = findMany.mock.calls.map((a) => a[0]).find((a) => a.where.recommendation === 'WAIT');
    expect(waitQuery.where).toMatchObject({ status: 'completed', outcome: null, recommendation: 'WAIT' });
  });

  it('WAIT sem niveis: ABSTAIN como antes, sem outcomeDetail e sem buscar candles', async () => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
    const { prisma, update } = fakePrisma({ waits: [{ id: 'w1', createdAt: created, result: { analysis: { symbol: 'XAUUSD', entry: null } } }] });
    await sweepOnce(prisma);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.outcome).toBe('ABSTAIN');
    expect(data).not.toHaveProperty('outcomeDetail');
  });

  it('WAIT com niveis: coluna segue ABSTAIN e o resultado hipotetico vai para shadow', async () => {
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => okxBody([[101, 99], [111, 104], [121, 112]]),
    } as any);
    const { prisma, update } = fakePrisma({ waits: [{
      id: 'w2',
      createdAt: created,
      result: {
        analysis: { symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 },
        engine: { validator_reasons: ['limit_needs_confirmation'] },
      },
    }] });
    await sweepOnce(prisma);
    const data = update.mock.calls[0][0].data;
    expect(data.outcome).toBe('ABSTAIN');
    expect(data.outcomeDetail.shadow).toMatchObject({
      version: 1, side: 'BUY', sideFrom: 'levels', reasons: ['limit_needs_confirmation'], fillCandleRule: 'stop_only',
      outcome: 'WIN', fillIndex: 0, resolvedIndex: 1, tp2Hit: true,
      afterTp1: { tp2: 'hit', tp2Index: 2 },
    });
    expect(data.outcomeDetail).not.toHaveProperty('tp2Hit');
  });

  it('WAIT com niveis e sem candles: ABSTAIN com shadow UNTRACKABLE (nada inventado)', async () => {
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, json: async () => ({}) } as any);
    const { prisma, update } = fakePrisma({ waits: [{
      id: 'w3', createdAt: created,
      result: { analysis: { symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110 } },
    }] });
    await sweepOnce(prisma);
    const data = update.mock.calls[0][0].data;
    expect(data.outcome).toBe('ABSTAIN');
    expect(data.outcomeDetail.shadow).toMatchObject({ outcome: 'UNTRACKABLE', side: 'BUY' });
    expect(data.outcomeDetail.shadow).not.toHaveProperty('fillIndex');
  });

  it('BUY/SELL real: mesmo outcome e campos de sempre, mais afterTp1', async () => {
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => okxBody([[101, 99], [111, 104], [105, 99], [103, 94]]),
    } as any);
    const { prisma, update } = fakePrisma({ trades: [{
      id: 't1', recommendation: 'BUY', createdAt: created, isDemo: false,
      result: { analysis: { symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 } },
    }] });
    await sweepOnce(prisma);
    const data = update.mock.calls[0][0].data;
    expect(data.outcome).toBe('WIN');
    expect(data.outcomeDetail).toMatchObject({
      evaluatedOn: '30m', windowHours: 48, fillCandleRule: 'stop_only', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
      fillIndex: 0, resolvedIndex: 1, tp2Hit: false, isDemo: false,
      afterTp1: { tp2: 'stop', tp2Index: 3, entryRetouchIndex: 2 },
    });
  });

  it('operacoes reais antes dos WAIT, com no maximo 50 WAIT por varredura', async () => {
    const { prisma, findMany } = fakePrisma({});
    await sweepOnce(prisma);
    const order = findMany.mock.calls.map((a) => a[0].where.recommendation);
    expect(order).toEqual([{ in: ['BUY', 'SELL'] }, 'WAIT']);
    expect(findMany.mock.calls[1][0].take).toBe(50);
  });

  it('WAIT de venda em ouro: shadow pela Twelve Data, sem engine = reasons null', async () => {
    const savedKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    const iso = (i: number) => new Date(t0 + i * 1_800_000).toISOString().slice(0, 19).replace('T', ' ');
    const path: Array<[number, number]> = [[4201, 4199], [4206, 4189], [4192, 4170]];
    const values = Array.from({ length: 30 }, (_, i) => {
      const [high, low] = path[Math.min(i, path.length - 1)];
      return { datetime: iso(i), open: String(low), high: String(high), low: String(low), close: String(high) };
    }).reverse();
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ values }) } as any);
    try {
      const { prisma, update } = fakePrisma({ waits: [{
        id: 'w6', createdAt: created,
        result: { analysis: { symbol: 'XAUUSDm', entry: 4200, stopLoss: 4210, takeProfit1: 4190, takeProfit2: 4175 } },
      }] });
      await sweepOnce(prisma);
      expect(String(fetchSpy.mock.calls[0][0])).toContain('api.twelvedata.com');
      const data = update.mock.calls[0][0].data;
      expect(data.outcome).toBe('ABSTAIN');
      expect(data.outcomeDetail.shadow).toMatchObject({
        side: 'SELL', reasons: null, outcome: 'WIN', fillIndex: 0, resolvedIndex: 1, tp2Hit: true,
        afterTp1: { tp2: 'hit', tp2Index: 2 },
      });
    } finally {
      if (savedKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
      else process.env.TWELVE_DATA_API_KEY = savedKey;
    }
  });

  it('cota/fim de semana do Twelve Data: forex fica para depois (nunca UNTRACKABLE) e nao trava quem vem atras', async () => {
    const savedKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    __setTwelveDataForTests({ now: () => new Date('2026-10-31T12:00:00Z') }); // sabado
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as any);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { prisma, update } = fakePrisma({
        trades: [
          { id: 'fx1', createdAt: created, recommendation: 'BUY', isDemo: false, result: { analysis: { symbol: 'XAUUSD', entry: 4200, stopLoss: 4190, takeProfit1: 4220 } } },
          { id: 'c1', createdAt: created, recommendation: 'BUY', isDemo: false, result: { analysis: { symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110 } } },
        ],
        waits: [{ id: 'w7', createdAt: created, result: { analysis: { symbol: 'EURUSD', entry: 1.1, stopLoss: 1.11, takeProfit1: 1.09 } } }],
      });
      await sweepOnce(prisma);
      const touched = update.mock.calls.map((c) => c[0].where.id);
      expect(touched).not.toContain('fx1');
      expect(touched).not.toContain('w7');
      // O cripto atras do forex foi avaliado (sem candles no mock = UNTRACKABLE, como sempre).
      expect(update.mock.calls.find((c) => c[0].where.id === 'c1')?.[0].data.outcome).toBe('UNTRACKABLE');
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('twelvedata'))).toBe(false);
      expect(log).toHaveBeenCalledWith('[Outcome] Forex/metal adiado pela cota do Twelve Data: market_closed=1');
      expect(log).toHaveBeenCalledWith('[Outcome] 1 WAIT de forex/metal adiado(s): cota do Twelve Data.');
    } finally {
      log.mockRestore();
      if (savedKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
      else process.env.TWELVE_DATA_API_KEY = savedKey;
    }
  });

  it('erro ao gravar um WAIT nao derruba a varredura nem marca nada a mais', async () => {
    const { prisma, update } = fakePrisma({ waits: [
      { id: 'w4', createdAt: created, result: null },
      { id: 'w5', createdAt: created, result: null },
    ] });
    update.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(sweepOnce(prisma)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('w4'));
    warn.mockRestore();
  });
});
