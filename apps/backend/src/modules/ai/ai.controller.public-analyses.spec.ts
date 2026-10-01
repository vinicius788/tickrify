import { AiController } from './ai.controller';
import type { AiService } from './ai.service';
import type { PrismaService } from '../database/prisma.service';

describe('GET /api/ai/public-analyses', () => {
  it('expõe o viés salvo sem modificar a recomendação e mantém compatibilidade com análises antigas', async () => {
    const createdAt = new Date('2026-09-22T12:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'directional-wait',
        recommendation: 'WAIT',
        confidence: 54,
        createdAt,
        result: {
          bias: 'bullish',
          analysis: { symbol: 'BTCUSDT', timeframe: '1H', marketStructure: { bias: 'bearish' } },
        },
      },
      {
        id: 'nested-bias',
        recommendation: 'BUY',
        confidence: 65,
        createdAt,
        result: { analysis: { symbol: 'ETHUSDT', timeframe: '4H', marketStructure: { bias: 'bearish' } } },
      },
      {
        id: 'legacy',
        recommendation: 'SELL',
        confidence: 61,
        createdAt,
        result: { analysis: { symbol: 'XAUUSD', timeframe: '1H' } },
      },
    ]);
    const prisma = { analysis: { findMany } } as unknown as PrismaService;
    const controller = new AiController({} as AiService, prisma);

    const analyses = await controller.getPublicAnalyses();

    expect(analyses.map(({ id, recommendation, bias }) => ({ id, recommendation, bias }))).toEqual([
      { id: 'directional-wait', recommendation: 'WAIT', bias: 'bullish' },
      { id: 'nested-bias', recommendation: 'BUY', bias: 'bearish' },
      { id: 'legacy', recommendation: 'SELL', bias: null },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'completed', recommendation: { not: null }, isDemo: false, strategyHash: null },
      take: 6,
    }));
  });
});

describe('GET /api/ai/public-analyses/scored', () => {
  it('mostra só o outcome automático, com os níveis que o sweeper usou, sem usuário nem imagem', async () => {
    const createdAt = new Date('2026-09-20T12:00:00.000Z');
    const outcomeAt = new Date('2026-09-22T13:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'win',
        recommendation: 'BUY',
        createdAt,
        outcome: 'WIN',
        outcomeAt,
        outcomeDetail: { symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110 },
        result: { analysis: { symbol: 'BTCUSDT', timeframe: '1H', entry: 999 } },
      },
      {
        id: 'nofill',
        recommendation: 'SELL',
        createdAt,
        outcome: 'NO_FILL',
        outcomeAt,
        outcomeDetail: null,
        result: { analysis: { symbol: 'XAUUSD', timeframe: '15M' } },
      },
    ]);
    const prisma = { analysis: { findMany } } as unknown as PrismaService;
    const controller = new AiController({} as AiService, prisma);

    const rows = await controller.getScoredPublicAnalyses();

    expect(rows[0]).toEqual({
      id: 'win', recommendation: 'BUY', createdAt, outcome: 'WIN', outcomeAt,
      symbol: 'BTCUSDT', timeframe: '1H', entry: 100, stopLoss: 95, takeProfit1: 110,
    });
    expect(rows[1]).toMatchObject({ outcome: 'NO_FILL', entry: null, stopLoss: null, takeProfit1: null });
    for (const row of rows) {
      expect(row).not.toHaveProperty('userId');
      expect(row).not.toHaveProperty('imageUrl');
      expect(row).not.toHaveProperty('userVerdict');
    }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { outcome: { in: ['WIN', 'LOSS', 'NO_FILL', 'TIMEOUT'] }, isDemo: false, strategyHash: null },
      take: 6,
    }));
  });
});
