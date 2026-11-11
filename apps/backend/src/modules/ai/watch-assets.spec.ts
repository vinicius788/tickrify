import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import { WATCH_ASSET_RULES, canonicalWatchSymbol, dayLevels } from './watch-assets';
import { WatchAssetsService } from './watch-assets.service';
import { SaveWatchAssetsDto } from './dto/watch-assets.dto';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));

const STEP = 15 * 60_000;
const T0 = Date.UTC(2026, 10, 10, 0, 0);
/** Onda regular entre 95 e 105 com tendencia de alta leve: swings claros dos dois lados. */
function wave(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const mid = 100 + i * 0.02 + 4 * Math.sin(i / 3);
    return [T0 + i * STEP, mid - 0.2, mid + 0.6, mid - 0.6, mid + 0.2, 10];
  });
}
const NOW = T0 + 100 * STEP + 60_000;

describe('niveis do dia (so codigo)', () => {
  it('devolve preco, ATR, um nivel acima e um abaixo, com distancia em ATR e em %', () => {
    const candles = wave(101);
    const levels = dayLevels(candles, '15m', NOW)!;
    expect(levels.price).toBe(candles[100][4]);
    expect(levels.atr).toBeGreaterThan(0);
    expect(levels.above!.price).toBeGreaterThan(levels.price);
    expect(levels.below!.price).toBeLessThan(levels.price);
    expect(levels.above!.pct).toBeCloseTo((100 * (levels.above!.price - levels.price)) / levels.price, 6);
    expect(levels.below!.atr).toBeCloseTo((levels.price - levels.below!.price) / levels.atr, 6);
    expect(levels.candleAt).toBe(candles[100][0]);
  });

  it('a vela em formacao da o preco mas nao entra nas swings nem no ATR', () => {
    const candles = wave(101);
    const spike = [...candles.slice(0, 100), [candles[100][0], 100, 500, 100, 101, 1]];
    const a = dayLevels(candles, '15m', NOW)!;
    const b = dayLevels(spike, '15m', NOW)!;
    expect(b.atr).toBe(a.atr);
    expect(b.price).toBe(101);
  });

  it('nivel colado no preco e pulado: nenhum lado fica a menos de 0,25 ATR', () => {
    for (let n = 60; n <= 101; n++) {
      const candles = wave(n);
      const levels = dayLevels(candles, '15m', T0 + (n - 1) * STEP + 60_000);
      if (!levels) continue;
      for (const side of [levels.above, levels.below]) {
        if (side) expect(side.atr).toBeGreaterThanOrEqual(WATCH_ASSET_RULES.minDistanceAtr);
      }
    }
  });

  it('preco logo abaixo de um topo: o nivel acima e o topo seguinte, nao o que esta a centavos', () => {
    const candles = wave(101);
    const base = dayLevels(candles, '15m', NOW)!;
    // Vela em formacao fecha a 0,05 ATR abaixo do nivel de cima.
    const near = base.above!.price - 0.05 * base.atr;
    const moved = [...candles.slice(0, 100), [candles[100][0], near, near, near, near, 1]];
    const levels = dayLevels(moved, '15m', NOW)!;
    expect(levels.price).toBe(near);
    if (levels.above) {
      expect(levels.above.price).toBeGreaterThan(base.above!.price);
      expect(levels.above.atr).toBeGreaterThanOrEqual(WATCH_ASSET_RULES.minDistanceAtr);
    }
  });

  it('poucas velas ou tempo grafico desconhecido: null', () => {
    expect(dayLevels(wave(20), '15m', T0 + 20 * STEP)).toBeNull();
    expect(dayLevels(wave(101), '7m', NOW)).toBeNull();
    expect(dayLevels([], '15m', NOW)).toBeNull();
  });

  it('o ativo vira o par do armazem; sem fonte de preco, null', () => {
    expect(canonicalWatchSymbol('btcusd')).toBe('BTCUSDT');
    expect(canonicalWatchSymbol('XAUUSDm')).toBe('XAUUSD');
    expect(canonicalWatchSymbol('EUR/USD')).toBe('EURUSD');
    expect(canonicalWatchSymbol('NAS100')).toBeNull();
    expect(canonicalWatchSymbol('PETR4')).toBeNull();
    expect(canonicalWatchSymbol('')).toBeNull();
  });
});

