import { AiController } from './ai.controller';
import type { AiService } from './ai.service';
import type { PrismaService } from '../database/prisma.service';
import {
  AUTOMATIC_OUTCOMES,
  CURRENT_ENGINE_SQL,
  breakEvenRate,
  breakdownOf,
  confidenceBand,
  currentEngineReport,
  edgeVerdict,
  engineMajor,
  fillCandleRuleOf,
  isCurrentEngine,
  splitByFillCandleRule,
  tally,
  trackedTradeR,
  wilson,
  type CurrentEngineRow,
} from './accuracy.util';

// GET /api/ai/accuracy. Regra do candle do fill (20/10/2026, opcao c): overall e os
// cortes seguem SO legacy; stop_only fica em `stopOnly`. Desde 04/11/2026 tudo isso
// mora em `previous` (motor anterior) e o motor atual (major >= 4) vem do rastreador
// em `current`; as duas series nunca se somam.
const at = new Date('2026-10-12T12:00:00.000Z');
const row = (outcome: string, outcomeDetail: unknown, confidence: number | null = 60, rewardTp1: number | null = 1.5) =>
  ({ outcome, confidence, createdAt: at, promptVer: 13, model: 'gpt-5.6-luna', outcomeDetail, rewardTp1 });
const LEGACY = [
  row('WIN', null), // muito antigo: sem outcomeDetail
  row('WIN', { evaluatedOn: '30m', windowHours: 48 }, 72), // antes de 20/10: sem o campo
  row('LOSS', { evaluatedOn: '30m', windowHours: 48, afterTp1: null }),
  row('LOSS', { fillCandleRule: 'algo_novo' }, null), // valor desconhecido = legacy
  row('NO_FILL', { evaluatedOn: '30m' }),
  row('ABSTAIN', null),
];
const STOP_ONLY = [
  row('WIN', { evaluatedOn: '30m', fillCandleRule: 'stop_only' }, 72),
  row('LOSS', { evaluatedOn: '30m', fillCandleRule: 'stop_only' }),
  row('LOSS', { evaluatedOn: '30m', fillCandleRule: 'stop_only' }),
  row('TIMEOUT', { evaluatedOn: '30m', fillCandleRule: 'stop_only' }),
];

type Sql = { sql: string; values: unknown[] };
function controllerWith(rows: unknown[], current: unknown[] | Error = []) {
  const queryRaw = jest.fn(async (q: Sql) => {
    if (q.sql.includes('AnalysisTrack')) {
      if (current instanceof Error) throw current;
      return current;
    }
    if (q.sql.includes('count(*)')) return [{ wait: 3, total: 12 }];
    return rows;
  });
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { controller: new AiController({} as AiService, prisma), queryRaw };
}
const sqlOf = (queryRaw: jest.Mock, needle: string) =>
  (queryRaw.mock.calls.map((c) => c[0] as Sql).find((q) => q.sql.includes(needle)) as Sql).sql;
const LEGACY_FIELDS = ['overall', 'byConfidence', 'byGrounding', 'byModel', 'abstention', 'breakdown', 'groundingLiveSince'] as const;
const pick = (previous: any) => Object.fromEntries(LEGACY_FIELDS.map((k) => [k, previous[k]]));

describe('fillCandleRuleOf e splitByFillCandleRule', () => {
  it('sem o campo, nulo ou desconhecido = legacy; so stop_only explicito = stop_only', () => {
    expect(fillCandleRuleOf(undefined)).toBe('legacy');
    expect(fillCandleRuleOf(null)).toBe('legacy');
    expect(fillCandleRuleOf({})).toBe('legacy');
    expect(fillCandleRuleOf({ fillCandleRule: 'legacy' })).toBe('legacy');
    expect(fillCandleRuleOf({ fillCandleRule: 'STOP_ONLY' })).toBe('legacy');
    expect(fillCandleRuleOf({ fillCandleRule: 'stop_only' })).toBe('stop_only');
    expect(fillCandleRuleOf('stop_only')).toBe('legacy');
  });

  it('cada linha cai em exatamente uma serie', () => {
    const split = splitByFillCandleRule([...LEGACY, ...STOP_ONLY]);
    expect(split.legacy).toEqual(LEGACY);
    expect(split.stop_only).toEqual(STOP_ONLY);
  });
});

