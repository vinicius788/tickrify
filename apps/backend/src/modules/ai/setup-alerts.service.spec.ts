import { HttpException, ValidationPipe } from '@nestjs/common';
import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import {
  ALERT_RULES,
  SetupAlertsService,
  alertSuggestions,
  createAlertTick,
  createEntryAlerts,
  createWatchAlert,
  findTrigger,
  runAlertMonitor,
  sideFor,
} from './setup-alerts.service';
import { CreateSetupAlertDto, ListSetupAlertsQueryDto } from './dto/setups.dto';
import { SetupsController } from './setups.controller';
import { TwelveDataUnavailableError, __setTwelveDataForTests, fxMarketClosed } from '../market/twelve-data';
import { fetchFxLatest5m as fetchFxLatest5mMock, fetchCrypto1m as fetchCrypto1mMock, priceSymbolOf, type Candle } from '../market/candles';
const fetchCrypto1m = fetchCrypto1mMock as jest.Mock;
const fetchFxLatest5m = fetchFxLatest5mMock as jest.Mock;
import { captureServer as captureServerMock } from '../../common/analytics/posthog';

jest.mock('../market/candles', () => ({
  ...jest.requireActual('../market/candles'),
  // Sem preco de mercado por padrao: a criacao cai no preco da analise.
  fetchCrypto1m: jest.fn(async () => null),
  fetchFxLatest5m: jest.fn(async () => null),
}));
jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));
const captureServer = captureServerMock as jest.Mock;

const T = Date.parse('2026-10-27T12:00:00Z');
const M5 = 5 * 60 * 1000;
const bar = (i: number, high: number, low: number): Candle => [T + i * M5, low, high, low, high];

const SETUP = { id: 'setup-aaaaaaaa', status: 'tracking', timeframe: '15m' };
const BUY_GOLD = {
  id: 'analysis00001',
  status: 'completed',
  recommendation: 'BUY',
  setupId: null,
  result: {
    analysis: { symbol: 'XAUUSD', timeframe: '15m', currentPrice: 4150, entry: 4140, stopLoss: 4120, takeProfit1: 4180, invalidationLevel: 4115 },
  },
};

