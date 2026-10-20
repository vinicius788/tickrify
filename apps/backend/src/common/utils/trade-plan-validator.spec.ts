import { limitNeedsConfirmation, validateTradePlan, type TradePlanInput } from './trade-plan-validator';
import { decideSignal, isCryptoSymbolForGuard } from './signal-decision';

const buy: TradePlanInput = {
  side: 'BUY',
  entry: 100,
  stopLoss: 95,
  takeProfit1: 110,
  takeProfit2: 120,
  invalidationLevel: 96,
  currentPrice: 101,
};
const sell: TradePlanInput = {
  side: 'SELL',
  entry: 100,
  stopLoss: 105,
  takeProfit1: 90,
  takeProfit2: 80,
  invalidationLevel: 104,
  currentPrice: 99,
};

describe('validateTradePlan', () => {
  it('passes coherent BUY and SELL plans', () => {
    expect(validateTradePlan(buy)).toEqual([]);
    expect(validateTradePlan(sell)).toEqual([]);
  });

  it('never checks a WAIT (there is no plan)', () => {
    expect(validateTradePlan({ ...buy, side: 'WAIT', stopLoss: 500, currentPrice: 1 })).toEqual([]);
  });

  describe('incomplete', () => {
    it('flags a BUY/SELL without entry, stop or any target', () => {
      expect(validateTradePlan({ ...buy, entry: null })).toContain('incomplete');
      expect(validateTradePlan({ ...sell, stopLoss: undefined })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, takeProfit1: null, takeProfit2: null })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, entry: Number.NaN })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, stopLoss: 0 })).toContain('incomplete');
    });

    it('accepts a plan with only one of the two targets', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: null })).toEqual([]);
    });
  });

  describe('direction', () => {
    it('BUY: stop must be below entry', () => {
      expect(validateTradePlan({ ...buy, stopLoss: 101 })).toContain('direction');
      expect(validateTradePlan({ ...buy, stopLoss: 100 })).toContain('direction');
    });
    it('BUY: targets must be above entry', () => {
      expect(validateTradePlan({ ...buy, takeProfit1: 99 })).toContain('direction');
      expect(validateTradePlan({ ...buy, takeProfit2: 98 })).toContain('direction');
    });
    it('SELL: stop must be above entry', () => {
      expect(validateTradePlan({ ...sell, stopLoss: 99 })).toContain('direction');
    });
    it('SELL: targets must be below entry', () => {
      expect(validateTradePlan({ ...sell, takeProfit1: 101 })).toContain('direction');
    });
  });

  describe('stop beyond invalidation', () => {
    it('BUY: a stop above the invalidation level fails', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: 94 })).toEqual(['stop_inside_invalidation']);
    });
    it('SELL: a stop below the invalidation level fails', () => {
      expect(validateTradePlan({ ...sell, invalidationLevel: 106 })).toEqual(['stop_inside_invalidation']);
    });
    it('a stop exactly at the invalidation level passes', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: 95 })).toEqual([]);
      expect(validateTradePlan({ ...sell, invalidationLevel: 105 })).toEqual([]);
    });
    it('is skipped when the model gave no invalidation level', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: null })).toEqual([]);
      expect(validateTradePlan({ ...buy, invalidationLevel: 0 })).toEqual([]);
    });
  });

  describe('plausible price range', () => {
    it('rejects a level far above the chart price (extra digit)', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 1200 })).toEqual(['implausible_price']);
    });
    it('rejects a level far below the chart price', () => {
      expect(validateTradePlan({ ...sell, takeProfit2: 8 })).toEqual(['implausible_price']);
    });
    it('accepts levels within half and double the chart price', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 200 })).toEqual([]);
      expect(validateTradePlan({ ...sell, takeProfit2: 50, takeProfit1: 60 })).toEqual([]);
    });
    it('is skipped when the chart price was not read', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 1200, currentPrice: 0 })).toEqual([]);
      expect(validateTradePlan({ ...buy, takeProfit2: 1200, currentPrice: null })).toEqual([]);
    });
  });
});