describe('separacao por versao do motor', () => {
  it('major >= 4 e o motor atual; sem versao, texto ou major menor e o anterior', () => {
    expect(engineMajor('4.0.0')).toBe(4);
    expect(engineMajor(' 10.2.1')).toBe(10);
    expect(engineMajor('2.0.0')).toBe(2);
    expect(engineMajor(undefined)).toBeNull();
    expect(engineMajor('v4')).toBeNull();
    expect(isCurrentEngine('4.0.0')).toBe(true);
    expect(isCurrentEngine('4.1.0')).toBe(true);
    expect(isCurrentEngine('3.9.9')).toBe(false);
    expect(isCurrentEngine(null)).toBe(false);
  });

  it('o predicado SQL compara o major da versao gravada com 4', () => {
    expect(CURRENT_ENGINE_SQL).toBe(`COALESCE(substring(a."result"->'engine'->>'version' from '^\\s*([0-9]+)')::int, 0) >= 4`);
  });

  it('previous e a abstencao excluem o motor atual; current so le o motor atual', async () => {
    const { controller, queryRaw } = controllerWith(LEGACY);
    await controller.getAccuracy();
    expect(sqlOf(queryRaw, '"outcomeDetail"')).toContain(`NOT (${CURRENT_ENGINE_SQL})`);
    expect(sqlOf(queryRaw, 'count(*)')).toContain(`NOT (${CURRENT_ENGINE_SQL})`);
    const current = sqlOf(queryRaw, 'AnalysisTrack');
    expect(current).toContain(`AND (${CURRENT_ENGINE_SQL})`);
    expect(current).not.toContain('NOT (');
  });

  it('motor anterior: regra publica intacta (isDemo = false e strategyHash nulo)', async () => {
    const { controller, queryRaw } = controllerWith(LEGACY);
    await controller.getAccuracy();
    for (const needle of ['"outcomeDetail"', 'count(*)']) {
      const sql = sqlOf(queryRaw, needle);
      expect(sql).toContain('a."isDemo" = false');
      expect(sql).toContain('a."strategyHash" IS NULL');
    }
    const prev = queryRaw.mock.calls.map((c) => c[0] as Sql).find((q) => q.sql.includes('"outcomeDetail"')) as Sql;
    expect(prev.values).toEqual([...AUTOMATIC_OUTCOMES]);
  });

  it('motor atual: gratis, trial e pago contam; fora conta do dono e perfil de estrategia', async () => {
    const { controller, queryRaw } = controllerWith(LEGACY);
    const payload: any = await controller.getAccuracy();
    const sql = sqlOf(queryRaw, 'AnalysisTrack');
    expect(sql).not.toContain('isDemo');
    expect(sql).toContain('a."strategyHash" IS NULL');
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM "tickrify"."User" u WHERE u."id" = a."userId" AND u."role" = 'admin')`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM "tickrify"."Subscription" s WHERE s."userId" = a."userId" AND s."stripeId" LIKE 'manual_%')`);
    expect(payload.filters).toEqual({
      previous: { isDemo: false, strategyHash: null },
      current: { freeTrialAndPaid: true, strategyHash: null, excludesOwnerAccount: true },
      minResolvedToPublish: 20,
    });
    expect(payload.currentEngine).toEqual({ major: 4, since: '2026-11-03T01:24:00.000Z' });
  });
});

describe('GET /api/ai/accuracy: previous (motor anterior, regra do fill)', () => {
  it('so com historico: todo campo antigo igual ao calculo de antes, e a serie nova vazia', async () => {
    const { controller } = controllerWith(LEGACY);
    const { previous }: any = await controller.getAccuracy();
    expect(previous.overall).toEqual(tally(LEGACY));
    expect(previous.breakdown).toEqual(breakdownOf(LEGACY));
    expect(previous.byConfidence).toEqual(['below60', 'band60to69', 'band70plus', 'unknown']
      .map((band) => ({ band, ...tally(LEGACY.filter((r) => confidenceBand(r.confidence) === band)) })));
    expect(previous.byModel).toEqual([{ model: 'gpt-5.6-luna', ...tally(LEGACY) }]);
    expect(previous.abstention).toEqual({ wait: 3, total: 12, rate: 25 });
    expect(previous.stopOnly).toEqual({ overall: tally([]), breakdown: {} });
    expect(previous.methodology).toEqual({ overall: 'legacy', stopOnly: 'stop_only', newEvaluations: 'stop_only' });
  });

  it('linhas stop_only nao mudam nenhum campo antigo e so aparecem em stopOnly', async () => {
    const before: any = await controllerWith(LEGACY).controller.getAccuracy();
    const after: any = await controllerWith([...LEGACY, ...STOP_ONLY]).controller.getAccuracy();
    expect(pick(after.previous)).toEqual(pick(before.previous));
    expect(after.previous.overall).toMatchObject({ wins: 2, losses: 2, n: 4 });
    expect(after.previous.stopOnly.overall).toMatchObject({ wins: 1, losses: 2, n: 3 });
    expect(after.previous.stopOnly.breakdown).toEqual({ WIN: 1, LOSS: 2, TIMEOUT: 1 });
  });

  it('a serie nova nao incorpora linha legacy, nem com valor desconhecido no campo', async () => {
    const { controller } = controllerWith([row('WIN', { fillCandleRule: 'stop-only' }), row('WIN', {})]);
    const { previous }: any = await controller.getAccuracy();
    expect(previous.stopOnly.overall.n).toBe(0);
    expect(previous.overall.n).toBe(2);
  });

  it('avgRewardTp1 so com WIN/LOSS legacy e breakEvenRate = 1/(1+R)', async () => {
    const rows = [
      row('WIN', null, 60, 2), row('LOSS', null, 60, 1), row('LOSS', null, 60, null),
      row('NO_FILL', null, 60, 9), row('WIN', { fillCandleRule: 'stop_only' }, 60, 9),
    ];
    const { previous }: any = await controllerWith(rows).controller.getAccuracy();
    expect(previous.avgRewardTp1).toBe(1.5);
    expect(previous.breakEvenRate).toBe(40);
    expect(previous.edge).toBeNull(); // n = 3: sem taxa publicada, sem veredito
  });
});

