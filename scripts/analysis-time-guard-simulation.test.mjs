import assert from 'node:assert/strict';
import test from 'node:test';
import { pricePassesThreeAtrGuard, simulate } from './analysis-time-guard-simulation.mjs';

const candles = Array.from({ length: 30 }, (_, i) => [
  Date.parse('2026-09-22T00:00:00Z') + i * 1_800_000, 100, 102, 98, 100, 1,
]);

test('a historical chart can pass a current-feed price comparison', () => {
  assert.equal(pricePassesThreeAtrGuard(candles, 100), true);
  assert.equal(pricePassesThreeAtrGuard(candles, 120), false);
  assert.equal(pricePassesThreeAtrGuard(candles, null), false);
});

test('requires matching source hash and an actually older visible candle', () => {
  const old = [Date.parse('2026-08-01T00:00:00Z'), 100, 102, 98, 100, 1];
  const rows = [old, ...candles];
  const item = {
    symbol: 'BTCUSDT', interval: '30m', dataSha256: 'frozen',
    cutTimeIso: new Date(candles[0][0]).toISOString(),
    lastVisibleOpenTimeIso: new Date(old[0]).toISOString(),
  };
  const read = () => ({ sha256: 'frozen', candles: rows });
  const result = simulate({ cases: [item] }, read);
  assert.equal(result.oldPrints, 1);
  assert.equal(result.oldPrintsPassingPriceGuard, 1);
  assert.equal(result.passingAgesDays.length, 1);
  assert.throws(() => simulate({ cases: [{ ...item, dataSha256: 'changed' }] }, read), /Hash/);
});