const oldKey = process.env.TWELVE_DATA_API_KEY;
beforeAll(() => {
  process.env.TWELVE_DATA_API_KEY = 'test-key';
});
afterAll(() => {
  if (oldKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
  else process.env.TWELVE_DATA_API_KEY = oldKey;
});
beforeEach(() => {
  captureServer.mockClear();
  fetchCrypto1m.mockReset();
  fetchCrypto1m.mockResolvedValue(null);
  fetchFxLatest5m.mockReset();
  fetchFxLatest5m.mockResolvedValue(null);
  __setTwelveDataForTests({ now: () => new Date('2026-10-27T12:30:00Z') });
});

const CLOCK = { nowMs: T + 60 * M5, stepMs: M5 };

describe('regras puras dos alertas', () => {
  it('disparo acima: maxima de um candle depois da criacao toca o nivel', () => {
    const alert = { level: 110, side: 'above' as const, watchFrom: new Date(T + M5) };
    expect(findTrigger(alert, [bar(0, 109, 100), bar(1, 109.9, 101), bar(2, 110, 102)], CLOCK)).toEqual({ at: new Date(T + 2 * M5), price: 110 });
    expect(findTrigger(alert, [bar(1, 109.9, 101)], CLOCK)).toBeNull();
  });

  it('disparo abaixo: minima toca o nivel', () => {
    const alert = { level: 95, side: 'below' as const, watchFrom: new Date(T) };
    expect(findTrigger(alert, [bar(0, 101, 96), bar(1, 100, 94.5)], CLOCK)).toEqual({ at: new Date(T + M5), price: 94.5 });
  });

  it('candle que abriu ANTES do alerta nunca conta, mesmo cruzando o nivel', () => {
    const alert = { level: 110, side: 'above' as const, watchFrom: new Date(T + M5 / 2) };
    expect(findTrigger(alert, [bar(0, 120, 100)], CLOCK)).toBeNull();
    expect(findTrigger(alert, [bar(0, 120, 100), bar(1, 111, 100)], CLOCK)?.at).toEqual(new Date(T + M5));
  });

  it('lado sai do preco da analise; nivel no preco nao tem lado', () => {
    expect(sideFor(110, 100)).toBe('above');
    expect(sideFor(90, 100)).toBe('below');
    expect(sideFor(100, 100)).toBeNull();
  });

  it('fonte de preco: cripto, metal e forex com chave; sinteticos, acoes e forex sem chave ficam de fora', () => {
    expect(priceSymbolOf('BTCUSD')).toEqual({ priceSymbol: 'BTCUSDT', source: 'crypto', symbolClass: 'crypto' });
    expect(priceSymbolOf('XAUUSDm')).toEqual({ priceSymbol: 'XAUUSD', source: 'fx', symbolClass: 'metal' });
    expect(priceSymbolOf('EURUSD')?.symbolClass).toBe('forex');
    expect(priceSymbolOf('Volatility 75 Index')).toBeNull();
    expect(priceSymbolOf('AAPL')).toBeNull();
    expect(priceSymbolOf(null)).toBeNull();
    delete process.env.TWELVE_DATA_API_KEY;
    expect(priceSymbolOf('XAUUSD')).toBeNull();
    process.env.TWELVE_DATA_API_KEY = 'test-key';
  });

  it('niveis preenchidos: BUY/SELL = entrada, stop, TP1 e invalidacao; WAIT = invalidacao ou shadow; WAIT do modelo sem nivel = nada', () => {
    expect(alertSuggestions(BUY_GOLD.result, 'BUY')).toEqual([
      { label: 'entry', level: 4140 },
      { label: 'stop', level: 4120 },
      { label: 'tp1', level: 4180 },
      { label: 'invalidation', level: 4115 },
    ]);
    const shadowWait = { analysis: { symbol: 'BTCUSD', entry: 100, stopLoss: 95, takeProfit1: 110 } };
    expect(alertSuggestions(shadowWait, 'WAIT').map((s) => s.label)).toEqual(['entry', 'stop', 'tp1']);
    expect(alertSuggestions({ analysis: { symbol: 'BTCUSD', invalidationLevel: 90 } }, 'WAIT')).toEqual([{ label: 'invalidation', level: 90 }]);
    expect(alertSuggestions({ analysis: { symbol: 'BTCUSD', entryCondition: 'Wait for a close above 100' } }, 'WAIT')).toEqual([]);
  });

  it('WATCH: o nivel do plano (borda proxima, rotulo entry) e a invalidacao vem preenchidos', () => {
    expect(alertSuggestions(WATCH_BTC.result, 'WAIT', WATCH_BTC)).toEqual([
      { label: 'entry', level: 77800 },
      { label: 'invalidation', level: 78400 },
    ]);
  });

  it('a validade das sugestoes segue o intervalo do grounding, inclusive no POST', async () => {
    const analysis = { ...WATCH_BTC, createdAt: new Date(Date.now() - 2 * 3600_000), groundingInterval: '5m' };
    const { service } = await ready({ analysis });
    expect((await service.options('u', analysis.id, true)).suggestions).toEqual([]);
    await expect(service.create({ id: 'u' }, { analysisId: analysis.id, level: 77800, label: 'entry' },
      { isSubscriber: true, trialDay: null })).rejects.toMatchObject({ response: { code: 'alert_level_mismatch' } });
  });

  it('forex fechado no fim de semana', () => {
    expect(fxMarketClosed(new Date('2026-10-24T12:00:00Z'))).toBe(true); // sabado
    expect(fxMarketClosed(new Date('2026-10-23T22:30:00Z'))).toBe(true); // sexta a noite
    expect(fxMarketClosed(new Date('2026-10-25T21:30:00Z'))).toBe(true); // domingo antes da abertura (22h UTC)
    expect(fxMarketClosed(new Date('2026-10-25T22:30:00Z'))).toBe(false);
    expect(fxMarketClosed(new Date('2026-10-27T12:00:00Z'))).toBe(false);
  });
});

const WATCH_BTC = {
  createdAt: new Date(), groundingInterval: null, id: 'analysis00002', status: 'completed', recommendation: 'WAIT', setupId: null,
  result: {
    signalState: 'WATCH',
    watchPlan: { direction: 'short', triggerType: 'zone_reaction', zoneLow: 77800, zoneHigh: 78000, invalidation: 78400,
      target1: 76900, target2: null, validForCandles: 12, trigger: 'Bearish close below 77,800' },
    analysis: { symbol: 'BTCUSDT', timeframe: '15m', currentPrice: 77200 },
  },
};

function makeService(opts: { activeOnSetup?: number; setupsWithAlerts?: number; sameLevel?: boolean; analysis?: unknown; cachedPrice?: { lastPrice: number; checkedAt: Date } } = {}) {
  const { prisma, calls } = makePrisma([
    ['SELECT "lastPrice", "checkedAt" FROM', () => (opts.cachedPrice ? [opts.cachedPrice] : [])],
    ['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [opts.analysis ?? BUY_GOLD]],
    ['a."level" =', () => (opts.sameLevel ? [{ id: 'alert-existing0', status: 'active', level: 4140 }] : [])],
    ['COUNT(DISTINCT "setupId")', () => [{ n: opts.setupsWithAlerts ?? 0 }]],
    ['COUNT(*)::int AS "n" FROM "tickrify"."SetupAlert"', () => [{ n: opts.activeOnSetup ?? 0 }]],
    ['WHERE a."id" =', (_text, values) => [{ id: values[0], setupId: SETUP.id, analysisId: 'analysis00001', symbol: 'XAUUSD', level: 4140, label: 'entry', side: 'below', status: 'active', createdAt: new Date(T) }]],
  ]);
  const setups = {
    follow: jest.fn(async () => ({ setup: SETUP })),
    findForAnalysis: jest.fn(async () => ({ setup: null })),
  };
  const service = new SetupAlertsService(prisma, setups as any);
  return { service, prisma, calls, setups };
}

async function ready(opts: Parameters<typeof makeService>[0] = {}) {
  const made = makeService(opts);
  await made.service.onModuleInit();
  return made;
}

const user = { id: 'u1', clerkUserId: 'clerk_1' };
const free = { isSubscriber: false, trialDay: 1 };

describe('SetupAlertsService.create', () => {
  it('cria o alerta preenchido, segue o setup no mesmo clique e emite setup_alert_created', async () => {
    const { service, calls, setups } = await ready();
    const { alert, setupId } = await service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free);
    expect(setupId).toBe(SETUP.id);
    expect(setups.follow).toHaveBeenCalledWith(user, 'analysis00001');
    expect(alert).toMatchObject({ label: 'entry', level: 4140, status: 'active' });
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));
    // Alerta feito a mao nao expira.
    expect(insert?.values[insert.values.length - 1]).toBeNull();
    // Entrada abaixo do preco da analise (4150): dispara quando a minima toca.
    expect(insert?.values).toEqual(expect.arrayContaining(['u1', SETUP.id, 'XAUUSD', 4140, 'entry', 'below', 4150, true]));
    expect(calls.findIndex((c) => c.text.includes('pg_advisory_xact_lock'))).toBeLessThan(
      calls.findIndex((c) => c.text.includes('COUNT(*)')),
    );
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_created', expect.objectContaining({
      label: 'entry', prefilled: true, symbol_class: 'metal', is_subscriber: false, trial_day: 1,
    }));
  });

  it('WATCH: "Alert me at <nivel>" cria o alerta preenchido no nivel do plano, com as mesmas regras', async () => {
    const { service, calls } = await ready({ analysis: WATCH_BTC });
    const { alert } = await service.create(user, { analysisId: 'analysis00002', label: 'entry', level: 77800 }, free);
    expect(alert.status).toBe('active');
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));
    expect(insert?.values).toEqual(expect.arrayContaining(['BTCUSDT', 77800, 'entry', 'above', 77200, true]));
    await expect(service.create(user, { analysisId: 'analysis00002', label: 'entry', level: 77900 }, free)).rejects.toMatchObject({
      response: { code: 'alert_level_mismatch' },
    });
  });

  it('nivel digitado vai como custom (prefilled=false); rotulo que nao bate com o plano e recusado', async () => {
    const { service, calls } = await ready();
    await service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free);
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));
    expect(insert?.values).toEqual(expect.arrayContaining(['custom', 'above', false]));
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4141 }, free)).rejects.toMatchObject({
      response: { code: 'alert_level_mismatch' },
    });
  });

  it('nivel absurdo ou no proprio preco e recusado antes de seguir', async () => {
    const { service, setups } = await ready();
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 9000 }, free)).rejects.toMatchObject({
      response: { code: 'alert_level_out_of_range' },
    });
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4150 }, free)).rejects.toMatchObject({
      response: { code: 'alert_level_at_price' },
    });
    expect(setups.follow).not.toHaveBeenCalled();
  });

  it('ativo sem fonte de preco nao ganha alerta', async () => {
    const synthetic = { ...BUY_GOLD, result: { analysis: { ...BUY_GOLD.result.analysis, symbol: 'Volatility 75 Index' } } };
    const { service } = await ready({ analysis: synthetic });
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free)).rejects.toMatchObject({
      response: { code: 'alert_unavailable' },
    });
  });

  it('lado pelo preco de AGORA (cache do monitor): analise antiga com o preco ja longe nao dispara na hora', async () => {
    // Analise a 4150; o ouro agora esta a 4300. Nivel 4200 fica ABAIXO do preco atual.
    const { service, calls } = await ready({ cachedPrice: { lastPrice: 4300, checkedAt: new Date() } });
    await service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free);
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));
    expect(insert?.values).toEqual(expect.arrayContaining(['below', 4300]));
    expect(fetchCrypto1m).not.toHaveBeenCalled();
  });

  it('cache velho: busca o ultimo candle de 5m de forex pelo cache compartilhado com o grounding', async () => {
    fetchFxLatest5m.mockResolvedValue([[Date.now() - 300_000, 4290, 4295, 4285, 4290]]);
    const { service, calls } = await ready({ cachedPrice: { lastPrice: 4000, checkedAt: new Date(Date.now() - 60 * 60_000) } });
    await service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free);
    expect(fetchFxLatest5m).toHaveBeenCalledWith('XAUUSD', 'monitor', ALERT_RULES.cacheTtlMs.fx);
    expect(fetchCrypto1m).not.toHaveBeenCalled();
    expect(calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'))?.values).toEqual(expect.arrayContaining(['below', 4290]));
  });


  it('sem preco de mercado (fonte fora): usa o preco da analise, e sem nenhum preco recusa', async () => {
    const { service, calls } = await ready();
    await service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free);
    expect(calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'))?.values).toEqual(expect.arrayContaining(['above', 4150]));
    const noPrice = { ...BUY_GOLD, result: { analysis: { ...BUY_GOLD.result.analysis, currentPrice: 0 } } };
    const bare = await ready({ analysis: noPrice });
    await expect(bare.service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free)).rejects.toMatchObject({
      response: { code: 'alert_price_unavailable' },
    });
  });

  it(`teto por setup: ${ALERT_RULES.maxActivePerSetup} ativos`, async () => {
    const { service } = await ready({ activeOnSetup: ALERT_RULES.maxActivePerSetup });
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free)).rejects.toMatchObject({
      response: { code: 'alert_setup_limit' },
    });
  });

  it('teto por pessoa no servidor: gratis/trial 2 setups com alerta, assinante 10', async () => {
    const atFree = await ready({ setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.free });
    await expect(atFree.service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free)).rejects.toMatchObject({
      response: { code: 'alert_limit', limit: 2 },
    });
    const paid = await ready({ setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.free });
    await expect(paid.service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, { isSubscriber: true, trialDay: null })).resolves.toBeDefined();
    const atPaid = await ready({ setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.subscriber });
    await expect(atPaid.service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, { isSubscriber: true, trialDay: null })).rejects.toMatchObject({
      response: { code: 'alert_limit', limit: 10 },
    });
  });

  it('mais um alerta num setup que ja tem alerta nao conta como setup novo', async () => {
    const { service } = await ready({ activeOnSetup: 1, setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.free });
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free)).resolves.toBeDefined();
  });

  it('clique duplo no mesmo nivel devolve o mesmo alerta, sem evento novo', async () => {
    const { service, calls } = await ready({ sameLevel: true });
    const { alert } = await service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free);
    expect(alert.id).toBe('alert-existing0');
    expect(calls.some((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'))).toBe(false);
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('analise alheia ou inexistente = 404', async () => {
    const { prisma } = makePrisma([]);
    const service = new SetupAlertsService(prisma, { follow: jest.fn() } as any);
    await service.onModuleInit();
    await expect(service.create(user, { analysisId: 'analysis00001', label: 'entry', level: 4140 }, free)).rejects.toMatchObject({ status: 404 });
    await expect(service.cancel('u1', 'alert-aaaaaaaa')).rejects.toMatchObject({ status: 404 });
    await expect(service.markSeen('u1', 'alert-aaaaaaaa')).rejects.toMatchObject({ status: 404 });
  });

  it('sem as tabelas no boot, tudo responde 503 (nada quebra o resto)', async () => {
    const { prisma } = makePrisma([]);
    prisma.$executeRawUnsafe = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new SetupAlertsService(prisma, {} as any);
    await service.onModuleInit();
    await expect(service.list('u1')).rejects.toMatchObject({ status: 503 });
    await expect(service.cancelForSetup('u1', SETUP.id)).resolves.toBeUndefined();
  });
});

describe('alerta do My assets (sem analise)', () => {
  const inserted = (calls: Array<{ kind: string; text: string; values: unknown[] }>) =>
    calls.filter((c) => c.kind === 'execute' && c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));

  it('grava um alerta por nivel, sem setup nem analise, com o lado pelo preco e validade de um dia', async () => {
    const { service, calls } = await ready();
    const before = Date.now();
    await expect(service.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [104, 97, 104] }, { isSubscriber: false }))
      .resolves.toEqual({ created: 2 });
    const rows = inserted(calls);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toContain('NULL, NULL');
    expect(rows[0].text).toContain(`'custom'`);
    expect(rows.map((c) => c.values.slice(1, 7))).toEqual([
      ['u1', 'BTCUSDT', 'BTCUSDT', 104, 'above', 100],
      ['u1', 'BTCUSDT', 'BTCUSDT', 97, 'below', 100],
    ]);
    const expires = (rows[0].values[7] as Date).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + ALERT_RULES.assetAlertMs);
    // Os anteriores do mesmo ativo saem antes; os de setup nao sao tocados.
    const cancel = calls.find((c) => c.kind === 'execute' && c.text.includes(`"status" = 'cancelled'`))!;
    expect(cancel.text).toContain('"setupId" IS NULL AND "symbol" =');
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_created', expect.objectContaining({ source: 'asset', levels: 2, symbol_class: 'crypto' }));
  });

  it('nivel que o preco real ja passou nao vira alerta; sem nenhum, recusa e nada e gravado', async () => {
    const { service, calls } = await ready();
    service.latestPrice = jest.fn(async () => 105);
    await service.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [104, 97] }, { isSubscriber: true });
    expect(inserted(calls).map((c) => c.values[4])).toEqual([97]);
    service.latestPrice = jest.fn(async () => 90);
    await expect(service.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [97] }, { isSubscriber: true }))
      .rejects.toMatchObject({ response: { code: 'asset_levels_unavailable' } });
    expect(inserted(calls)).toHaveLength(1);
  });

  it('ativo sem fonte de preco nao tem alerta', async () => {
    const { service, calls } = await ready();
    await expect(service.setAssetAlerts(user, { symbol: 'NAS100', referencePrice: 100, levels: [104] }, { isSubscriber: true }))
      .rejects.toMatchObject({ response: { code: 'alert_unavailable' } });
    expect(inserted(calls)).toHaveLength(0);
  });

  it('boot: so altera a coluna que ainda recusa NULL; falhou, so este alerta fica fora', async () => {
    const ok = makeService();
    await ok.service.onModuleInit();
    expect(ok.service.assetAlertsAvailable).toBe(true);
    expect((ok.prisma.$executeRawUnsafe as jest.Mock).mock.calls.some(([sql]) => String(sql).includes('DROP NOT NULL'))).toBe(false);

    const { prisma } = makePrisma([['information_schema.columns', () => [{ name: 'setupId' }, { name: 'analysisId' }]]]);
    const service = new SetupAlertsService(prisma, {} as any);
    await service.onModuleInit();
    const ddl = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.map(([sql]) => String(sql));
    expect(ddl).toContain(`SET LOCAL lock_timeout = '3s'`);
    expect(ddl.filter((sql) => sql.includes('DROP NOT NULL'))).toHaveLength(2);

    const broken = makePrisma([['information_schema.columns', () => { throw new Error('lock timeout'); }]]);
    const off = new SetupAlertsService(broken.prisma, {} as any);
    await off.onModuleInit();
    expect(off.assetAlertsAvailable).toBe(false);
    await expect(off.assetAlerts('u1')).resolves.toEqual([]);
    await expect(off.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [104] }, { isSubscriber: true }))
      .rejects.toMatchObject({ response: { code: 'alerts_unavailable' } });
    // Os alertas de setup seguem valendo.
    await expect(off.list('u1')).resolves.toEqual({ items: [], unseen: 0 });
  });

  it('lista so os sem setup: ativos valendo e disparados nao vistos de um dia', async () => {
    const { service, calls } = await ready();
    await service.assetAlerts('u1', new Date(T));
    const query = calls.find((c) => c.text.includes('"setupId" IS NULL') && c.kind === 'query')!;
    expect(query.text).toContain(`"status" = 'triggered' AND "seenAt" IS NULL`);
    expect(query.values).toEqual(expect.arrayContaining(['u1', new Date(T), new Date(T - ALERT_RULES.assetAlertMs)]));
  });
});