describe('decideSignal with the plan validator', () => {
  const oldNews = process.env.ENABLE_NEWS_GUARD;
  beforeAll(() => { process.env.ENABLE_NEWS_GUARD = 'false'; });
  afterAll(() => {
    if (oldNews === undefined) delete process.env.ENABLE_NEWS_GUARD;
    else process.env.ENABLE_NEWS_GUARD = oldNews;
  });

  const base = {
    recommendation: 'BUY' as const,
    flooredConfidence: 70,
    trendStrength: 'strong',
    factorsPresent: 6,
    riskRewardTp1: 2,
    riskRewardTp2: 4,
    symbol: 'TEST',
  };

  it('leaves a clean plan alone: validator_action none', async () => {
    const d = await decideSignal({ ...base, planFailures: [] });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'none', validatorReasons: [] });
  });

  it('marks a price-magnitude correction as fixed', async () => {
    const d = await decideSignal({ ...base, planFailures: [], priceFixed: true });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'fixed' });
  });

  it('downgrades a failing plan to WAIT with confidence at most 45', async () => {
    const d = await decideSignal({ ...base, planFailures: ['implausible_price'], priceFixed: true });
    expect(d.recommendation).toBe('WAIT');
    expect(d.confidence).toBeLessThanOrEqual(45);
    expect(d).toMatchObject({ validatorAction: 'downgraded', validatorReasons: ['implausible_price'] });
  });

  it('counts the existing R/R guard (best target below 1.2) as a downgrade', async () => {
    const d = await decideSignal({ ...base, riskRewardTp1: 0.8, riskRewardTp2: 1.1, planFailures: [] });
    expect(d).toMatchObject({ recommendation: 'WAIT', validatorAction: 'downgraded', validatorReasons: ['rr_below_min'] });
  });

  it('keeps the current R/R rule: TP1 below 1.5 with a good TP2 stays a trade', async () => {
    const d = await decideSignal({ ...base, riskRewardTp1: 1.1, riskRewardTp2: 2.3, planFailures: [] });
    expect(d.recommendation).toBe('BUY');
  });

  it('stop before invalidation only measures: the trade stays, the flag is recorded', async () => {
    const d = await decideSignal({ ...base, planFailures: ['stop_inside_invalidation'] });
    expect(d).toMatchObject({
      recommendation: 'BUY',
      validatorAction: 'none',
      validatorReasons: [],
      validatorFlags: ['stop_inside_invalidation'],
    });
  });

  it('a measure-only flag does not hide a real downgrade', async () => {
    const d = await decideSignal({ ...base, planFailures: ['stop_inside_invalidation', 'implausible_price'] });
    expect(d).toMatchObject({
      recommendation: 'WAIT',
      validatorAction: 'downgraded',
      validatorReasons: ['implausible_price'],
      validatorFlags: ['stop_inside_invalidation'],
    });
  });

  it('never downgrades a WAIT again', async () => {
    const d = await decideSignal({ ...base, recommendation: 'WAIT', planFailures: ['implausible_price'] });
    expect(d).toMatchObject({ recommendation: 'WAIT', validatorAction: 'none', validatorFlags: [] });
  });
});

// Frases reais das 92 respostas guardadas do luna (19/10/2026).
describe('limit_needs_confirmation (so mede)', () => {
  it.each([
    'Place a sell limit at 113,700 only after a sweep/rejection of 113,800; no reclaim, no trade.',
    'Pending sell limit at $90,800 after buy-side sweep and rejection; no rejection, no trade.',
    'After a sweep above 3400 and bearish rejection, place sell limit at 3390; no sweep, no trade.',
    'Comprar somente em 155.25 após retorno/rejeição no OB 155.20–155.30; sem entrada a mercado.',
    'Após varredura de 1874,0–1870,0 e fechamento M15 retomando 1874,5; sem compra a mercado.',
    'Aguardar retração a 31.500 e rejeição bullish na demanda 31.200–31.800.',
    // Confirmacao na entrada continua marcada mesmo com cancelamento depois.
    'Pending sell limit at 90,300 after the 90,500 liquidity sweep; cancel on close above 91,100.',
    'Sell limit at 114500 only after a sweep/rejection; cancel if price closes above 116000.',
  ])('marca: %s', (text) => {
    expect(limitNeedsConfirmation('limit', text)).toBe(true);
  });

  it.each([
    'Place a buy limit at 94,700 within the bullish OB/FVG; no fill, no trade.',
    'Place a sell limit at 114000 only on retracement into the 113800-114500 bearish OB; no chase.',
    'Comprar somente em 190.50 dentro da demanda; rejeição bullish preferível.',
    'Ativar somente em retração a 1.07855, idealmente com rejeição bullish na zona.',
    'BUY limit 1.0788 na demanda/FVG; cancelar se M15 fechar abaixo de 1.0770.',
    // Experimento D (19/10/2026): regra de cancelamento, nao condicao de entrada.
    'Pending sell limit at 3375 within 3365-3400 OB; cancel after a close above 3448.',
    'Pending limit at 1874.8, cancel once price closes below 1869.5.',
    'Sell limit at 4250 inside the OB. Invalidated after a close above 4300.',
    '',
  ])('nao marca: %s', (text) => {
    expect(limitNeedsConfirmation('limit', text)).toBe(false);
  });

  it('so vale para ordem limit', () => {
    const text = 'Enter only after a close above 101 and a confirmed reclaim.';
    expect(limitNeedsConfirmation('stop', text)).toBe(false);
    expect(limitNeedsConfirmation(null, text)).toBe(false);
    expect(limitNeedsConfirmation(' LIMIT ', text)).toBe(true);
  });

  it('entra na lista do validador e nunca rebaixa o sinal', async () => {
    const plan = { ...buy, entryType: 'limit', entryCondition: 'Buy limit at 100 only after a sweep and rejection.' };
    expect(validateTradePlan(plan)).toEqual(['limit_needs_confirmation']);
    expect(validateTradePlan({ ...plan, side: 'WAIT' })).toEqual([]);
    const d = await decideSignal({
      recommendation: 'BUY', flooredConfidence: 70, trendStrength: 'moderate', factorsPresent: 6,
      riskRewardTp1: 2, riskRewardTp2: 4, symbol: 'TEST', planFailures: validateTradePlan(plan),
    });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'none', validatorReasons: [], validatorFlags: ['limit_needs_confirmation'] });
  });
});

