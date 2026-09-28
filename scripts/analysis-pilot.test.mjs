import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPilot, verifyCut } from './analysis-pilot.mjs';

test('seleção é determinística, estratificada por série e modo', () => {
  const samples = ['BTCUSDT', 'ETHUSDT'].flatMap((symbol) =>
    ['30m', '4h'].flatMap((interval) =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `${symbol}_${interval}_${i}`,
        symbol,
        interval,
        cutTimeIso: new Date(i * 86_400_000).toISOString(),
      })),
    ),
  );
  const one = selectPilot(samples, 24);
  assert.deepEqual(one, selectPilot(samples, 24));
  assert.equal(new Set(one.map((x) => x.id)).size, 24);
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    for (const interval of ['30m', '4h']) {
      const group = one.filter((x) => x.symbol === symbol && x.interval === interval);
      assert.equal(group.length, 6);
      assert.equal(group.filter((x) => x.mode === 'quick').length, 3);
      assert.equal(group.filter((x) => x.mode === 'deep').length, 3);
    }
  }
});

test('verificação bloqueia candle futuro e janela curta', () => {
  const candles = Array.from({ length: 6 }, (_, i) => [i * 1000, 1, 2, 0, 1, 1, i * 1000 + 999]);
  const sample = { id: 'x', cutIndex: 3, cutTime: 3000 };
  assert.equal(verifyCut(sample, candles, 2, 2).lastVisibleCloseTimeIso, new Date(2999).toISOString());
  assert.throws(() => verifyCut(sample, candles, 4, 2), /janela insuficiente/);
  candles[2][6] = 3000;
  assert.throws(() => verifyCut(sample, candles, 2, 2), /dado futuro visível/);
});
