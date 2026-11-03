import { HttpException, ValidationPipe } from '@nestjs/common';
import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import {
  ALERT_RULES,
  SetupAlertsService,
  alertSuggestions,
  findTrigger,
  runAlertMonitor,
  sideFor,
} from './setup-alerts.service';
import { CreateSetupAlertDto, ListSetupAlertsQueryDto } from './dto/setups.dto';
import { SetupsController } from './setups.controller';
import { TwelveDataUnavailableError, __setTwelveDataForTests, fxMarketClosed } from '../market/twelve-data';
import { fetchFxLatest5m as fetchFxLatest5mMock, fetchWindowFor as fetchWindowForMock, priceSymbolOf, type Candle } from '../market/candles';
const fetchWindowFor = fetchWindowForMock as jest.Mock;
const fetchFxLatest5m = fetchFxLatest5mMock as jest.Mock;
import { captureServer as captureServerMock } from '../../common/analytics/posthog';

jest.mock('../market/candles', () => ({
  ...jest.requireActual('../market/candles'),
  // Sem preco de mercado por padrao: a criacao cai no preco da analise.
  fetchWindowFor: jest.fn(async () => null),
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
  fetchWindowFor.mockReset();
  fetchWindowFor.mockResolvedValue(null);
  fetchFxLatest5m.mockReset();
  fetchFxLatest5m.mockResolvedValue(null);
  __setTwelveDataForTests({ now: () => new Date('2026-10-27T12:30:00Z') });
});

describe('regras puras dos alertas', () => {
  it('disparo acima: maxima de um candle depois da criacao toca o nivel', () => {
    const alert = { level: 110, side: 'above' as const, watchFrom: new Date(T + M5) };
    expect(findTrigger(alert, [bar(0, 109, 100), bar(1, 109.9, 101), bar(2, 110, 102)])).toEqual({ at: new Date(T + 2 * M5), price: 110 });
    expect(findTrigger(alert, [bar(1, 109.9, 101)])).toBeNull();
  });

  it('disparo abaixo: minima toca o nivel', () => {
    const alert = { level: 95, side: 'below' as const, watchFrom: new Date(T) };
    expect(findTrigger(alert, [bar(0, 101, 96), bar(1, 100, 94.5)])).toEqual({ at: new Date(T + M5), price: 94.5 });
  });

  it('candle que abriu ANTES do alerta nunca conta, mesmo cruzando o nivel', () => {
    const alert = { level: 110, side: 'above' as const, watchFrom: new Date(T + M5 / 2) };
    expect(findTrigger(alert, [bar(0, 120, 100)])).toBeNull();
    expect(findTrigger(alert, [bar(0, 120, 100), bar(1, 111, 100)])?.at).toEqual(new Date(T + M5));
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
    expect(alertSuggestions(WATCH_BTC.result, 'WAIT')).toEqual([
      { label: 'entry', level: 77800 },
      { label: 'invalidation', level: 78400 },
    ]);
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
  id: 'analysis00002', status: 'completed', recommendation: 'WAIT', setupId: null,
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
    expect(fetchWindowFor).not.toHaveBeenCalled();
  });

  it('cache velho: busca o ultimo candle de 5m de forex pelo cache compartilhado com o grounding', async () => {
    fetchFxLatest5m.mockResolvedValue([[Date.now() - 300_000, 4290, 4295, 4285, 4290]]);
    const { service, calls } = await ready({ cachedPrice: { lastPrice: 4000, checkedAt: new Date(Date.now() - 60 * 60_000) } });
    await service.create(user, { analysisId: 'analysis00001', label: 'custom', level: 4200 }, free);
    expect(fetchFxLatest5m).toHaveBeenCalledWith('XAUUSD', 'monitor', ALERT_RULES.cacheTtlMs.fx);
    expect(fetchWindowFor).not.toHaveBeenCalled();
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
    const fetchWindow = jest.fn(async () => (opts.candles === undefined ? [bar(0, 105, 100), bar(3, 111, 104)] : opts.candles));
    const log = jest.fn();
    const run = () =>
      runAlertMonitor({
        prisma,
        now: () => NOW,
        fetchWindow,
        isPaused: async (userId) => (opts.paused ?? []).includes(userId),
        log,
      });
    return { run, calls, fetchWindow, log };
  }

  it('busca o ativo, grava o ultimo preco e dispara por UPDATE condicional', async () => {
    const { run, calls, fetchWindow } = monitor({});
    await expect(run()).resolves.toEqual({ symbols: 1, checked: 1, triggered: 1, paused: 0 });
    expect(fetchWindow).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), NOW.getTime(), '5m', 1, 'monitor');
    const trigger = calls.find((c) => c.text.includes('SET "status" = \'triggered\''));
    expect(trigger?.text).toContain('AND "status" = \'active\'');
    expect(trigger?.values).toEqual(expect.arrayContaining([new Date(T + 3 * M5), 111, 'alert-1']));
    expect(calls.find((c) => c.text.includes('UPDATE "tickrify"."AlertPriceCheck"'))?.values).toEqual(expect.arrayContaining([NOW, 111]));
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_alert_triggered', {
      alertId: 'alert-1', setupId: SETUP.id, label: 'tp1', symbol_class: 'crypto', minutes_to_trigger: 15,
    }, { dedupeKey: 'setup_alert_triggered:alert-1' });
  });

  it('outra instancia ja disparou (UPDATE afetou 0 linhas): nao conta nem emite de novo', async () => {
    const { run } = monitor({ won: 0 });
    await expect(run()).resolves.toMatchObject({ triggered: 0 });
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('sem o claim do ativo (outra instancia buscou ha pouco): nao busca candles', async () => {
    const { run, fetchWindow } = monitor({ claimed: false });
    await expect(run()).resolves.toMatchObject({ symbols: 0, checked: 0 });
    expect(fetchWindow).not.toHaveBeenCalled();
  });

  it('conta travada: nao busca, nao dispara e empurra o watchFrom (volta sem disparar pelo passado)', async () => {
    const { run, calls, fetchWindow } = monitor({ paused: ['u1'] });
    await expect(run()).resolves.toMatchObject({ paused: 1, triggered: 0 });
    expect(fetchWindow).not.toHaveBeenCalled();
    const push = calls.find((c) => c.text.includes('SET "watchFrom"'));
    expect(push?.values).toEqual(expect.arrayContaining([NOW, 'u1']));
  });

  it('ativo sem fonte de preco e ignorado; sem candles nada dispara', async () => {
    const synthetic = monitor({ rows: [alertRow({ priceSymbol: 'R_75' })] });
    await expect(synthetic.run()).resolves.toMatchObject({ symbols: 0 });
    expect(synthetic.fetchWindow).not.toHaveBeenCalled();
    const empty = monitor({ candles: null });
    await expect(empty.run()).resolves.toMatchObject({ symbols: 1, triggered: 0 });
    expect(empty.log).toHaveBeenCalledWith('warn', '[alerts] Sem candles symbol=BTCUSDT');
  });

  it('teto de forex por volta (cota por minuto do Twelve Data), o checado ha mais tempo primeiro', async () => {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD'];
    const rows = symbols.map((s, i) => alertRow({ id: `alert-${i}`, priceSymbol: s }));
    const { prisma } = makePrisma([
      ['WHERE a."status" = \'active\'\n    ORDER BY', () => rows],
      ['SELECT "symbol", "claimedAt" FROM', () => [{ symbol: 'EURUSD', claimedAt: new Date(T) }]],
      ['INSERT INTO "tickrify"."AlertPriceCheck"', (_t, values) => [{ symbol: values[0] }]],
    ]);
    const fetchFxLatest = jest.fn(async () => [bar(0, 1, 1)]);
    const counts = await runAlertMonitor({ prisma, now: () => NOW, fetchWindow: jest.fn(), fetchFxLatest, isPaused: async () => false, log: jest.fn() });
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
    const base = { prisma, now: () => NOW, fetchWindow: jest.fn(), fetchFxLatest, isPaused: async () => false, log };
    await expect(runAlertMonitor(base)).resolves.toMatchObject({ symbols: 1, triggered: 1 });
    expect(fetchFxLatest).toHaveBeenCalledWith('XAUUSD', 'monitor', ALERT_RULES.cacheTtlMs.fx);
    expect(base.fetchWindow).not.toHaveBeenCalled();

    const denied = jest.fn(async () => {
      throw new TwelveDataUnavailableError('budget');
    });
    const quiet = jest.fn();
    await expect(runAlertMonitor({ ...base, fetchFxLatest: denied, log: quiet })).resolves.toMatchObject({ triggered: 0 });
    expect(quiet).toHaveBeenCalledWith('log', '[alerts] symbol=XAUUSD adiado: cota do Twelve Data (budget)');
    expect(quiet).not.toHaveBeenCalledWith('warn', expect.anything());
  });

  it('sem alerta ativo nao faz nada', async () => {
    const { run, fetchWindow, calls } = monitor({ rows: [] });
    await expect(run()).resolves.toEqual({ symbols: 0, checked: 0, triggered: 0, paused: 0 });
    expect(fetchWindow).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});