describe('SetupsController (alertas): conta travada', () => {
  const locked = () => {
    const alerts = {
      list: jest.fn(),
      options: jest.fn(),
      create: jest.fn(),
      cancel: jest.fn(),
      markSeen: jest.fn(),
      pausedSymbol: jest.fn(async () => 'XAUUSD'),
    };
    const ai = {
      isFreeLocked: jest.fn(async () => true),
      freeLockedError: () => new HttpException({ code: 'free_quota_exhausted' }, 402),
      hasPaidAccess: jest.fn(async () => false),
    };
    return { controller: new SetupsController({} as any, ai as any, alerts as any, {} as any), alerts };
  };
  const me = { id: 'u1', clerkUserId: 'clerk_1' };

  it('criar, opcoes, cancelar e marcar visto respondem 402 sem tocar no servico', async () => {
    const { controller, alerts } = locked();
    await expect(controller.createAlert(me, { analysisId: 'analysis00001', label: 'entry', level: 1 })).rejects.toMatchObject({ status: 402 });
    // O "Alert me at <nivel>" do WATCH pendente e do mapa de niveis passa pela mesma rota.
    await expect(controller.createAlert(me, { analysisId: 'analysis00002', label: 'entry', level: 77800 })).rejects.toMatchObject({ status: 402 });
    await expect(controller.createAlert(me, { analysisId: 'analysis00002', label: 'custom', level: 79000 })).rejects.toMatchObject({ status: 402 });
    await expect(controller.alertOptions(me, 'analysis00001')).rejects.toMatchObject({ status: 402 });
    await expect(controller.cancelAlert(me, 'alert-aaaaaaaa')).rejects.toMatchObject({ status: 402 });
    await expect(controller.seenAlert(me, 'alert-aaaaaaaa')).rejects.toMatchObject({ status: 402 });
    expect(alerts.create).not.toHaveBeenCalled();
    expect(alerts.cancel).not.toHaveBeenCalled();
  });

  it('a lista responde pausada, com o ativo para o paywall e nenhum alerta', async () => {
    const { controller, alerts } = locked();
    await expect(controller.listAlerts(me, {})).resolves.toMatchObject({ paused: true, pausedSymbol: 'XAUUSD', items: [], unseen: 0 });
    expect(alerts.list).not.toHaveBeenCalled();
  });
});

describe('DTOs de alerta contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const body = (metatype: any) => ({ type: 'body' as const, metatype });

  it('criar: analise, rotulo da lista e nivel positivo; nada alem disso', async () => {
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'entry', level: 4180.5 }, body(CreateSetupAlertDto))).resolves.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'custom', level: 0.00012 }, body(CreateSetupAlertDto))).resolves.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'tp2', level: 1 }, body(CreateSetupAlertDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'entry', level: -1 }, body(CreateSetupAlertDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'entry', level: '4180' }, body(CreateSetupAlertDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', label: 'entry', level: 1, userId: 'u2' }, body(CreateSetupAlertDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: 'x', label: 'entry', level: 1 }, body(CreateSetupAlertDto))).rejects.toBeDefined();
  });

  it('lista: so o setup opcional', async () => {
    await expect(pipe.transform({}, { type: 'query', metatype: ListSetupAlertsQueryDto })).resolves.toBeDefined();
    await expect(pipe.transform({ setupId: 'setup-aaaaaaaa' }, { type: 'query', metatype: ListSetupAlertsQueryDto })).resolves.toBeDefined();
    await expect(pipe.transform({ setupId: '<x>' }, { type: 'query', metatype: ListSetupAlertsQueryDto })).rejects.toBeDefined();
  });
});

