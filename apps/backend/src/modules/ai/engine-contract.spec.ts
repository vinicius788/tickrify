import {
  ENGINE_VERSION,
  buildEngineContract,
  buildEngineRecord,
  parseEngineContract,
  type EngineContractInput,
} from './engine-contract';

const trade: EngineContractInput = {
  recommendation: 'BUY',
  confidencePct: 63.6,
  symbol: 'BTCUSDT',
  timeframe: '1h',
  entry: 62_000,
  stopLoss: 61_200,
  takeProfit1: 63_500,
  takeProfit2: 64_800,
  invalidationLevel: 61_300,
  executiveSummary: 'Higher lows hold above the 61.3k demand. Price retests the breakout. Volume confirms. Extra sentence.',
  validatorReasons: [],
};

describe('engine contract v2', () => {
  it('has the fields in the agreed order and the version from one place', () => {
    const c = buildEngineContract(trade);
    expect(Object.keys(c)).toEqual([
      'verdict', 'confidence', 'asset', 'timeframe', 'entry', 'stop', 'targets',
      'invalidation', 'key_reasons', 'no_trade_reason', 'engine_version',
    ]);
    expect(ENGINE_VERSION).toBe('2.0.0');
    expect(c.engine_version).toBe(ENGINE_VERSION);
  });

  it('maps BUY/SELL/WAIT to BULLISH/BEARISH/NEUTRAL only in the contract', () => {
    expect(buildEngineContract(trade).verdict).toBe('BULLISH');
    expect(buildEngineContract({ ...trade, recommendation: 'SELL', stopLoss: 63_000, takeProfit1: 61_000, takeProfit2: 60_000 }).verdict).toBe('BEARISH');
    expect(buildEngineContract({ ...trade, recommendation: 'WAIT' }).verdict).toBe('NEUTRAL');
  });

  it('a trade carries levels, rounded confidence and at most 3 short reasons', () => {
    const c = buildEngineContract(trade);
    expect(c).toMatchObject({
      confidence: 64,
      entry: 62_000,
      stop: 61_200,
      targets: [63_500, 64_800],
      invalidation: 61_300,
      no_trade_reason: null,
    });
    expect(c.key_reasons).toHaveLength(3);
    expect(parseEngineContract(c)).toEqual(c);
  });

  it('NEUTRAL has no levels and always explains why', () => {
    const fromModel = buildEngineContract({ ...trade, recommendation: 'WAIT' });
    expect(fromModel).toMatchObject({ entry: null, stop: null, targets: [], invalidation: null });
    expect(fromModel.no_trade_reason).toBe('Higher lows hold above the 61.3k demand.');
    expect(parseEngineContract(fromModel)).not.toBeNull();

    const fromValidator = buildEngineContract({ ...trade, recommendation: 'WAIT', validatorReasons: ['rr_below_min'] });
    expect(fromValidator.no_trade_reason).toBe('No target pays enough for the risk.');

    const empty = buildEngineContract({ ...trade, recommendation: 'WAIT', executiveSummary: '' });
    expect(empty.no_trade_reason).toBe('No trade setup on this chart.');
  });

  it('rejects anything outside the format', () => {
    const ok = buildEngineContract(trade);
    expect(parseEngineContract(null)).toBeNull();
    expect(parseEngineContract({ ...ok, verdict: 'BUY' })).toBeNull();
    expect(parseEngineContract({ ...ok, confidence: 101 })).toBeNull();
    expect(parseEngineContract({ ...ok, targets: [] })).toBeNull();
    expect(parseEngineContract({ ...ok, no_trade_reason: 'x' })).toBeNull();
    expect(parseEngineContract({ ...ok, verdict: 'NEUTRAL' })).toBeNull();
  });

  it('a BUY without targets does not produce a contract, and says so', () => {
    const warn = jest.fn();
    const record = buildEngineRecord({
      contract: { ...trade, takeProfit1: null, takeProfit2: null },
      validatorAction: 'none',
      validatorFlags: [],
      timings: {},
      warn,
    });
    expect(record.contract).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the record keeps version, data mode, validator and per-stage timings', () => {
    const record = buildEngineRecord({
      contract: trade,
      validatorAction: 'fixed',
      validatorFlags: ['stop_inside_invalidation'],
      timings: { image_prep_ms: 120.4, queue_ms: -1, model_ms: 18_500, server_total_ms: 19_900 },
      warn: jest.fn(),
    });
    expect(record).toMatchObject({
      version: '2.0.0',
      data_mode: 'print',
      validator_action: 'fixed',
      validator_reasons: [],
      validator_flags: ['stop_inside_invalidation'],
      timings: {
        image_prep_ms: 120,
        intake_ms: null,
        // -1 no worker = etapa que nao rodou
        queue_ms: null,
        model_ms: 18_500,
        server_total_ms: 19_900,
      },
    });
    expect(record.contract?.verdict).toBe('BULLISH');
  });
});
