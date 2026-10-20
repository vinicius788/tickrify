/**
 * Sweeper (20/10/2026): o que acontece depois do TP1 e o resultado hipotetico
 * (shadow) do WAIT que guardou os niveis. Tudo so mede: a coluna `outcome`
 * segue igual (WAIT continua ABSTAIN) e `tp2Hit` mantem o significado antigo.
 */
import {
  evaluateTrade,
  extractShadowPlan,
  sweepOnce,
  type Candle,
  type TradePlan,
} from '../../worker/outcome.sweeper';

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
    const r = evaluateTrade(buy, [c(111, 99)]);
    expect(r).toMatchObject({ outcome: 'WIN', fillIndex: 0, resolvedIndex: 0 });
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
      version: 1, side: 'BUY', sideFrom: 'levels', reasons: ['limit_needs_confirmation'],
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
      evaluatedOn: '30m', windowHours: 48, entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
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