describe('runAlertMonitor', () => {
  it('cancela os automaticos vencidos pelo relogio, mesmo sem alerta ativo depois', async () => {
    const now = new Date('2026-11-09T15:00:00Z');
    const { prisma, calls } = makePrisma([]);
    const log = jest.fn();
    await runAlertMonitor({ prisma, now: () => now, isPaused: async () => false, log });
    const update = calls.find((c) => c.kind === 'execute' && c.text.includes('"expiresAt" <='));
    expect(update?.text).toContain('"expiresAt" IS NOT NULL');
    expect(update?.text).toContain(`"status" = 'cancelled'`);
    expect(update?.values).toEqual([now, now]);
    expect(log).toHaveBeenCalledWith('log', '[alerts] expirados=1');
  });

  const NOW = new Date(T + 30 * 60 * 1000);
  const alertRow = (extra: Record<string, unknown> = {}) => ({
    id: 'alert-1', userId: 'u1', setupId: SETUP.id, priceSymbol: 'BTCUSDT', level: 110, label: 'tp1', side: 'above',
    createdAt: new Date(T), watchFrom: new Date(T), clerkUserId: 'clerk_1', ...extra,
  });

  function monitor(opts: { rows?: unknown[]; claimed?: boolean; won?: number; paused?: string[]; candles?: Candle[] | null }) {
    const { prisma, calls } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => opts.rows ?? [alertRow()]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => (opts.claimed === false ? [] : [{ symbol: 'BTCUSDT' }])],
      ['SET "status" = \'triggered\'', () => opts.won ?? 1],
    ]);
    const fetchCrypto = jest.fn(async () => (opts.candles === undefined ? [bar(0, 105, 100), bar(3, 111, 104)] : opts.candles));
    const log = jest.fn();
    const run = () =>
      runAlertMonitor({
        prisma,
        now: () => NOW,
        fetchCrypto,
        isPaused: async (userId) => (opts.paused ?? []).includes(userId),
        log,
      });
    return { run, calls, fetchCrypto, log };
  }

  it('busca o ativo, grava o ultimo preco e dispara por UPDATE condicional', async () => {
    const { run, calls, fetchCrypto } = monitor({});
    await expect(run()).resolves.toEqual({ symbols: 1, checked: 1, triggered: 1, paused: 0 });
    expect(fetchCrypto).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), NOW.getTime());
    const trigger = calls.find((c) => c.text.includes('SET "status" = \'triggered\''));
    expect(trigger?.text).toContain('AND "status" = \'active\'');
    expect(trigger?.values).toEqual(expect.arrayContaining([new Date(T + 3 * M5), 111, 'alert-1']));
    expect(calls.find((c) => c.text.includes('UPDATE "tickrify"."AlertPriceCheck"'))?.values).toEqual(expect.arrayContaining([NOW, 111]));
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_triggered', {
      alertId: 'alert-1', setupId: SETUP.id, label: 'tp1', symbol_class: 'crypto', minutes_to_trigger: 15,
    }, { dedupeKey: 'setup_alert_triggered:alert-1' });
  });

  it('alerta do My assets (sem setup) e vigiado e dispara igual; setup largado segue fora', async () => {
    const { run, calls } = monitor({ rows: [alertRow({ setupId: null, label: 'custom' })] });
    await expect(run()).resolves.toMatchObject({ checked: 1, triggered: 1 });
    const select = calls.find((c) => c.text.includes('ORDER BY a."priceSymbol"'))!;
    expect(select.text).toContain('LEFT JOIN "tickrify"."TrackedSetup"');
    expect(select.text).toContain('AND (a."setupId" IS NULL OR s."id" IS NOT NULL)');
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_triggered', expect.objectContaining({ setupId: null, label: 'custom' }), expect.anything());
  });

  it('outra instancia ja disparou (UPDATE afetou 0 linhas): nao conta nem emite de novo', async () => {
    const { run } = monitor({ won: 0 });
    await expect(run()).resolves.toMatchObject({ triggered: 0 });
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('sem o claim do ativo (outra instancia buscou ha pouco): nao busca candles', async () => {
    const { run, fetchCrypto } = monitor({ claimed: false });
    await expect(run()).resolves.toMatchObject({ symbols: 0, checked: 0 });
    expect(fetchCrypto).not.toHaveBeenCalled();
  });

  it('conta travada: nao busca, nao dispara e empurra o watchFrom (volta sem disparar pelo passado)', async () => {
    const { run, calls, fetchCrypto } = monitor({ paused: ['u1'] });
    await expect(run()).resolves.toMatchObject({ paused: 1, triggered: 0 });
    expect(fetchCrypto).not.toHaveBeenCalled();
    const push = calls.find((c) => c.text.includes('SET "watchFrom"'));
    expect(push?.values).toEqual(expect.arrayContaining([NOW, 'u1']));
  });

  it('ativo sem fonte de preco e ignorado; sem candles nada dispara', async () => {
    const synthetic = monitor({ rows: [alertRow({ priceSymbol: 'R_75' })] });
    await expect(synthetic.run()).resolves.toMatchObject({ symbols: 0 });
    expect(synthetic.fetchCrypto).not.toHaveBeenCalled();
    const empty = monitor({ candles: null });
    await expect(empty.run()).resolves.toMatchObject({ symbols: 1, triggered: 0 });
    expect(empty.log).toHaveBeenCalledWith('warn', '[alerts] Sem candles symbol=BTCUSDT');
  });

  it('teto de forex por volta (cota por minuto do Twelve Data), o checado ha mais tempo primeiro', async () => {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD'];
    const rows = symbols.map((s, i) => alertRow({ id: `alert-${i}`, priceSymbol: s }));
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => rows],
      ['SELECT "symbol", "claimedAt", "lastCandleAt" FROM', () => [{ symbol: 'EURUSD', claimedAt: new Date(T) }]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', (_t, values) => [{ symbol: values[0] }]],
    ]);
    const fetchFxLatest = jest.fn(async () => [bar(0, 1, 1)]);
    const counts = await runAlertMonitor({ prisma, now: () => NOW, fetchCrypto: jest.fn(), fetchFxLatest, isPaused: async () => false, log: jest.fn() });
    expect(counts.symbols).toBe(ALERT_RULES.maxFxSymbolsPerRun);
    expect(fetchFxLatest).toHaveBeenCalledTimes(ALERT_RULES.maxFxSymbolsPerRun);
    // EURUSD foi checado nesta janela: fica para a proxima volta.
    expect(fetchFxLatest.mock.calls.map((c: unknown[]) => c[0])).not.toContain('EURUSD');
  });

  it('forex/metal: candles do cache compartilhado (so os que abriram depois), e cota do Twelve Data adia sem erro', async () => {
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => [alertRow({ priceSymbol: 'XAUUSD', level: 4010 })]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'XAUUSD' }]],
      ['SET "status" = \'triggered\'', () => 1],
    ]);
    const fetchFxLatest = jest.fn(async () => [[T - M5, 4000, 4020, 3990, 4000], [T + M5, 4000, 4011, 3999, 4005]] as Candle[]);
    const log = jest.fn();
    const base = { prisma, now: () => NOW, fetchCrypto: jest.fn(), fetchFxLatest, isPaused: async () => false, log };
    await expect(runAlertMonitor(base)).resolves.toMatchObject({ symbols: 1, triggered: 1 });
    expect(fetchFxLatest).toHaveBeenCalledWith('XAUUSD', 'monitor', expect.any(Number));
    expect(base.fetchCrypto).not.toHaveBeenCalled();

    const denied = jest.fn(async () => {
      throw new TwelveDataUnavailableError('budget');
    });
    const quiet = jest.fn();
    await expect(runAlertMonitor({ ...base, fetchFxLatest: denied, log: quiet })).resolves.toMatchObject({ triggered: 0 });
    expect(quiet).toHaveBeenCalledWith('log', '[alerts] symbol=XAUUSD adiado: cota do Twelve Data (budget)');
    expect(quiet).not.toHaveBeenCalledWith('warn', expect.anything());
  });

  it('cripto: pede so o que falta desde a ultima vela, em 1 pedido por ativo', async () => {
    const seen = new Date(NOW.getTime() - 2 * 60_000);
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => [alertRow(), alertRow({ id: 'alert-2', level: 120 })]],
      ['SELECT "symbol", "claimedAt", "lastCandleAt" FROM', () => [{ symbol: 'BTCUSDT', claimedAt: seen, lastCandleAt: seen }]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'BTCUSDT' }]],
    ]);
    const fetchCrypto = jest.fn(async (): Promise<Candle[]> => [[NOW.getTime() - 60_000, 100, 101, 99, 100]]);
    await runAlertMonitor({ prisma, now: () => NOW, fetchCrypto, isPaused: async () => false, log: jest.fn() });
    expect(fetchCrypto).toHaveBeenCalledTimes(1);
    expect(fetchCrypto).toHaveBeenCalledWith('BTCUSDT', seen.getTime() - 60_000, NOW.getTime());
  });

  it('vela de 1m que abriu antes do watchFrom nao dispara', async () => {
    const watchFrom = new Date(NOW.getTime() - 30_000);
    const { run } = monitor({ rows: [alertRow({ watchFrom })], candles: [[NOW.getTime() - 60_000, 100, 200, 99, 100]] });
    await expect(run()).resolves.toMatchObject({ checked: 1, triggered: 0 });
  });

  it('claim do ativo vence 10 s antes da volta seguinte de 1 min', async () => {
    const { run, calls } = monitor({});
    await run();
    const claim = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."AlertPriceCheck"'));
    expect(claim?.values).toEqual(expect.arrayContaining([new Date(NOW.getTime() - 50_000)]));
  });

  it('grava o intervalo em vigor do ativo', async () => {
    const { run, calls } = monitor({});
    await run();
    const update = calls.find((c) => c.text.includes('"intervalMs" ='));
    expect(update?.values).toEqual(expect.arrayContaining([ALERT_RULES.monitorIntervalMs]));
  });

  it('ouro vai antes dos outros forex, mesmo checado ha pouco', async () => {
    const rows = ['EURUSD', 'XAUUSD'].map((priceSymbol, i) => alertRow({ id: `a-${i}`, priceSymbol }));
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => rows],
      ['SELECT "symbol", "claimedAt", "lastCandleAt" FROM', () => [{ symbol: 'XAUUSD', claimedAt: new Date(NOW.getTime() - 3_600_000), lastCandleAt: null }]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', (_t, values) => [{ symbol: values[0] }]],
    ]);
    const fetchFxLatest = jest.fn(async () => [bar(0, 1, 1)]);
    await runAlertMonitor({ prisma, now: () => NOW, fetchCrypto: jest.fn(), fetchFxLatest, isPaused: async () => false, log: jest.fn() });
    expect(fetchFxLatest.mock.calls.map((c: unknown[]) => c[0])).toEqual(['XAUUSD', 'EURUSD']);
  });

  it('minuto cheio no Twelve Data solta o claim; falta de orcamento nao', async () => {
    const route = (): Array<[string, (text: string, values: unknown[]) => unknown]> => [
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => [alertRow({ priceSymbol: 'XAUUSD' })]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'XAUUSD' }]],
    ];
    const deniedWith = async (reason: 'rate_limited' | 'budget') => {
      const { prisma, calls } = makePrisma(route());
      const fetchFxLatest = jest.fn(async () => { throw new TwelveDataUnavailableError(reason); });
      await runAlertMonitor({ prisma, now: () => NOW, fetchCrypto: jest.fn(), fetchFxLatest, isPaused: async () => false, log: jest.fn() });
      return calls.some((c) => c.text.includes('SET "claimedAt" = NULL'));
    };
    await expect(deniedWith('rate_limited')).resolves.toBe(true);
    await expect(deniedWith('budget')).resolves.toBe(false);
  });

  it('com pauseCache, a trava da conta so e refeita depois de 5 min', async () => {
    const { prisma } = makePrisma([['WHERE a."status" = \'active\'\n    ORDER BY', () => [alertRow()]]]);
    const isPaused = jest.fn(async () => false);
    const pauseCache = new Map();
    const at = (ms: number) => runAlertMonitor({ prisma, now: () => new Date(T + ms), fetchCrypto: jest.fn(async () => null), isPaused, pauseCache, log: jest.fn() });
    await at(0);
    await at(4 * 60_000);
    expect(isPaused).toHaveBeenCalledTimes(1);
    await at(5 * 60_000);
    expect(isPaused).toHaveBeenCalledTimes(2);
  });

  it('sem alerta ativo nao faz nada', async () => {
    const { run, fetchCrypto, calls } = monitor({ rows: [] });
    await expect(run()).resolves.toEqual({ symbols: 0, checked: 0, triggered: 0, paused: 0 });
    expect(fetchCrypto).not.toHaveBeenCalled();
    // o alerta ativo e a conferencia pendente (rompimento): nada mais
    expect(calls.filter((c) => c.kind === 'query')).toHaveLength(2);
  });
});

