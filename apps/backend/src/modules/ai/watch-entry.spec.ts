import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { buildWatchEntry, sanitizeWatchEntry } from './watch-entry';
import { SetWatchEntryDto } from './dto/set-watch-entry.dto';

const NOW = new Date('2026-11-11T15:00:00Z');
const watch = (direction: 'long' | 'short', extra: Record<string, unknown> = {}) => {
  const long = direction === 'long';
  return {
    signalState: 'WATCH',
    watchPlan: {
      direction, zoneLow: long ? 74440 : 74560, zoneHigh: long ? 74500 : 74620, invalidation: long ? 74300 : 74760,
      target1: long ? 74710 : 74350, target2: null, validForCandles: 6, trigger: 'pullback', triggerType: 'zone_reaction',
    },
    watchLevels: long
      ? { entry: 74470, stopLoss: 74310, takeProfit1: 74710, takeProfit2: null, tp1R: 1.5, riskAtr: 1.3 }
      : { entry: 74590, stopLoss: 74750, takeProfit1: 74350, takeProfit2: null, tp1R: 1.5, riskAtr: 1.3 },
    ...extra,
  };
};

describe('entrada registrada num WATCH', () => {
  it('no nivel: stop e alvo do plano gravado, R pelo preco digitado', () => {
    const entry = buildWatchEntry(watch('long'), 'HOLD', { plan: 'level', entry: 74480 }, NOW);
    expect(entry).toEqual({ plan: 'level', direction: 'long', entry: 74480, stopLoss: 74310, takeProfit1: 74710, rr: 1.35, at: NOW.toISOString() });
  });

  it('venda: o preco tem de ficar abaixo do stop e acima do alvo', () => {
    expect(buildWatchEntry(watch('short'), 'HOLD', { plan: 'level', entry: 74600 }, NOW)).toMatchObject({ direction: 'short', stopLoss: 74750, takeProfit1: 74350, rr: 1.67 });
    expect(buildWatchEntry(watch('short'), 'HOLD', { plan: 'level', entry: 74800 }, NOW)).toBe('entry_out_of_plan');
    expect(buildWatchEntry(watch('short'), 'HOLD', { plan: 'level', entry: 74300 }, NOW)).toBe('entry_out_of_plan');
  });

  it('a mercado usa os niveis a mercado; sem eles gravados, recusa', () => {
    const marketLevels = { entry: 74535, stopLoss: 74380, takeProfit1: 74768, takeProfit2: null, tp1R: 1.5, riskAtr: 1.3 };
    expect(buildWatchEntry(watch('long', { marketLevels }), 'HOLD', { plan: 'market', entry: 74535 }, NOW)).toMatchObject({ plan: 'market', stopLoss: 74380, takeProfit1: 74768 });
    expect(buildWatchEntry(watch('long'), 'HOLD', { plan: 'market', entry: 74535 }, NOW)).toBe('watch_plan_unavailable');
  });

  it('WATCH sem geometria valida no nivel (print ou alvos rejeitados): nada a registrar', () => {
    expect(buildWatchEntry(watch('long', { watchLevels: null }), 'HOLD', { plan: 'level', entry: 74470 }, NOW)).toBe('watch_plan_unavailable');
  });

  it('preco fora do intervalo entre stop e alvo, zero ou negativo: recusa', () => {
    for (const entry of [74310, 74300, 74710, 80000, 0, -1, Number.NaN]) {
      expect(buildWatchEntry(watch('long'), 'HOLD', { plan: 'level', entry }, NOW)).toBe('entry_out_of_plan');
    }
  });

  it('fora do WATCH nunca registra', () => {
    expect(buildWatchEntry({ ...watch('long'), signalState: 'NO_TRADE' }, 'HOLD', { plan: 'level', entry: 74470 }, NOW)).toBe('not_a_watch');
    expect(buildWatchEntry({ ...watch('long'), signalState: 'ENTER_NOW' }, 'BUY', { plan: 'level', entry: 74470 }, NOW)).toBe('not_a_watch');
    expect(buildWatchEntry(null, null, { plan: 'level', entry: 74470 }, NOW)).toBe('not_a_watch');
  });

  it('relido do banco com desconfianca: campo torto vira sem entrada', () => {
    const good = { plan: 'level', direction: 'long', entry: 74480, stopLoss: 74310, takeProfit1: 74710, rr: 1.35, at: NOW.toISOString() };
    expect(sanitizeWatchEntry(good)).toEqual(good);
    expect(sanitizeWatchEntry(JSON.stringify(good))).toEqual(good);
    expect(sanitizeWatchEntry({ ...good, plan: 'limit' })).toBeNull();
    expect(sanitizeWatchEntry({ ...good, direction: 'up' })).toBeNull();
    expect(sanitizeWatchEntry({ ...good, entry: '74480' })).toBeNull();
    expect(sanitizeWatchEntry(null)).toBeNull();
    expect(sanitizeWatchEntry('nao e json')).toBeNull();
  });
});

describe('SetWatchEntryDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SetWatchEntryDto });

  it('aceita o plano e o preco; stop e alvo vindos da tela sao recusados', async () => {
    await expect(run({ plan: 'level', entry: 74480 })).resolves.toMatchObject({ plan: 'level', entry: 74480 });
    await expect(run({ plan: 'market', entry: 1.0952 })).resolves.toBeDefined();
    await expect(run({ plan: 'limit', entry: 1 })).rejects.toBeDefined();
    await expect(run({ plan: 'level', entry: 0 })).rejects.toBeDefined();
    await expect(run({ plan: 'level', entry: '74480' })).rejects.toBeDefined();
    await expect(run({ plan: 'level' })).rejects.toBeDefined();
    await expect(run({ plan: 'level', entry: 74480, stopLoss: 1 })).rejects.toBeDefined();
  });
});