function makeService(stored: Array<{ symbol: string; timeframe: string }> = []) {
  const { prisma, calls } = makePrisma([['FROM "tickrify"."UserWatchAsset"', () => stored]]);
  const service = new WatchAssetsService(prisma);
  const candles = jest.fn(async () => ({ candles: wave(101) as any, source: 'test', denied: null }));
  service.candles = candles as any;
  return { service, calls, candles };
}
const user = { id: 'u1', clerkUserId: 'clerk_1' };
const inserts = (calls: Array<{ kind: string; text: string; values: unknown[] }>) =>
  calls.filter((c) => c.kind === 'execute' && c.text.includes('INSERT INTO "tickrify"."UserWatchAsset"'));

describe('WatchAssetsService', () => {
  it('grava a lista normalizada, sem repetir, na ordem escolhida', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    await t.service.save(user, { symbols: ['XAUUSDm', 'btcusd', 'XAUUSD'], timeframe: '5m' }, true);
    expect(inserts(t.calls).map((c) => c.values.slice(1))).toEqual([['XAUUSD', '5m', 0], ['BTCUSDT', '5m', 1]]);
  });

  it('ativo sem fonte de preco recusa tudo e nada e gravado', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    await expect(t.service.save(user, { symbols: ['BTCUSDT', 'NAS100'], timeframe: '5m' }, true)).rejects.toMatchObject({ response: { code: 'asset_not_supported', symbol: 'NAS100' } });
    expect(t.calls.filter((c) => c.kind === 'execute')).toHaveLength(0);
  });

  it('teto do plano vale no servidor: gratis 2, assinante 5', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    const three = { symbols: ['BTCUSDT', 'ETHUSDT', 'XAUUSD'], timeframe: '15m' };
    await expect(t.service.save(user, three, false)).rejects.toMatchObject({ response: { code: 'asset_limit', maxAssets: 2 } });
    expect(inserts(t.calls)).toHaveLength(0);
    await t.service.save(user, three, true);
    expect(inserts(t.calls)).toHaveLength(3);
  });

  it('os niveis saem pela reserva do monitor com as velas guardadas ate 15 min', async () => {
    const t = makeService([{ symbol: 'XAUUSD', timeframe: '15m' }]);
    await t.service.onModuleInit();
    const view = await t.service.view('u1', true, NOW);
    expect(t.candles).toHaveBeenCalledWith('XAUUSD', '15m', 'monitor', NOW, { maxAgeMs: WATCH_ASSET_RULES.maxAgeMs });
    expect(view.assets[0]).toMatchObject({ symbol: 'XAUUSD', status: 'ok' });
    expect(view.assets[0].levels!.above).not.toBeNull();
    expect(view.maxAssets).toBe(5);
  });

  it('fonte recusou e ha velas guardadas: niveis com status stale; sem velas: unavailable', async () => {
    const t = makeService([{ symbol: 'XAUUSD', timeframe: '15m' }, { symbol: 'EURUSD', timeframe: '15m' }]);
    await t.service.onModuleInit();
    t.candles
      .mockResolvedValueOnce({ candles: wave(101), source: 'twelvedata', denied: 'weekend', stale: true } as any)
      .mockResolvedValueOnce({ candles: null, source: null, denied: 'weekend' } as any);
    const view = await t.service.view('u1', true, NOW);
    expect(view.assets.map((a) => a.status)).toEqual(['stale', 'unavailable']);
    expect(view.assets[1].levels).toBeNull();
  });

  it('quem deixou de assinar ve so os ativos dentro do teto gratis', async () => {
    const t = makeService([{ symbol: 'A', timeframe: '5m' }, { symbol: 'B', timeframe: '5m' }, { symbol: 'C', timeframe: '5m' }]);
    await t.service.onModuleInit();
    expect((await t.service.view('u1', false, NOW)).assets).toHaveLength(2);
  });
});

describe('SaveWatchAssetsDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SaveWatchAssetsDto });

  it('aceita a lista e o tempo grafico', async () => {
    await expect(run({ symbols: ['XAUUSD', 'BTC/USDT'], timeframe: '5m' })).resolves.toMatchObject({ timeframe: '5m' });
    await expect(run({ symbols: [], timeframe: '15m' })).resolves.toBeDefined();
  });

  it('recusa tempo grafico fora da lista, mais de 5 ativos, texto estranho e campo a mais', async () => {
    await expect(run({ symbols: ['XAUUSD'], timeframe: '2m' })).rejects.toBeDefined();
    await expect(run({ symbols: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], timeframe: '5m' })).rejects.toBeDefined();
    await expect(run({ symbols: ['<script>'], timeframe: '5m' })).rejects.toBeDefined();
    await expect(run({ symbols: ['XAUUSD'], timeframe: '5m', userId: 'x' })).rejects.toBeDefined();
  });
});