describe('runAlertMonitor: aviso de proximidade', () => {
  const NOW = new Date(T + 30 * 60 * 1000);
  const row = (extra: Record<string, unknown> = {}) => ({
    id: 'alert-1', userId: 'u1', setupId: SETUP.id, priceSymbol: 'BTCUSDT', level: 110, label: 'tp1', side: 'above',
    createdAt: new Date(T), watchFrom: new Date(T), clerkUserId: 'clerk_1', ...extra,
  });
  // Ultimo fechamento = 108: a 2 do nivel (110).
  const candles = [bar(0, 105, 100), bar(1, 108, 100)];

  function run(rows: unknown[], marked = 1) {
    const { prisma, calls } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => rows],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'BTCUSDT' }]],
      ['SET "nearAt"', () => marked],
    ]);
    const go = () => runAlertMonitor({ prisma, now: () => NOW, fetchCrypto: jest.fn(async () => candles), isPaused: async () => false, log: jest.fn() });
    return { go, calls };
  }
  const select = (calls: Array<{ text: string; values: unknown[] }>) => calls.find((c) => c.text.includes('ORDER BY a."priceSymbol"'))!;
  const nearUpdate = (calls: Array<{ text: string; values: unknown[] }>) => calls.find((c) => c.text.includes('SET "nearAt"'));

  it('marca near por UPDATE condicional e emite setup_alert_near uma vez', async () => {
    const { go, calls } = run([row({ atr: 5, nearAt: null })]);
    await expect(go()).resolves.toMatchObject({ checked: 1, triggered: 0 });
    expect(select(calls).text).toContain('atr14');
    const update = nearUpdate(calls);
    expect(update?.text).toContain('"status" = \'active\' AND "nearAt" IS NULL');
    expect(update?.values).toEqual(expect.arrayContaining([NOW, 'alert-1']));
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_near', {
      alertId: 'alert-1', setupId: SETUP.id, label: 'tp1', symbol_class: 'crypto',
    }, { dedupeKey: 'setup_alert_near:alert-1' });
  });

  it('outra instancia ja marcou (UPDATE em 0 linhas): nao emite de novo', async () => {
    const { go } = run([row({ atr: 5, nearAt: null })], 0);
    await go();
    expect(captureServer).not.toHaveBeenCalled();
  });

  it.each([
    ['sem ATR', { atr: null, nearAt: null }],
    ['ATR zero', { atr: 0, nearAt: null }],
    ['longe (3 > 0,5 x 5)', { atr: 1, nearAt: null }],
    ['ja marcado', { atr: 5, nearAt: new Date(T) }],
  ])('%s: nao marca', async (_name, extra) => {
    const { go, calls } = run([row(extra)]);
    await go();
    expect(nearUpdate(calls)).toBeUndefined();
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('a regra mora em ALERT_RULES e o view so mostra near com o alerta ativo', async () => {
    expect(ALERT_RULES.nearAtr).toBe(0.5);
    const active = { id: 'a1', userId: 'u', setupId: SETUP.id, analysisId: 'x', symbol: 'BTCUSDT', priceSymbol: 'BTCUSDT', level: 110, label: 'tp1', side: 'above', status: 'active', createdAt: new Date(T), triggeredAt: null, triggerPrice: null, seenAt: null, nearAt: new Date(T), timeframe: '15m' };
    const { prisma } = makePrisma([['FROM "tickrify"."SetupAlert" a', () => [active, { ...active, id: 'a2', status: 'triggered' }]]]);
    const service = new SetupAlertsService(prisma, {} as never);
    await service.onModuleInit();
    expect((await service.list('u')).items.map((a) => a.near)).toEqual([true, false]);
  });
});

