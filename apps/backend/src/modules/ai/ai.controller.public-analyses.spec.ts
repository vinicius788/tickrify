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
