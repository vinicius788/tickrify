import { buildLevelMap } from './level-map';
import type { PriceLocation } from './signal-decision';

const location = (over: Partial<PriceLocation> = {}): PriceLocation => ({
  price: 100, atr: 2, rangePosPct: 50, htfTrend: null, invalidation: null, planLevel: null,
  resistance: { price: 104, atr: 2 }, support: { price: 97, atr: 1.5 },
  ...over,
});

describe('buildLevelMap (NO_TRADE, os dois lados do preco)', () => {
  it('usa a proxima swing fractal de cada lado, com a distancia do preco em ATR', () => {
    const map = buildLevelMap(location(), {
      swings: [
        { kind: 'high', price: 104 }, { kind: 'high', price: 110 }, { kind: 'high', price: 108 },
        { kind: 'low', price: 97 }, { kind: 'low', price: 92 }, { kind: 'low', price: 95 },
      ],
    });
    expect(map).toEqual({
      price: 100, atr: 2,
      above: { level: 104, atr: 2, next: 108, nextAtr: 4 },
      below: { level: 97, atr: 1.5, next: 95, nextAtr: 2.5 },
    });
  });

  it('nivel a menos de 0,25 ATR do primeiro conta como o mesmo nivel', () => {
    const map = buildLevelMap(location(), { swings: [{ kind: 'high', price: 104.4 }, { kind: 'high', price: 106 }] });
    expect(map?.above?.next).toBe(106);
  });

  it('sem a 2a swing fractal: swings do resumo, depois a maxima/minima da janela', () => {
    const map = buildLevelMap(location(), { swings: [], swingHighs: [103, 107], swingLows: [], windowLow: 90 });
    expect(map?.above).toEqual({ level: 104, atr: 2, next: 107, nextAtr: 3.5 });
    expect(map?.below).toEqual({ level: 97, atr: 1.5, next: 90, nextAtr: 5 });
  });

  it('nada alem do nivel nas velas: next null (a tela diz que nao ha nivel mais alto)', () => {
    const map = buildLevelMap(location(), { swings: [], windowHigh: 104 });
    expect(map?.above).toEqual({ level: 104, atr: 2, next: null, nextAtr: null });
  });

  it('lado sem nivel fica null; sem preco/ATR ou sem nenhum lado, null', () => {
    expect(buildLevelMap(location({ resistance: null }), {})?.above).toBeNull();
    expect(buildLevelMap(location({ resistance: null, support: null }), {})).toBeNull();
    expect(buildLevelMap(location({ atr: 0 }), {})).toBeNull();
    expect(buildLevelMap(null, {})).toBeNull();
  });
});