describe('createAlertTick', () => {
  const counts = (triggered: number) => ({ symbols: 1, checked: 1, triggered, paused: 0 });
  const tick = (triggered: number[]) => {
    let t = 1_000_000;
    let i = 0;
    const emails = jest.fn(async () => ({ due: 0, sent: 0 }));
    const log = jest.fn();
    const run = createAlertTick({ monitor: async () => counts(triggered[i++] ?? 0), emails, log, now: () => t });
    return { run, emails, log, advance: (ms: number) => { t += ms; } };
  };

  it('o e-mail sai na mesma volta que dispara', async () => {
    const { run, emails, advance } = tick([0, 1]);
    await run();
    expect(emails).toHaveBeenCalledTimes(1);
    advance(60_000);
    await run();
    expect(emails).toHaveBeenCalledTimes(2);
  });

  it('sem disparo, so tenta de novo a cada 10 min', async () => {
    const { run, emails, advance } = tick([0, 0, 0]);
    await run();
    advance(9 * 60_000);
    await run();
    expect(emails).toHaveBeenCalledTimes(1);
    advance(60_000);
    await run();
    expect(emails).toHaveBeenCalledTimes(2);
  });

  it('volta lenta nao se sobrepoe a seguinte', async () => {
    let release = () => undefined as void;
    const monitor = jest.fn(() => new Promise<ReturnType<typeof counts>>((resolve) => { release = () => resolve(counts(0)); }));
    const run = createAlertTick({ monitor, emails: async () => ({ due: 0, sent: 0 }), log: jest.fn() });
    const first = run();
    await run();
    expect(monitor).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('monitor falhou: nao derruba o e-mail nem a volta', async () => {
    const emails = jest.fn(async () => ({ due: 0, sent: 0 }));
    const log = jest.fn();
    const run = createAlertTick({ monitor: async () => { throw new Error('boom'); }, emails, log });
    await expect(run()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('warn', '[alerts] Varredura falhou: boom');
    expect(emails).toHaveBeenCalledTimes(1);
  });
});

describe('SetupAlertsService.watching', () => {
  const plan = { direction: 'short', triggerType: 'zone_reaction', zoneLow: 77800, zoneHigh: 78000, invalidation: 78400, target1: 76900, target2: null, validForCandles: 12, trigger: 'x' };
  const result = (symbol = 'BTCUSDT') => ({ signalState: 'WATCH', watchPlan: plan, analysis: { symbol, timeframe: '15m' } });
  const ago = (ms: number) => new Date(Date.now() - ms);
  const MIN = 60_000;

  async function serviceWith(opts: { rows: unknown[]; tracks?: unknown[]; checks?: unknown[]; alerts?: unknown[]; next?: unknown[] }) {
    const { prisma, calls } = makePrisma([
      ['DISTINCT ON (w."id")', () => opts.next ?? []],
      ['"result"->>\'signalState\' = \'WATCH\'', () => opts.rows],
      ['LEFT JOIN "tickrify"."AnalysisTrack"', () => opts.tracks ?? []],
      ['FROM "tickrify"."AlertPriceCheck"', () => opts.checks ?? []],
      ['"analysisId" IN', () => opts.alerts ?? []],
    ]);
    const service = new SetupAlertsService(prisma, {} as never);
    await service.onModuleInit();
    return { service, calls };
  }
  const row = (id: string, createdAt: Date, symbol?: string) => ({ id, recommendation: 'WAIT', result: result(symbol), createdAt });
  const context = (analysisId: string, track: Record<string, unknown> = {}) => ({ analysisId, groundingInterval: '15m', setupId: 'setup-1', status: null, outcome: null, touched: false, ...track });

  it('WATCH valendo: nivel, ultimo preco, frequencia real e estado do alerta', async () => {
    const { service } = await serviceWith({
      rows: [row('w1', ago(10 * MIN))],
      tracks: [context('w1')],
      checks: [{ symbol: 'BTCUSDT', lastPrice: 77000, checkedAt: ago(MIN), intervalMs: 60_000 }],
      alerts: [{ id: 'al1', analysisId: 'w1', level: 77800, status: 'active', triggeredAt: null, seenAt: null }],
    });
    const { items } = await service.watching('u1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ analysisId: 'w1', symbol: 'BTCUSDT', timeframe: '15m', lastPrice: 77000, checkIntervalMs: 60_000, alert: { id: 'al1', status: 'active' } });
    expect(items[0].watch).toMatchObject({ level: 77800, invalidation: 78400, outcome: 'pending', afterReach: null });
  });

  it('preco velho nao vira distancia atual', async () => {
    const { service } = await serviceWith({
      rows: [row('w1', ago(10 * MIN))],
      tracks: [context('w1')],
      checks: [{ symbol: 'BTCUSDT', lastPrice: 77000, checkedAt: ago(3 * 60 * MIN), intervalMs: 60_000 }],
    });
    expect((await service.watching('u1')).items[0]).toMatchObject({ lastPrice: null, checkedAt: null, alert: null });
  });

  it('encerrado mostra o que o preco fez, pelo rastreador', async () => {
    const { service } = await serviceWith({
      rows: [row('w1', ago(3 * 24 * 60 * MIN))],
      tracks: [context('w1', { status: 'tracked', outcome: 'WIN', touched: true })],
    });
    expect((await service.watching('u1')).items[0].watch).toMatchObject({ outcome: 'reached', afterReach: 'target' });
  });

  it('encerrado ha mais de 7 dias sai da secao', async () => {
    const { service } = await serviceWith({ rows: [row('w1', ago(9 * 24 * 60 * MIN))], tracks: [context('w1')] });
    expect((await service.watching('u1')).items).toEqual([]);
  });

  it('disparado e nao visto vem primeiro; depois os valendo, o que vence antes na frente', async () => {
    const { service } = await serviceWith({
      rows: [row('late', ago(MIN)), row('soon', ago(120 * MIN)), row('hit', ago(30 * MIN))],
      tracks: [context('late'), context('soon'), context('hit')],
      alerts: [{ id: 'a', analysisId: 'hit', level: 77800, status: 'triggered', triggeredAt: ago(MIN), seenAt: null }],
    });
    expect((await service.watching('u1')).items.map((i) => i.analysisId)).toEqual(['hit', 'soon', 'late']);
  });

  it('alerta em outro nivel da mesma analise nao e o alerta do WATCH', async () => {
    const { service } = await serviceWith({
      rows: [row('w1', ago(MIN))],
      tracks: [context('w1')],
      alerts: [{ id: 'other', analysisId: 'w1', level: 70000, status: 'active', triggeredAt: null, seenAt: null }],
    });
    expect((await service.watching('u1')).items[0].alert).toBeNull();
  });

  it('jornada: disparado, reanalisado e entrou pela marcacao do trader', async () => {
    const { service } = await serviceWith({
      rows: [row('w1', ago(60 * MIN))],
      tracks: [context('w1')],
      alerts: [{ id: 'a', analysisId: 'w1', level: 77800, status: 'triggered', triggeredAt: ago(30 * MIN), seenAt: ago(20 * MIN) }],
      next: [{ watchId: 'w1', analysisId: 'n1', createdAt: ago(10 * MIN), signalState: 'ENTER_NOW', recommendation: 'SELL', userVerdict: 'open' }],
    });
    expect((await service.watching('u1')).items[0].journey).toEqual({
      priceReached: true,
      recheck: { analysisId: 'n1', createdAt: expect.any(Date), signalState: 'ENTER_NOW' },
      entered: { analysisId: 'n1' },
      end: 'entered',
    });
  });

  it('jornada sem reanalise: so vigiando', async () => {
    const { service } = await serviceWith({ rows: [row('w1', ago(MIN))], tracks: [context('w1')] });
    expect((await service.watching('u1')).items[0].journey).toEqual({ priceReached: false, recheck: null, entered: null, end: null });
  });

  it('nao busca preco para a tela e sem WATCH nao consulta mais nada', async () => {
    fetchCrypto1m.mockClear();
    const { service, calls } = await serviceWith({ rows: [] });
    await expect(service.watching('u1')).resolves.toEqual({ items: [] });
    expect(calls.filter((c) => !c.text.includes('information_schema'))).toHaveLength(1);
    expect(fetchCrypto1m).not.toHaveBeenCalled();
  });
});

describe('createWatchAlert: todo WATCH vira alerta', () => {
  const NOW = new Date('2026-10-27T12:30:00Z');
  const WATCH = {
    signalState: 'WATCH',
    dataMode: 'real_data',
    watchPlan: WATCH_BTC.result.watchPlan,
    analysis: { symbol: 'BTCUSDT', timeframe: '15m', currentPrice: 77200 },
  };
  const INPUT = { analysisId: 'analysis00002', userId: 'u1', result: WATCH, recommendation: 'WAIT' };
  const SETUP_ROW = { id: 'setup-auto00001', userId: 'u1', status: 'tracking', symbol: 'BTCUSDT', timeframe: '15m', rootAnalysisId: 'analysis00002', createdAt: NOW, lastAnalysisAt: NOW };

  type Options = {
    analysis?: Record<string, unknown> | null;
    unsubscribed?: boolean;
    used?: number;
    subscriber?: boolean;
    setupsWithAlerts?: number;
    activeOnSetup?: number;
    handled?: boolean;
    existingSetup?: Record<string, unknown>;
    trackedTotal?: number;
  };

  function fake(opts: Options = {}) {
    let inserted = false;
    const { prisma, calls } = makePrisma(
      [
        ['SELECT "lastPrice", "checkedAt" FROM', () => []],
        ['a."groundingStats"', () => (opts.analysis === null ? [] : [{ id: INPUT.analysisId, setupId: null, createdAt: new Date(), groundingInterval: '15m', clerkUserId: 'clerk_1', ...opts.analysis }])],
        ['COUNT(DISTINCT "setupId")', () => [{ n: opts.setupsWithAlerts ?? 0 }]],
        ['COUNT(*)::int AS "n" FROM "tickrify"."SetupAlert"', () => [{ n: opts.activeOnSetup ?? 0 }]],
        ['COUNT(*)::int AS "n" FROM "tickrify"."TrackedSetup"', () => [{ n: opts.trackedTotal ?? 0 }]],
        ['SELECT EXISTS (SELECT 1 FROM "tickrify"."Subscription"', () => [{ ok: Boolean(opts.subscriber) }]],
        ['AS "ok"', () => [{ ok: false }]],
        ['SELECT "id" FROM "tickrify"."SetupAlert" WHERE "analysisId"', () => (opts.handled ? [{ id: 'alert-old000001' }] : [])],
        ['INSERT INTO "tickrify"."TrackedSetup"', () => { inserted = true; return 1; }],
        ['"rootAnalysisId" =', () => (opts.existingSetup ? [opts.existingSetup] : [])],
        ['FROM "tickrify"."TrackedSetup"', () => (inserted ? [SETUP_ROW] : opts.existingSetup ? [opts.existingSetup] : [])],
        ['WHERE a."id" =', (_text, values) => [{ id: values[0], setupId: SETUP_ROW.id, analysisId: INPUT.analysisId, symbol: 'BTCUSDT', level: 77800, label: 'entry', side: 'above', status: 'active', createdAt: NOW }]],
      ],
      {
        adminAudit: { findFirst: jest.fn(async () => (opts.unsubscribed ? { id: 'audit' } : null)) },
        analysis: { count: jest.fn(async () => opts.used ?? 0) },
        subscription: { findFirst: jest.fn(async () => null) },
      },
    );
    const texts = () => calls.map((c) => c.text);
    return {
      prisma,
      calls,
      alertInsert: () => calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"')),
      setupInsert: () => texts().find((t) => t.includes('INSERT INTO "tickrify"."TrackedSetup"')),
    };
  }

  it('WATCH com velas reais grava o setup seguido e o alerta entry no nivel do plano, e avisa o PostHog com auto', async () => {
    const f = fake();
    await expect(createWatchAlert(f.prisma, INPUT)).resolves.toBe('created');
    expect(f.setupInsert()).toBeDefined();
    expect(f.alertInsert()?.values).toEqual(expect.arrayContaining(['u1', SETUP_ROW.id, 'analysis00002', 'BTCUSDT', 'BTCUSDT', 77800, 'entry', 'above', 77200, true]));
    // Validade = hora da analise + 12 velas de 15m.
    const expiresAt = f.alertInsert()?.values.find((v) => v instanceof Date) as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 2.9 * 3600_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3 * 3600_000);
    const locks = f.calls.filter((c) => c.text.includes('pg_advisory_xact_lock'));
    expect(locks.map((c) => c.values[0])).toEqual(['alerts:u1', 'setups:u1']);
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_created', expect.objectContaining({
      label: 'entry', prefilled: true, auto: true, symbol_class: 'crypto', is_subscriber: false,
    }));
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('o lado sai do preco de agora, como no alerta manual', async () => {
    fetchCrypto1m.mockResolvedValue([[T, 77900, 78000, 77850, 77900]]);
    const f = fake();
    await createWatchAlert(f.prisma, INPUT);
    expect(f.alertInsert()?.values).toEqual(expect.arrayContaining([77800, 'entry', 'below', 77900]));
  });

  it('analise que ja e versao de um setup seguido entra no mesmo setup, sem criar outro', async () => {
    const f = fake({ analysis: { setupId: SETUP_ROW.id }, existingSetup: SETUP_ROW });
    await expect(createWatchAlert(f.prisma, INPUT)).resolves.toBe('created');
    expect(f.setupInsert()).toBeUndefined();
    expect(f.alertInsert()?.values).toEqual(expect.arrayContaining([SETUP_ROW.id, 77800]));
  });

  it('assinante usa o teto de assinante', async () => {
    const f = fake({ subscriber: true, setupsWithAlerts: 2 });
    await expect(createWatchAlert(f.prisma, INPUT)).resolves.toBe('created');
    expect(captureServer.mock.calls[0][2]).toMatchObject({ is_subscriber: true, trial_day: null });
  });

  it.each([
    ['teto de setups com alerta', { setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.free }, 'limit'],
    ['teto de alertas no setup', { analysis: { setupId: SETUP_ROW.id }, existingSetup: SETUP_ROW, activeOnSetup: ALERT_RULES.maxActivePerSetup }, 'limit'],
    ['teto de setups seguidos', { trackedTotal: 20 }, 'limit'],
    ['descadastrado', { unsubscribed: true }, 'unsubscribed'],
    ['gratis esgotado', { used: 50 }, 'free_locked'],
    ['ja tratado (alerta desta analise cancelado pela pessoa)', { handled: true }, 'already_handled'],
    ['setup largado pela pessoa', { analysis: { setupId: SETUP_ROW.id }, existingSetup: { ...SETUP_ROW, status: 'untracked' } }, 'already_handled'],
    ['analise nao concluida', { analysis: null }, 'analysis_missing'],
  ] as Array<[string, Options, string]>)('%s: nao cria e nao lanca', async (_name, opts, outcome) => {
    const f = fake(opts);
    await expect(createWatchAlert(f.prisma, INPUT)).resolves.toBe(outcome);
    expect(f.alertInsert()).toBeUndefined();
    expect(captureServer).not.toHaveBeenCalled();
  });

  it.each([
    ['fora do WATCH', { ...INPUT, result: BUY_GOLD.result, recommendation: 'BUY' }, 'not_watch'],
    ['WATCH sem plano (analise antiga)', { ...INPUT, result: { ...WATCH, watchPlan: undefined } }, 'not_watch'],
    ['niveis estimados do print', { ...INPUT, result: { ...WATCH, dataMode: 'print' } }, 'print_mode'],
    ['ativo sem fonte de preco', { ...INPUT, result: { ...WATCH, analysis: { ...WATCH.analysis, symbol: 'Volatility 75 Index' } } }, 'no_price_source'],
  ])('%s: nem consulta o banco', async (_name, input, outcome) => {
    const f = fake();
    await expect(createWatchAlert(f.prisma, input)).resolves.toBe(outcome);
    expect(f.calls).toHaveLength(0);
  });

  it('so o nivel do plano do modelo: niveis guardados pelo codigo nao mudam o alerta', async () => {
    const f = fake();
    const result = { ...WATCH, analysis: { ...WATCH.analysis, entry: 70000, stopLoss: 69000, takeProfit1: 72000 } };
    await expect(createWatchAlert(f.prisma, { ...INPUT, result })).resolves.toBe('created');
    expect(f.alertInsert()?.values).toEqual(expect.arrayContaining([77800, 'entry']));
    expect(f.alertInsert()?.values).not.toContain(70000);
  });

  const MAP = { price: 77200, atr: 100, above: { level: 78100, atr: 9, next: null, nextAtr: null }, below: null };

  it('NO_TRADE recusado por risco: o nivel da IA recebe o alerta automatico, nunca os extremos do mapa', async () => {
    const f = fake();
    const aiLevel = { price: 77800, direction: 'short', invalidation: 78400, validForCandles: 12, reason: 'no_valid_geometry' };
    const result = { ...WATCH, signalState: 'NO_TRADE', watchPlan: null, aiLevel, levelMap: MAP };
    await expect(createWatchAlert(f.prisma, { ...INPUT, result })).resolves.toBe('created');
    expect(f.alertInsert()?.values).toEqual(expect.arrayContaining([77800, 'entry']));
    expect(f.alertInsert()?.values).not.toContain(78100);
  });

  it('NO_TRADE so com o mapa de niveis, ou nivel da IA de analise antiga: nenhum alerta automatico', async () => {
    for (const extra of [{}, { aiLevel: { price: 77800 } }]) {
      const f = fake();
      await expect(createWatchAlert(f.prisma, { ...INPUT, result: { ...WATCH, signalState: 'NO_TRADE', watchPlan: null, levelMap: MAP, ...extra } })).resolves.toBe('not_watch');
      expect(f.calls).toHaveLength(0);
    }
  });

  it('janela do WATCH ja fechada: nao ha nivel para vigiar', async () => {
    const f = fake({ analysis: { createdAt: new Date(Date.now() - 24 * 3600_000) } });
    await expect(createWatchAlert(f.prisma, INPUT)).resolves.toBe('no_level');
    expect(f.alertInsert()).toBeUndefined();
  });

  it.each([
    ['preco no proprio nivel', 77800],
    ['nivel longe demais do preco', 30000],
  ])('%s: nao cria', async (_name, currentPrice) => {
    const f = fake();
    await expect(createWatchAlert(f.prisma, { ...INPUT, result: { ...WATCH, analysis: { ...WATCH.analysis, currentPrice } } })).resolves.toBe('level_rejected');
    expect(f.alertInsert()).toBeUndefined();
  });

  it('banco fora do ar: a analise segue, so fica no log', async () => {
    const f = fake();
    f.prisma.$queryRaw = jest.fn(async () => {
      throw new Error('db down');
    });
    const log = jest.fn();
    await expect(createWatchAlert(f.prisma, INPUT, log)).resolves.toBe('error');
    expect(log.mock.calls.flat().join(' ')).toContain('db down');
  });
});

describe('createEntryAlerts: TP1 e stop do Enter now', () => {
  const ENTER = {
    signalState: 'ENTER_NOW',
    dataMode: 'real_data',
    analysis: { symbol: 'BTCUSDT', timeframe: '15m', currentPrice: 77200, entry: 77200, stopLoss: 76800, takeProfit1: 78000 },
  };
  const INPUT = { analysisId: 'analysis00003', userId: 'u1', result: ENTER, recommendation: 'BUY' };
  const SETUP_ROW = { id: 'setup-entry0001', userId: 'u1', status: 'tracking', symbol: 'BTCUSDT', timeframe: '15m', rootAnalysisId: 'analysis00003', createdAt: new Date(), lastAnalysisAt: new Date() };

  function fake(opts: { handled?: boolean; setupsWithAlerts?: number; activeOnSetup?: number } = {}) {
    let inserted = false;
    let active = opts.activeOnSetup ?? 0;
    const { prisma, calls } = makePrisma(
      [
        ['SELECT "lastPrice", "checkedAt" FROM', () => []],
        ['a."groundingStats"', () => [{ id: INPUT.analysisId, setupId: null, createdAt: new Date(), groundingInterval: '15m', clerkUserId: 'clerk_1' }]],
        ['COUNT(DISTINCT "setupId")', () => [{ n: opts.setupsWithAlerts ?? 0 }]],
        ['COUNT(*)::int AS "n" FROM "tickrify"."SetupAlert"', () => [{ n: active }]],
        ['COUNT(*)::int AS "n" FROM "tickrify"."TrackedSetup"', () => [{ n: 0 }]],
        ['SELECT EXISTS (SELECT 1 FROM "tickrify"."Subscription"', () => [{ ok: false }]],
        ['AS "ok"', () => [{ ok: false }]],
        ['SELECT "label" FROM "tickrify"."SetupAlert"', () => (opts.handled ? [{ label: 'tp1' }] : [])],
        ['INSERT INTO "tickrify"."TrackedSetup"', () => { inserted = true; return 1; }],
        ['INSERT INTO "tickrify"."SetupAlert"', () => { active += 1; return 1; }],
        ['"rootAnalysisId" =', () => []],
        ['FROM "tickrify"."TrackedSetup"', () => (inserted ? [SETUP_ROW] : [])],
        ['WHERE a."id" =', (_text, values) => [{ id: values[0], setupId: SETUP_ROW.id, analysisId: INPUT.analysisId, symbol: 'BTCUSDT', level: 78000, label: 'tp1', side: 'above', status: 'active', createdAt: new Date() }]],
      ],
      {
        adminAudit: { findFirst: jest.fn(async () => null) },
        analysis: { count: jest.fn(async () => 0) },
        subscription: { findFirst: jest.fn(async () => null) },
      },
    );
    return { prisma, calls, inserts: () => calls.filter((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"')) };
  }

  describe('alertas automaticos', () => {
    it('segue o setup e cria tp1 e stop na mesma transacao, com validade de 48h, e avisa o PostHog com auto', async () => {
      const f = fake();
      const log = jest.fn();
      await expect(createEntryAlerts(f.prisma, INPUT, log)).resolves.toBe('created');
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      const [tp1, stop] = f.inserts();
      expect(tp1.values).toEqual(expect.arrayContaining(['u1', SETUP_ROW.id, 'analysis00003', 78000, 'tp1', 'above', 77200]));
      expect(stop.values).toEqual(expect.arrayContaining([76800, 'stop', 'below']));
      const expiresAt = tp1.values.find((v) => v instanceof Date) as Date;
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 47.9 * 3600_000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 48 * 3600_000);
      expect(captureServer.mock.calls.map((c) => [c[1], c[2].label, c[2].prefilled, c[2].auto])).toEqual([
        ['setup_alert_created', 'tp1', true, true],
        ['setup_alert_created', 'stop', true, true],
      ]);
      expect(captureServer.mock.calls.some((c) => c[1] === 'setup_followed')).toBe(false);
      expect(log).toHaveBeenCalledWith('[alerts] entry-auto analysis=analysis00003 outcome=created');
    });

    it('idempotente: analise que ja tem alerta de tp1 ou stop nao recria', async () => {
      const f = fake({ handled: true });
      await expect(createEntryAlerts(f.prisma, INPUT)).resolves.toBe('already_handled');
      expect(f.inserts()).toHaveLength(0);
      expect(captureServer).not.toHaveBeenCalled();
    });

    it.each([
      ['teto de setups com alerta', { setupsWithAlerts: ALERT_RULES.maxSetupsWithAlerts.free }],
      ['teto de alertas no setup (so cabe 1 vaga)', { activeOnSetup: ALERT_RULES.maxActivePerSetup - 1 }],
    ])('%s: nao cria e nao lanca', async (_name, opts) => {
      const f = fake(opts);
      await expect(createEntryAlerts(f.prisma, INPUT)).resolves.toBe('limit');
      expect(captureServer).not.toHaveBeenCalled();
    });

    it.each([
      ['fora do Enter now', { ...INPUT, result: { ...ENTER, signalState: 'WATCH' } }, 'not_enter_now'],
      ['niveis estimados do print', { ...INPUT, result: { ...ENTER, dataMode: 'print' } }, 'print_mode'],
      ['ativo sem fonte de preco', { ...INPUT, result: { ...ENTER, analysis: { ...ENTER.analysis, symbol: 'Volatility 75 Index' } } }, 'no_price_source'],
      ['sem TP1', { ...INPUT, result: { ...ENTER, analysis: { ...ENTER.analysis, takeProfit1: null } } }, 'no_level'],
      ['sem stop', { ...INPUT, result: { ...ENTER, analysis: { ...ENTER.analysis, stopLoss: null } } }, 'no_level'],
    ])('%s: nem consulta o banco', async (_name, input, outcome) => {
      const f = fake();
      await expect(createEntryAlerts(f.prisma, input)).resolves.toBe(outcome);
      expect(f.calls).toHaveLength(0);
    });

    it('nivel no proprio preco: recusa e nao cria nenhum dos dois', async () => {
      const f = fake();
      await expect(createEntryAlerts(f.prisma, { ...INPUT, result: { ...ENTER, analysis: { ...ENTER.analysis, takeProfit1: 77200 } } })).resolves.toBe('level_rejected');
      expect(f.inserts()).toHaveLength(0);
    });

    it('banco fora do ar: nunca lanca', async () => {
      const f = fake();
      f.prisma.$queryRaw = jest.fn(async () => {
        throw new Error('db down');
      });
      await expect(createEntryAlerts(f.prisma, INPUT)).resolves.toBe('error');
    });
  });
});

describe('options: alerta automatico na tela do WATCH', () => {
  const active = { id: 'alert-auto00001', userId: 'u', setupId: SETUP.id, analysisId: WATCH_BTC.id, symbol: 'BTCUSDT', level: 77800, label: 'entry', side: 'above', status: 'active', createdAt: new Date(), triggeredAt: null, triggerPrice: null, seenAt: null };
  const WATCH_REAL = { ...WATCH_BTC, result: { ...WATCH_BTC.result, dataMode: 'real_data' } };

  async function options(analysis: unknown, alerts: unknown[], following = true) {
    const made = await ready({ analysis });
    (made.service as any).list = jest.fn(async () => ({ items: alerts, unseen: 0 }));
    made.setups.findForAnalysis.mockResolvedValue({ setup: following ? SETUP : null } as any);
    return made.service.options('u', WATCH_BTC.id, false);
  }

  it('WATCH com alerta entry ativo desta analise devolve watchAlert', async () => {
    const out = await options(WATCH_REAL, [active]);
    expect(out.watchAlert).toMatchObject({ id: 'alert-auto00001', level: 77800 });
    expect(out.autoAlertPending).toBe(false);
  });

  it('alerta cancelado, de outra analise ou fora do WATCH nao vira watchAlert', async () => {
    expect((await options(WATCH_REAL, [{ ...active, status: 'triggered' }])).watchAlert).toBeNull();
    expect((await options(WATCH_REAL, [{ ...active, analysisId: 'analysis00009' }])).watchAlert).toBeNull();
    expect((await options({ ...BUY_GOLD, createdAt: new Date() }, [{ ...active, analysisId: BUY_GOLD.id }])).watchAlert).toBeNull();
  });

  it('WATCH recem-concluido sem alerta gravado: a tela espera; passou a janela, nao espera mais', async () => {
    expect((await options({ ...WATCH_REAL, updatedAt: new Date() }, [], false)).autoAlertPending).toBe(true);
    expect((await options({ ...WATCH_REAL, updatedAt: new Date(Date.now() - ALERT_RULES.watchAutoPendingMs - 1000) }, [], false)).autoAlertPending).toBe(false);
    expect((await options({ ...WATCH_BTC, updatedAt: new Date() }, [], false)).autoAlertPending).toBe(false);
  });
});

describe('Watch que arma sozinho: monitor', () => {
  const H = 60 * 60 * 1000;
  const A0 = T - 2 * H; // analise: 2h antes
  const NOW2 = new Date(T + 30 * 60 * 1000);
  const min = (i: number, o: number, h: number, l: number, c: number): Candle => [T - 2 * H + i * 60_000, o, h, l, c];
  const levels = { entry: 100, stopLoss: 90, takeProfit1: 120, tp1R: 2 };
  const src = (triggerType: string) => ({
    signalState: 'WATCH',
    watchPlan: { direction: 'long', triggerType, zoneLow: 98, zoneHigh: 100, invalidation: 95, target1: 120, target2: null, validForCandles: 12, trigger: 'x' },
    watchLevels: levels,
    analysis: { timeframe: '1h' },
  });
  const row = (triggerType = 'zone_reaction') => ({
    id: 'alert-1', userId: 'u1', setupId: SETUP.id, priceSymbol: 'BTCUSDT', level: 100, label: 'entry', side: 'below',
    createdAt: new Date(A0), watchFrom: new Date(A0), clerkUserId: 'clerk_1', armSource: src(triggerType), analysisAt: new Date(A0), groundingInterval: '1h',
  });
  // 1h inteira por hora (60 velas de 1m): fechamentos dados por hora.
  const hours = (closes: number[]): Candle[] =>
    closes.flatMap((close, h) => Array.from({ length: 60 }, (_, i) => [A0 + h * H + i * 60_000, close, Math.max(close, 100) + 1, Math.min(close, 100) - 1, close] as Candle));

  function run(r: unknown, candles: Candle[], won = 1) {
    const { prisma, calls } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => [r]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'BTCUSDT' }]],
      ['SET "status" = \'triggered\'', () => won],
    ]);
    const fetchCrypto = jest.fn(async () => candles);
    return runAlertMonitor({ prisma, now: () => NOW2, fetchCrypto, isPaused: async () => false, log: jest.fn() }).then(() => calls);
  }
  const written = (calls: Array<{ text: string; values: unknown[] }>) => {
    const v = calls.find((c) => c.text.includes('SET "status" = \'triggered\''))!.values.find((x) => typeof x === 'string' && x.startsWith('{')) as string | undefined;
    return v ? JSON.parse(v) : null;
  };

  it('armado: nenhuma vela fechou alem da invalidacao', async () => {
    const check = written(await run(row(), hours([110, 105])));
    expect(check).toMatchObject({ status: 'armed', direction: 'long', entry: 100, stop: 90, target: 120 });
  });

  it('invalidado: uma vela do tempo grafico fechou abaixo da invalidacao', async () => {
    const check = written(await run(row(), hours([110, 94])));
    expect(check).toMatchObject({ status: 'invalidated', entry: 100, stop: 95, target: null });
  });

  it('rompimento sem fechamento alem do nivel: fica pendente (nada e avisado)', async () => {
    const check = written(await run(row('breakout_close'), hours([98, 99])));
    expect(check?.status).toBe('pending');
  });

  it('rompimento que fechou alem do nivel: arma', async () => {
    const check = written(await run(row('breakout_close'), hours([98, 103])));
    expect(check?.status).toBe('armed');
  });

  it('alerta sem analise (My assets) ou que nao e entry: sem conferencia', async () => {
    expect(written(await run({ ...row(), setupId: null, armSource: null, analysisAt: null, label: 'custom' }, hours([110, 105])))).toBeNull();
    expect(written(await run({ ...row(), label: 'tp1', armSource: null }, hours([110, 105])))).toBeNull();
  });

  it('cripto: busca as velas de 1m desde a analise sem tocar no Twelve Data', async () => {
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => [row()]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'BTCUSDT' }]],
    ]);
    const fetchCrypto = jest.fn(async () => hours([110, 105]));
    await runAlertMonitor({ prisma, now: () => NOW2, fetchCrypto, isPaused: async () => false, log: jest.fn() });
    expect(fetchCrypto.mock.calls.some((c: unknown[]) => c[1] === A0)).toBe(true);
  });

  it('pendente que depois fechou alem do nivel: grava armed so se ainda pendente', async () => {
    const pend = { ...row('breakout_close'), triggeredAt: new Date(T) };
    const { prisma, calls } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => []],
      [`a."armCheck"->>'status' = 'pending'`, () => [pend]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', () => [{ symbol: 'BTCUSDT' }]],
    ]);
    await runAlertMonitor({ prisma, now: () => NOW2, fetchCrypto: jest.fn(async () => hours([98, 103])), isPaused: async () => false, log: jest.fn() });
    const upd = calls.find((c) => c.kind === 'execute' && c.text.includes(`"armCheck"->>'status' = 'pending'`))!;
    expect(JSON.parse(upd.values[0] as string).status).toBe('armed');
  });
});