describe('break-even e a frase escolhida pelo dado', () => {
  it('breakEvenRate: 1/(1+R) em %, null sem R positivo', () => {
    expect(breakEvenRate(1)).toBe(50);
    expect(breakEvenRate(1.5)).toBe(40);
    expect(breakEvenRate(0.5)).toBe(66.7);
    expect(breakEvenRate(null)).toBeNull();
    expect(breakEvenRate(0)).toBeNull();
  });

  it('abaixo, acima ou dentro do intervalo de Wilson', () => {
    const iv = (low: number, high: number) => ({ publishable: true, low, high });
    expect(edgeVerdict(iv(20, 35), 40)).toBe('below');
    expect(edgeVerdict(iv(45, 60), 40)).toBe('above');
    expect(edgeVerdict(iv(30, 50), 40)).toBe('inconclusive');
    expect(edgeVerdict({ publishable: false, low: 10, high: 20 }, 40)).toBeNull();
    expect(edgeVerdict(iv(20, 35), null)).toBeNull();
  });

  it('o veredito do previous segue o dado: 10 WIN x 30 LOSS com R 1 fica abaixo de 50%', async () => {
    const rows = [...Array(10).fill(row('WIN', null, 60, 1)), ...Array(30).fill(row('LOSS', null, 60, 1))];
    const { previous }: any = await controllerWith(rows).controller.getAccuracy();
    expect(previous.breakEvenRate).toBe(50);
    expect(previous.overall.high).toBeLessThan(50);
    expect(previous.edge).toBe('below');
  });
});

const track = (outcome: string, extra: Partial<NonNullable<CurrentEngineRow['track']>> = {}) => ({
  status: 'tracked', outcome, touched: false, symbol: 'BTCUSDT', fillPrice: 100, stopLoss: 99, takeProfit1: 101.5, ...extra,
});
const cur = (signalState: string, t: CurrentEngineRow['track'], extra: Partial<CurrentEngineRow> = {}): CurrentEngineRow => ({
  createdAt: new Date('2026-11-04T10:00:00Z'), signalState, dataMode: 'real_data', symbol: 'BTCUSDT', reachProbability: null, track: t, ...extra,
});

