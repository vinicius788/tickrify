import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SetupsService } from './setups.service';
import { ALERT_RULES, SetupAlertsService, createWatchAlert, runAlertMonitor } from './setup-alerts.service';
import { runSetupAlertEmailSweep } from '../mail/setup-alert-email';
import type { Candle } from '../market/candles';
import { __setTwelveDataForTests } from '../market/twelve-data';
import { recentCandles, registerCandleStore } from '../market/candle-store';

jest.mock('../market/candles', () => ({
  ...jest.requireActual('../market/candles'),
  // Sem preco de mercado por padrao: a criacao cai no preco da analise.
  fetchCrypto1m: jest.fn(async () => null),
}));
jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));

// Opt-in explicito, como o trades.pg.spec.ts. Nunca usa o DATABASE_URL de ninguem.
const integration = process.env.TICKRIFY_PG_INTEGRATION === '1' ? describe : describe.skip;
const M5 = 5 * 60 * 1000;
const H = 60 * 60 * 1000;

integration('PostgreSQL descartavel: alertas de nivel', () => {
  jest.setTimeout(60_000);
  let prisma: any;
  let setups: SetupsService;
  let alerts: SetupAlertsService;
  const oldKey = process.env.TWELVE_DATA_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;

  beforeAll(async () => {
    const url = new URL(process.env.TICKRIFY_PG_TEST_URL || '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_concurrency_test' || url.username !== 'tickrify_test') {
      throw new Error('Refusing any database except the disposable loopback fixture.');
    }
    process.env.DATABASE_URL = url.toString();
    process.env.DIRECT_URL = url.toString();
    process.env.TWELVE_DATA_API_KEY = 'test-key';
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
    prisma = new PrismaService();
    await prisma.$connect();
    const [db] = await prisma.$queryRawUnsafe('SELECT current_database()::text AS name, current_user::text AS role');
    expect(db).toEqual({ name: 'tickrify_concurrency_test', role: 'tickrify_test' });
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS tickrify CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA tickrify');
    await prisma.$executeRawUnsafe(`CREATE TYPE tickrify."TickTxType" AS ENUM ('PURCHASE','USAGE','REFUND','BONUS')`);
    const types: Record<string, string> = { String: 'TEXT', Int: 'INTEGER', Float: 'DOUBLE PRECISION',
      Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB', TickTxType: 'tickrify."TickTxType"' };
    for (const model of Prisma.dmmf.datamodel.models.filter((m) => ['User', 'Analysis', 'Subscription', 'AdminAudit'].includes(m.name))) {
      const columns = model.fields.filter((f) => f.kind !== 'object').map((field) => {
        let column = `"${field.dbName || field.name}" ${types[field.type] ?? 'TEXT'}${field.isRequired ? ' NOT NULL' : ''}`;
        if (field.isId) column += ' PRIMARY KEY';
        if (field.isUnique) column += ' UNIQUE';
        const value = field.default;
        if (typeof value === 'string') column += ` DEFAULT '${value.replace(/'/g, "''")}'`;
        else if (typeof value === 'number' || typeof value === 'boolean') column += ` DEFAULT ${value}`;
        else if (value && typeof value === 'object' && 'name' in value && value.name === 'now') column += ' DEFAULT CURRENT_TIMESTAMP';
        return column;
      });
      await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."${model.dbName || model.name}" (${columns.join(',')})`);
    }
    // In production AiService adds this telemetry column at boot (outside Prisma).
    await prisma.$executeRawUnsafe('ALTER TABLE tickrify."Analysis" ADD COLUMN "groundingStats" JSONB');
    await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."UserTrial" (
      "userId" TEXT PRIMARY KEY, "startedAt" TIMESTAMP(3), "timezone" TEXT, "status" TEXT DEFAULT 'active',
      "endedAt" TIMESTAMP(3), "endReason" TEXT, "convertedAt" TIMESTAMP(3), "dayAtConversion" INTEGER,
      "usageDays" JSONB DEFAULT '[]', "analysesToday" INTEGER DEFAULT 0, "todayDate" TEXT,
      "source" TEXT DEFAULT 'signup', "denyReason" TEXT)`);
    setups = new SetupsService(prisma);
    await setups.onModuleInit();
    alerts = new SetupAlertsService(prisma, setups);
    await alerts.onModuleInit();
  });

  afterAll(async () => {
    if (oldKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = oldSecret;
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE tickrify."SetupAlert", tickrify."AlertPriceCheck", tickrify."TrackedSetup", tickrify."AdminAudit", tickrify."UserTrial", tickrify."Analysis", tickrify."Subscription", tickrify."User" CASCADE',
    );
  });

  async function newUser(opts: { subscriber?: boolean; exhausted?: boolean } = {}) {
    const id = randomUUID();
    await prisma.user.create({ data: { id, clerkUserId: `synthetic-${id}`, email: `${id}@example.test` } });
    if (opts.subscriber) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tickrify."Subscription" ("id","userId","stripeId","status","updatedAt") VALUES ($1,$2,$3,'active',NOW())`,
        randomUUID(), id, `sub_${id}`,
      );
    }
    if (opts.exhausted) {
      await prisma.analysis.createMany({
        data: Array.from({ length: 3 }, () => ({ userId: id, isDemo: true, status: 'completed', recommendation: 'BUY' })),
      });
    }
    return id;
  }

  async function analysis(userId: string, symbol = 'BTCUSD', currentPrice = 100) {
    const row = await prisma.analysis.create({
      data: { userId, status: 'completed', recommendation: 'BUY',
        result: { analysis: { symbol, timeframe: '15m', currentPrice, entry: currentPrice * 0.98, stopLoss: currentPrice * 0.95, takeProfit1: currentPrice * 1.05 } } },
    });
    return row.id as string;
  }

  const create = (userId: string, analysisId: string, level: number, isSubscriber = false) =>
    alerts.create({ id: userId }, { analysisId, label: 'custom', level }, { isSubscriber, trialDay: null });

  it('criar segue o setup e grava o alerta; o lado sai do preco da analise', async () => {
    const u = await newUser();
    const a = await analysis(u);
    const { alert, setupId } = await create(u, a, 110);
    expect(alert).toMatchObject({ side: 'above', status: 'active', level: 110, label: 'custom' });
    const [setup] = await prisma.$queryRawUnsafe('SELECT "status" FROM tickrify."TrackedSetup" WHERE "id" = $1', setupId);
    expect(setup.status).toBe('tracking');
    expect((await alerts.list(u)).items).toHaveLength(1);
  });

  it('tetos por plano sob corrida: gratis fica em 2 setups e assinante passa', async () => {
    const u = await newUser();
    const ids = [await analysis(u), await analysis(u, 'ETHUSD'), await analysis(u, 'SOLUSD')];
    const results = await Promise.allSettled(ids.map((id) => create(u, id, 110)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(ALERT_RULES.maxSetupsWithAlerts.free);
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason.response.code)).toEqual(['alert_limit']);

    const paid = await newUser({ subscriber: true });
    const paidIds = [await analysis(paid), await analysis(paid, 'ETHUSD'), await analysis(paid, 'SOLUSD')];
    const paidResults = await Promise.allSettled(paidIds.map((id) => create(paid, id, 110, true)));
    expect(paidResults.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('teto de 3 ativos por setup sob corrida, e clique duplo vira um alerta so', async () => {
    const u = await newUser();
    const a = await analysis(u);
    const results = await Promise.allSettled([105, 106, 107, 108, 109].map((level) => create(u, a, level)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(ALERT_RULES.maxActivePerSetup);
    const twice = await Promise.all([create(u, a, 105), create(u, a, 105)]);
    expect(new Set(twice.map((r) => r.alert.id)).size).toBe(1);
  });

  it('alheio: cancelar e marcar visto de outra conta = 404', async () => {
    const owner = await newUser();
    const other = await newUser();
    const { alert } = await create(owner, await analysis(owner), 110);
    await expect(alerts.cancel(other, alert.id)).rejects.toMatchObject({ status: 404 });
    await expect(alerts.markSeen(other, alert.id)).rejects.toMatchObject({ status: 404 });
    await expect(alerts.create({ id: other }, { analysisId: alert.analysisId!, label: 'custom', level: 110 }, { isSubscriber: false, trialDay: null }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('duas instancias ao mesmo tempo: o ativo e buscado uma vez e o alerta dispara uma vez', async () => {
    const u = await newUser();
    const { alert } = await create(u, await analysis(u), 110);
    const created = new Date(alert.createdAt).getTime();
    const now = new Date(created + 30 * 60 * 1000);
    const firstCandle = Math.ceil(created / M5) * M5;
    const candles: Candle[] = [[firstCandle - M5, 100, 120, 99, 101], [firstCandle + M5, 101, 111, 100, 109]];
    const fetchCrypto = jest.fn(async () => candles);
    const run = () => runAlertMonitor({ prisma, now: () => now, fetchCrypto, log: () => undefined });
    const [a, b] = await Promise.all([run(), run()]);
    expect(fetchCrypto).toHaveBeenCalledTimes(1);
    expect(a.triggered + b.triggered).toBe(1);
    const [row] = await prisma.$queryRawUnsafe('SELECT "status", "triggerPrice", "triggeredAt" FROM tickrify."SetupAlert" WHERE "id" = $1', alert.id);
    // O candle anterior a criacao foi a 120 e nao conta: o disparo e o seguinte.
    expect(row).toMatchObject({ status: 'triggered', triggerPrice: 111 });
    expect(new Date(row.triggeredAt).getTime()).toBe(firstCandle + M5);
    // Dentro do TTL o ativo nao e buscado de novo.
    await runAlertMonitor({ prisma, now: () => new Date(now.getTime() + 30_000), fetchCrypto, log: () => undefined });
    expect(fetchCrypto).toHaveBeenCalledTimes(1);
    const [check] = await prisma.$queryRawUnsafe('SELECT "lastPrice" FROM tickrify."AlertPriceCheck" WHERE "symbol" = $1', 'BTCUSDT');
    expect(check.lastPrice).toBe(109);
  });

  it('conta travada pausa o alerta; ao assinar, so o que vem depois conta', async () => {
    const u = await newUser();
    const { alert } = await create(u, await analysis(u), 110);
    await prisma.analysis.createMany({
      data: Array.from({ length: 3 }, () => ({ userId: u, isDemo: true, status: 'completed', recommendation: 'BUY' })),
    });
    const t0 = new Date(alert.createdAt).getTime();
    const pausedAt = new Date(t0 + 2 * H);
    const fetchCrypto = jest.fn(async (): Promise<Candle[]> => [[Math.ceil(t0 / M5) * M5 + M5, 100, 115, 99, 112]]);
    await expect(runAlertMonitor({ prisma, now: () => pausedAt, fetchCrypto, log: () => undefined })).resolves.toMatchObject({ paused: 1, triggered: 0 });
    expect(fetchCrypto).not.toHaveBeenCalled();
    let [row] = await prisma.$queryRawUnsafe('SELECT "status", "watchFrom" FROM tickrify."SetupAlert" WHERE "id" = $1', alert.id);
    expect(row.status).toBe('active');
    expect(new Date(row.watchFrom).getTime()).toBe(pausedAt.getTime());

    await prisma.$executeRawUnsafe(`INSERT INTO tickrify."Subscription" ("id","userId","stripeId","status","updatedAt") VALUES ($1,$2,$3,'active',NOW())`, randomUUID(), u, `sub_${u}`);
    const later = new Date(pausedAt.getTime() + 20 * 60 * 1000);
    // O candle de 115 e de ANTES da pausa: nao dispara na volta.
    await expect(runAlertMonitor({ prisma, now: () => later, fetchCrypto, log: () => undefined })).resolves.toMatchObject({ triggered: 0 });
    [row] = await prisma.$queryRawUnsafe('SELECT "status" FROM tickrify."SetupAlert" WHERE "id" = $1', alert.id);
    expect(row.status).toBe('active');
  });

  it('armazem de velas: a busca do Twelve Data apaga o que foi gravado no fuso errado', async () => {
    const NOW = new Date('2026-11-09T11:46:00Z');
    const LAST = Date.parse('2026-11-09T11:45:00Z');
    __setTwelveDataForTests({ now: () => NOW });
    await registerCandleStore(prisma, () => undefined);
    // Linhas antigas: 11h a frente, e uma no meio do fim de semana.
    const stale = [LAST + 11 * H, LAST + 2 * M5 + 7 * H, Date.parse('2026-11-07T09:00:00Z')];
    for (const t of stale) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tickrify."MarketCandle" ("symbol","timeframe","openTime","open","high","low","close","source") VALUES ('XAUUSD','5m',$1::timestamp(3),1,2,0,1,'twelvedata')`,
        new Date(t).toISOString(),
      );
    }
    const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ values: Array.from({ length: 40 }, (_, i) => ({ datetime: stamp(LAST - i * M5), open: '4105', high: '4110', low: '4100', close: '4108' })) }),
    } as any);
    const got = await recentCandles('XAUUSD', '5m', 'analysis', NOW.getTime());
    fetchSpy.mockRestore();
    expect(got.candles).toHaveLength(40);
    const rows = await prisma.$queryRawUnsafe(`SELECT MIN("openTime") AS "min", MAX("openTime") AS "max", COUNT(*)::int AS "n" FROM tickrify."MarketCandle" WHERE "symbol" = 'XAUUSD'`);
    expect(rows[0]).toEqual({ min: new Date(LAST - 39 * M5), max: new Date(LAST), n: 40 });
  });

  it('largar o setup cancela os alertas e o monitor nao olha mais', async () => {
    const u = await newUser();
    const { alert, setupId } = await create(u, await analysis(u), 110);
    await alerts.cancelForSetup(u, setupId);
    const [row] = await prisma.$queryRawUnsafe('SELECT "status" FROM tickrify."SetupAlert" WHERE "id" = $1', alert.id);
    expect(row.status).toBe('cancelled');
  });

  describe('alerta automatico do WATCH', () => {
    const plan = { direction: 'short', triggerType: 'zone_reaction', zoneLow: 110, zoneHigh: 112, invalidation: 115, target1: 100, target2: null, validForCandles: 12, trigger: 'Bearish close' };
    const result = (symbol = 'BTCUSD') => ({ signalState: 'WATCH', dataMode: 'real_data', watchPlan: plan, analysis: { symbol, timeframe: '15m', currentPrice: 100 } });

    async function watch(userId: string, symbol = 'BTCUSD') {
      const row = await prisma.analysis.create({ data: { userId, status: 'completed', recommendation: 'WAIT', result: result(symbol) } });
      return row.id as string;
    }
    const run = (userId: string, analysisId: string, symbol = 'BTCUSD') =>
      createWatchAlert(prisma, { analysisId, userId, result: result(symbol), recommendation: 'WAIT' });
    const alertsOf = (userId: string) => prisma.$queryRawUnsafe(`SELECT "label", "level", "side", "status", "prefilled" FROM tickrify."SetupAlert" WHERE "userId" = $1`, userId);
    const setupsOf = (userId: string) => prisma.$queryRawUnsafe(`SELECT "status" FROM tickrify."TrackedSetup" WHERE "userId" = $1`, userId);

    it('grava o setup seguido e o alerta entry; repetir nao duplica', async () => {
      const u = await newUser();
      const id = await watch(u);
      await expect(run(u, id)).resolves.toBe('created');
      await expect(run(u, id)).resolves.toBe('already_handled');
      expect(await alertsOf(u)).toEqual([{ label: 'entry', level: 110, side: 'above', status: 'active', prefilled: true }]);
      expect(await setupsOf(u)).toEqual([{ status: 'tracking' }]);
      const [linked] = await prisma.$queryRawUnsafe(`SELECT "setupId" FROM tickrify."Analysis" WHERE "id" = $1`, id);
      expect(linked.setupId).toEqual(expect.any(String));
    });

    it('bater no teto desfaz o seguir: nenhum setup novo sem alerta', async () => {
      const u = await newUser();
      for (let i = 0; i < ALERT_RULES.maxSetupsWithAlerts.free; i++) await expect(run(u, await watch(u))).resolves.toBe('created');
      await expect(run(u, await watch(u))).resolves.toBe('limit');
      expect(await setupsOf(u)).toHaveLength(ALERT_RULES.maxSetupsWithAlerts.free);
      expect(await alertsOf(u)).toHaveLength(ALERT_RULES.maxSetupsWithAlerts.free);
    });

    describe('expiracao com relogio falso', () => {
      const monitor = (now: Date) => runAlertMonitor({ prisma, now: () => now, fetchCrypto: jest.fn(async () => []), isPaused: async () => false, log: () => undefined });
      const expiry = async (userId: string) => (await prisma.$queryRawUnsafe(`SELECT "expiresAt" FROM tickrify."SetupAlert" WHERE "userId" = $1`, userId))[0].expiresAt as Date;

      it('automatico cancela quando a janela fecha e libera o teto; o feito a mao continua', async () => {
        const u = await newUser();
        await run(u, await watch(u));
        await run(u, await watch(u));
        await expect(run(u, await watch(u))).resolves.toBe('limit');
        const when = await expiry(u);
        await monitor(new Date(when.getTime() - 60_000));
        expect((await alertsOf(u)).map((a: any) => a.status)).toEqual(['active', 'active']);
        await monitor(new Date(when.getTime() + 60_000));
        expect((await alertsOf(u)).map((a: any) => a.status)).toEqual(['cancelled', 'cancelled']);
        await expect(run(u, await watch(u))).resolves.toBe('created');

        const v = await newUser({ subscriber: true });
        await create(v, await analysis(v), 110, true);
        await monitor(new Date(Date.now() + 365 * 24 * H));
        expect((await alertsOf(v)).map((a: any) => a.status)).toEqual(['active']);
      });

      it('e-mail nunca sai para alerta automatico cujo WATCH venceu', async () => {
        const u = await newUser({ subscriber: true });
        await run(u, await watch(u));
        const when = await expiry(u);
        await prisma.$executeRawUnsafe(`UPDATE tickrify."SetupAlert" SET "status" = 'triggered', "triggeredAt" = $2 WHERE "userId" = $1`, u, new Date(when.getTime() - 60_000));
        const send = (now: Date) => {
          const mail = { sendLifecycle: jest.fn(async () => true) };
          return runSetupAlertEmailSweep({ prisma, mail, isEnabled: () => true, appUrl: 'https://tickrify.com', apiBaseUrl: 'https://api.test', now: () => now, capture: jest.fn(), log: () => undefined });
        };
        await expect(send(new Date(when.getTime() + 60_000))).resolves.toEqual({ due: 0, sent: 0 });
        await expect(send(new Date(when.getTime() - 30_000))).resolves.toEqual({ due: 1, sent: 1 });
      });
    });

    it('corrida: dois WATCH ao mesmo tempo nao passam do teto', async () => {
      const u = await newUser();
      await expect(run(u, await watch(u))).resolves.toBe('created');
      const ids = await Promise.all([watch(u), watch(u), watch(u)]);
      const outcomes = await Promise.all(ids.map((id) => run(u, id)));
      expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'limit')).toHaveLength(2);
      expect(await setupsOf(u)).toHaveLength(2);
    });

    it('descadastrado, gratis esgotado e ativo sem fonte: nada gravado', async () => {
      const a = await newUser();
      await prisma.adminAudit.create({ data: { action: 'email_unsubscribed', targetUserId: a } });
      await expect(run(a, await watch(a))).resolves.toBe('unsubscribed');
      const b = await newUser({ exhausted: true });
      await expect(run(b, await watch(b))).resolves.toBe('free_locked');
      const c = await newUser();
      await expect(run(c, await watch(c, 'Volatility 75 Index'), 'Volatility 75 Index')).resolves.toBe('no_price_source');
      for (const u of [a, b, c]) {
        expect(await alertsOf(u)).toEqual([]);
        expect(await setupsOf(u)).toEqual([]);
      }
    });

    it('alerta cancelado nao volta e setup largado continua largado', async () => {
      const u = await newUser();
      const id = await watch(u);
      await run(u, id);
      const { items } = await alerts.list(u);
      await alerts.cancel(u, items[0].id);
      await expect(run(u, id)).resolves.toBe('already_handled');
      await setups.setStatus({ id: u }, items[0].setupId!, 'untracked');
      await prisma.$executeRawUnsafe(`DELETE FROM tickrify."SetupAlert" WHERE "userId" = $1`, u);
      await expect(run(u, id)).resolves.toBe('already_handled');
      expect(await setupsOf(u)).toEqual([{ status: 'untracked' }]);
    });
  });

  it('alerta do My assets: sem setup nem analise, vigiado pelo monitor, com e-mail e fora da lista de setups', async () => {
    const u = await newUser({ subscriber: true });
    expect(alerts.assetAlertsAvailable).toBe(true);
    const [nullable] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = 'tickrify' AND table_name = 'SetupAlert' AND column_name IN ('setupId','analysisId') AND is_nullable = 'YES'`,
    );
    expect(nullable.n).toBe(2);
    alerts.latestPrice = jest.fn(async () => 100);
    const user = { id: u, clerkUserId: `synthetic-${u}` };
    await expect(alerts.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [110, 95] }, { isSubscriber: true })).resolves.toEqual({ created: 2 });
    // Ligar de novo troca os anteriores; nunca acumula.
    await alerts.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [110, 95] }, { isSubscriber: true });
    const active = await alerts.assetAlerts(u);
    expect(active.map((a) => [a.level, a.side, a.status])).toEqual([[110, 'above', 'active'], [95, 'below', 'active']]);
    expect((await alerts.list(u)).items).toHaveLength(0);
    // Um alerta de setup da mesma pessoa convive e nao e tocado.
    const { alert: fromSetup } = await create(u, await analysis(u, 'ETHUSD'), 120, true);

    const [row] = await prisma.$queryRawUnsafe('SELECT "createdAt", "setupId", "analysisId", "expiresAt" FROM tickrify."SetupAlert" WHERE "id" = $1', active[0].id);
    expect(row).toMatchObject({ setupId: null, analysisId: null });
    const created = new Date(row.createdAt).getTime();
    expect(new Date(row.expiresAt).getTime() - created).toBeGreaterThan(23 * H);
    const now = new Date(created + 30 * 60 * 1000);
    const first = Math.ceil(created / M5) * M5;
    const fetchCrypto = jest.fn(async (symbol: string): Promise<Candle[] | null> => (symbol === 'BTCUSDT' ? [[first + M5, 101, 111, 100, 109]] : null));
    await expect(runAlertMonitor({ prisma, now: () => now, fetchCrypto, log: () => undefined })).resolves.toMatchObject({ triggered: 1 });
    const after = await alerts.assetAlerts(u, now);
    expect(after.map((a) => [a.level, a.status])).toEqual([[110, 'triggered'], [95, 'active']]);

    const mail = { sendLifecycle: jest.fn(async (_to: string, _email: { subject: string; html: string }) => true) };
    const sweep = { prisma, mail, isEnabled: () => true, appUrl: 'https://tickrify.com', apiBaseUrl: 'https://api.test', now: () => now, capture: jest.fn(), log: () => undefined };
    await expect(runSetupAlertEmailSweep(sweep)).resolves.toEqual({ due: 1, sent: 1 });
    const sent = mail.sendLifecycle.mock.calls[0][1];
    expect(sent.subject).toBe('BTCUSDT reached 110');
    expect(sent.html).toContain('/dashboard/new?asset=BTCUSDT&amp;alert=');

    // Visto some da lista; desligar cancela o que sobrou e nao toca o alerta do setup.
    await alerts.markSeen(u, after[0].id);
    await alerts.cancelAssetAlerts(u, { symbol: 'BTCUSDT' });
    expect(await alerts.assetAlerts(u, now)).toHaveLength(0);
    expect((await alerts.list(u)).items.map((a) => a.id)).toEqual([fromSetup.id]);
    // Tirar o ativo da lista (keep sem ele) cancela; quem ficou na lista segue.
    await alerts.setAssetAlerts(user, { symbol: 'BTCUSDT', referencePrice: 100, levels: [110] }, { isSubscriber: true });
    await alerts.cancelAssetAlerts(u, { keep: ['BTCUSDT'] });
    expect(await alerts.assetAlerts(u)).toHaveLength(1);
    await alerts.cancelAssetAlerts(u, { keep: [] });
    expect(await alerts.assetAlerts(u)).toHaveLength(0);
  });

  describe('e-mail com relogio falso', () => {
    async function triggered(userId: string, at: Date, symbol = 'BTCUSD') {
      const { alert } = await create(userId, await analysis(userId, symbol), 110, true);
      await prisma.$executeRawUnsafe(
        `UPDATE tickrify."SetupAlert" SET "status" = 'triggered', "triggeredAt" = $2, "triggerPrice" = 110 WHERE "id" = $1`,
        alert.id, at,
      );
      return alert;
    }
    const deps = (now: Date, sendOk = true) => {
      const mail = { sendLifecycle: jest.fn(async () => sendOk) };
      return { mail, deps: { prisma, mail, isEnabled: () => true, appUrl: 'https://tickrify.com', apiBaseUrl: 'https://api.test', now: () => now, capture: jest.fn(), log: () => undefined } };
    };

    it('3 por pessoa em 24h; a janela anda com o relogio', async () => {
      const u = await newUser({ subscriber: true });
      const t = new Date();
      for (const s of ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD']) await triggered(u, t, s);
      const first = deps(new Date(t.getTime() + 60_000));
      await expect(runSetupAlertEmailSweep(first.deps)).resolves.toEqual({ due: 3, sent: 3 });
      // O 4o fica pendente; 5h depois (ainda dentro das 6h do disparo) segue barrado pelas 24h.
      const second = deps(new Date(t.getTime() + 5 * H));
      await expect(runSetupAlertEmailSweep(second.deps)).resolves.toEqual({ due: 0, sent: 0 });
    });

    it('1 por setup a cada 12h, e recusa da Resend tenta de novo', async () => {
      const u = await newUser({ subscriber: true });
      const t = new Date();
      const a = await triggered(u, t);
      const { alert: b } = await create(u, a.analysisId!, 105, true);
      await prisma.$executeRawUnsafe(`UPDATE tickrify."SetupAlert" SET "status" = 'triggered', "triggeredAt" = $2 WHERE "id" = $1`, b.id, t);

      // Recusa tira a marca: o outro alerta do setup tambem tenta (e tambem e recusado).
      const refused = deps(new Date(t.getTime() + 60_000), false);
      await expect(runSetupAlertEmailSweep(refused.deps)).resolves.toEqual({ due: 2, sent: 0 });
      let rows = await prisma.$queryRawUnsafe('SELECT "emailedAt" FROM tickrify."SetupAlert" WHERE "emailedAt" IS NOT NULL');
      expect(rows).toHaveLength(0);

      const ok = deps(new Date(t.getTime() + 11 * 60_000));
      await expect(runSetupAlertEmailSweep(ok.deps)).resolves.toEqual({ due: 1, sent: 1 });
      rows = await prisma.$queryRawUnsafe('SELECT "id" FROM tickrify."SetupAlert" WHERE "emailedAt" IS NOT NULL');
      expect(rows).toHaveLength(1);
      // O outro alerta do mesmo setup nao sai dentro das 12h.
      const again = deps(new Date(t.getTime() + 21 * 60_000));
      await expect(runSetupAlertEmailSweep(again.deps)).resolves.toEqual({ due: 0, sent: 0 });
    });

    it('nunca para descadastrado nem para alerta ja visto', async () => {
      const u = await newUser({ subscriber: true });
      const t = new Date();
      const a = await triggered(u, t);
      await alerts.markSeen(u, a.id);
      const v = await newUser({ subscriber: true });
      await triggered(v, t);
      await prisma.adminAudit.create({ data: { action: 'email_unsubscribed', targetUserId: v } });
      const run = deps(new Date(t.getTime() + 60_000));
      await expect(runSetupAlertEmailSweep(run.deps)).resolves.toEqual({ due: 0, sent: 0 });
    });
  });
});
