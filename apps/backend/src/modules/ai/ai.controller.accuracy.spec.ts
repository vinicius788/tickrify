import { AiController } from './ai.controller';
import type { AiService } from './ai.service';
import type { PrismaService } from '../database/prisma.service';
import {
  AUTOMATIC_OUTCOMES,
  breakdownOf,
  confidenceBand,
  fillCandleRuleOf,
  splitByFillCandleRule,
  tally,
} from './accuracy.util';

// GET /api/ai/accuracy e a regra do candle do fill (decisao de 20/10/2026, opcao c):
// overall e os cortes seguem SO legacy (historico comparavel); stop_only fica em
// `stopOnly`, a parte. Linhas avaliadas antes nao tem `fillCandleRule` = legacy.
const at = new Date('2026-10-12T12:00:00.000Z');
const row = (outcome: string, outcomeDetail: unknown, confidence: number | null = 60) =>
  ({ outcome, confidence, createdAt: at, promptVer: 13, model: 'gpt-5.6-luna', outcomeDetail });
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

function controllerWith(rows: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(12);
  const prisma = { analysis: { findMany, count } } as unknown as PrismaService;
  return { controller: new AiController({} as AiService, prisma), findMany };
}
const LEGACY_FIELDS = ['overall', 'byConfidence', 'byGrounding', 'byPrompt', 'byModel', 'abstention', 'breakdown', 'groundingLiveSince'] as const;
const pick = (payload: any) => Object.fromEntries(LEGACY_FIELDS.map((k) => [k, payload[k]]));

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

describe('GET /api/ai/accuracy (opcao c)', () => {
  it('so com historico: todo campo antigo igual ao calculo de antes, e a serie nova vazia', async () => {
    const { controller, findMany } = controllerWith(LEGACY);
    const payload: any = await controller.getAccuracy();
    // Calculo de antes da regra (todas as linhas juntas), refeito aqui.
    expect(payload.overall).toEqual(tally(LEGACY));
    expect(payload.breakdown).toEqual(breakdownOf(LEGACY));
    expect(payload.byConfidence).toEqual(['below60', 'band60to69', 'band70plus', 'unknown']
      .map((band) => ({ band, ...tally(LEGACY.filter((r) => confidenceBand(r.confidence) === band)) })));
    expect(payload.stopOnly).toEqual({ overall: tally([]), breakdown: {} });
    expect(payload.methodology).toEqual({ overall: 'legacy', stopOnly: 'stop_only', newEvaluations: 'stop_only' });
    // Filtro da consulta igual; so o outcomeDetail entrou no select.
    expect(findMany.mock.calls[0][0].where).toEqual({ outcome: { in: [...AUTOMATIC_OUTCOMES] }, isDemo: false, strategyHash: null });
    expect(findMany.mock.calls[0][0].select).toMatchObject({ outcome: true, outcomeDetail: true });
  });

  it('linhas stop_only nao mudam nenhum campo antigo e so aparecem em stopOnly', async () => {
    const before: any = await controllerWith(LEGACY).controller.getAccuracy();
    const after: any = await controllerWith([...LEGACY, ...STOP_ONLY]).controller.getAccuracy();
    expect(pick(after)).toEqual(pick(before));
    expect(after.overall).toMatchObject({ wins: 2, losses: 2, n: 4 });
    expect(after.stopOnly.overall).toMatchObject({ wins: 1, losses: 2, n: 3 });
    expect(after.stopOnly.breakdown).toEqual({ WIN: 1, LOSS: 2, TIMEOUT: 1 });
    expect(after.breakdown).toEqual({ WIN: 2, LOSS: 2, NO_FILL: 1, ABSTAIN: 1 });
  });

  it('a serie nova nao incorpora linha legacy, nem com valor desconhecido no campo', async () => {
    const { controller } = controllerWith([row('WIN', { fillCandleRule: 'stop-only' }), row('WIN', {})]);
    const payload: any = await controller.getAccuracy();
    expect(payload.stopOnly.overall.n).toBe(0);
    expect(payload.overall.n).toBe(2);
  });
});