// Cripto (19/10/2026): chave desligada mede, ligada rebaixa so cripto.
describe('ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD', () => {
  const saved = process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD;
  const savedNews = process.env.ENABLE_NEWS_GUARD;
  beforeAll(() => { process.env.ENABLE_NEWS_GUARD = 'false'; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD;
    else process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = saved;
  });
  afterAll(() => {
    if (savedNews === undefined) delete process.env.ENABLE_NEWS_GUARD;
    else process.env.ENABLE_NEWS_GUARD = savedNews;
  });
  const decide = (symbol: string) => decideSignal({
    recommendation: 'BUY', flooredConfidence: 70, trendStrength: 'moderate', factorsPresent: 6,
    riskRewardTp1: 2, riskRewardTp2: 4, symbol, planFailures: ['limit_needs_confirmation'],
  });

  it('desligada (padrao): so marca, nunca rebaixa', async () => {
    delete process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD;
    expect(await decide('BTCUSDT')).toMatchObject({ recommendation: 'BUY', validatorAction: 'none', validatorFlags: ['limit_needs_confirmation'] });
  });

  it('ligada: cripto vira WAIT com o motivo e confianca <= 45', async () => {
    process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = 'true';
    for (const symbol of ['BTCUSDT', 'ETH/USD', 'SOLUSDT']) {
      const d = await decide(symbol);
      expect(d).toMatchObject({ recommendation: 'WAIT', validatorAction: 'downgraded', validatorReasons: ['limit_needs_confirmation'], validatorFlags: [] });
      expect(d.confidence).toBeLessThanOrEqual(45);
    }
  });

  it('ligada: so a marca de limit com confirmacao muda; stop antes da invalidacao segue so medindo', async () => {
    process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = 'true';
    const d = await decideSignal({
      recommendation: 'BUY', flooredConfidence: 70, trendStrength: 'moderate', factorsPresent: 6,
      riskRewardTp1: 2, riskRewardTp2: 4, symbol: 'BTCUSDT', planFailures: ['stop_inside_invalidation'],
    });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'none', validatorFlags: ['stop_inside_invalidation'] });
  });

  it('ligada: ouro, forex e indice seguem so medindo', async () => {
    process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = 'true';
    for (const symbol of ['XAUUSD', 'EURUSD', 'US500']) {
      expect(await decide(symbol)).toMatchObject({ recommendation: 'BUY', validatorFlags: ['limit_needs_confirmation'] });
    }
  });
});

describe('isCryptoSymbolForGuard (sufixo de corretora)', () => {
  it.each(['BTCUSDT', 'BTC', 'BTC/USD', 'WIF/USDT', 'BTCUSDm', 'BTCUSDM', 'ETHUSDc', 'SOLUSDz', 'BTCUSDTm', 'BTCUSD.pro', 'ETHUSD-P', 'BTCUSDT_PERP', 'BTCUSD#'])(
    'cripto: %s', (symbol) => expect(isCryptoSymbolForGuard(symbol)).toBe(true));

  it.each(['XAUUSD', 'XAUUSDm', 'XAUUSD.s', 'XAUUSD-P', 'XAUTUSD', 'XAGUSDm', 'GOLD', 'EURUSD', 'EURUSDm', 'EURUSD.pro', 'USDJPYc', 'GBPJPYz',
    'US500', 'US500m', 'NAS100.cash', 'USOILm', 'AAPL', 'PAXGUSDT', 'XAUTUSDT', '', null, undefined])(
    'nao cripto: %s', (symbol) => expect(isCryptoSymbolForGuard(symbol)).toBe(false));

  it('guard ligado: BTCUSDm vira WAIT, XAUUSDm e EURUSDm nao', async () => {
    const savedKey = process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD;
    const savedNews = process.env.ENABLE_NEWS_GUARD;
    process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = 'true';
    process.env.ENABLE_NEWS_GUARD = 'false';
    try {
      const decide = (symbol: string) => decideSignal({
        recommendation: 'SELL', flooredConfidence: 70, trendStrength: 'moderate', factorsPresent: 6,
        riskRewardTp1: 2, riskRewardTp2: 4, symbol, planFailures: ['limit_needs_confirmation'],
      });
      expect((await decide('BTCUSDm')).recommendation).toBe('WAIT');
      expect((await decide('XAUUSDm')).recommendation).toBe('SELL');
      expect((await decide('EURUSDm')).recommendation).toBe('SELL');
    } finally {
      if (savedKey === undefined) delete process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD;
      else process.env.ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD = savedKey;
      if (savedNews === undefined) delete process.env.ENABLE_NEWS_GUARD;
      else process.env.ENABLE_NEWS_GUARD = savedNews;
    }
  });
});