describe('current (motor atual, rastreador)', () => {
  it('menos de 20 resolvidos: so o n, sem taxa, sem R e sem veredito', () => {
    const rows = [...Array(12).fill(cur('ENTER_NOW', track('WIN'))), ...Array(7).fill(cur('ENTER_NOW', track('LOSS')))];
    const r = currentEngineReport(rows);
    expect(r.enterNow.resolved).toBe(19);
    expect(r.enterNow.hitRate).toEqual({ n: 19, publishable: false });
    expect(r.enterNow.avgNetR).toBeNull();
    expect(r.enterNow.breakEvenRate).toBeNull();
    expect(r.enterNow.edge).toBeNull();
  });

  it('20 ou mais: Wilson, R liquido pela regra da revisao mensal e break-even', () => {
    const rows = [
      ...Array(8).fill(cur('ENTER_NOW', track('WIN'))),
      ...Array(12).fill(cur('ENTER_NOW', track('LOSS'))),
      cur('ENTER_NOW', track('TIMEOUT')),
      cur('ENTER_NOW', null),
      cur('ENTER_NOW', track('NO_CANDLES', { fillPrice: null })),
    ];
    const r = currentEngineReport(rows);
    expect(r.enterNow).toMatchObject({ emitted: 23, open: 1, notScored: 1, resolved: 21, outcomes: { tp1: 8, stop: 12, timeout: 1 } });
    expect(r.enterNow.hitRate).toEqual(wilson(8, 12));
    const expected = rows.flatMap((x) => (x.track ? [trackedTradeR(x.track)] : [])).filter(Boolean) as Array<{ r: number }>;
    expect(r.enterNow.avgNetR).toBe(Math.round((expected.reduce((a, t) => a + t.r, 0) / 21) * 100) / 100);
    expect(r.enterNow.avgRewardTp1).toBe(1.5);
    expect(r.enterNow.breakEvenRate).toBe(40);
    expect(r.enterNow.edge).toBe(edgeVerdict(wilson(8, 12), 40));
  });

  it('WATCH fechado por desfecho (watchOutcomeOf), aberto a parte, taxa de chegada so com n >= 20', () => {
    const rows = [
      cur('WATCH', track('TIMEOUT', { touched: true })),
      cur('WATCH', track('NO_FILL')),
      cur('WATCH', track('INVALIDATED')),
      cur('WATCH', { ...track('NO_CANDLES'), status: 'tracked' }),
      cur('WATCH', null),
      cur('NO_TRADE', { ...track(''), status: 'skipped' }),
    ];
    const r = currentEngineReport(rows);
    expect(r.byState).toEqual({ WATCH: 5, NO_TRADE: 1 });
    expect(r.watch).toMatchObject({ emitted: 5, open: 1, closed: 4, outcomes: { reached: 1, expired: 1, invalidated: 1, unavailable: 1 } });
    expect(r.watch.reachRate).toEqual({ n: 3, publishable: false });
    expect(r.watch.calibrationAvailable).toBe(false);
  });

  it('calibracao por faixa: prevista x observada, faixa com n < 20 so com o n', () => {
    const rows = [
      ...Array(15).fill(cur('WATCH', track('X', { touched: true }), { reachProbability: 0.6 })),
      ...Array(5).fill(cur('WATCH', track('X', { touched: false }), { reachProbability: 0.7 })),
      ...Array(3).fill(cur('WATCH', track('X', { touched: true }), { reachProbability: 0.1 })),
    ];
    const r = currentEngineReport(rows);
    expect(r.watch.calibrationAvailable).toBe(true);
    const mid = r.watch.calibration.find((b) => b.band === '50-75') as any;
    expect(mid).toMatchObject({ n: 20, publishable: true, predicted: 62.5 });
    expect(mid.observed).toEqual(wilson(15, 5));
    expect(r.watch.calibration.find((b) => b.band === '0-25')).toEqual({ band: '0-25', n: 3, publishable: false });
  });

  it('cobertura de dados e a contagem do bloco EUR/USD invertido (ouro/forex ate 17:28:26 UTC)', () => {
    const early = new Date('2026-11-03T10:00:00Z');
    const rows = [
      cur('WATCH', track('NO_FILL'), { symbol: 'XAUUSD', createdAt: early }),
      cur('ENTER_NOW', null, { symbol: 'EURUSDm', createdAt: early, dataMode: 'print' }),
      cur('NO_TRADE', null, { symbol: 'BTCUSDT', createdAt: early }),
      cur('NO_TRADE', null, { symbol: 'XAUUSD', createdAt: new Date('2026-11-03T17:28:26Z') }),
      cur('NO_TRADE', null, { dataMode: null }),
    ];
    const r = currentEngineReport(rows);
    expect(r.dataMode).toEqual({ real_data: 3, print: 1, unknown: 1 });
    expect(r.eurUsdBlock).toEqual({ until: '2026-11-03T17:28:26.000Z', analyses: 2, closedWatch: 1, enterNow: 1 });
  });

  it('rastreador indisponivel: current null, previous intacto', async () => {
    const { controller } = controllerWith(LEGACY, new Error('relation "AnalysisTrack" does not exist'));
    const payload: any = await controller.getAccuracy();
    expect(payload.current).toBeNull();
    expect(payload.previous.overall).toEqual(tally(LEGACY));
  });

  it('o controller monta as linhas do rastreador e entrega o relatorio', async () => {
    const raw = [{
      createdAt: new Date('2026-11-04T10:00:00Z'), signalState: 'ENTER_NOW', dataMode: 'real_data', symbol: 'BTCUSDT', reachProbability: null,
      trackStatus: 'tracked', trackOutcome: 'WIN', touched: true, fillPrice: 100, stopLoss: 99, takeProfit1: 101.5, trackSymbol: 'BTCUSDT',
    }];
    const { current }: any = await controllerWith(LEGACY, raw).controller.getAccuracy();
    expect(current).toMatchObject({ analyses: 1, enterNow: { resolved: 1, outcomes: { tp1: 1, stop: 0, timeout: 0 } } });
  });
});
