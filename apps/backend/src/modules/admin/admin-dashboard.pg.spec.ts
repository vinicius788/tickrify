import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { loadAnalysisDetail, loadHomeReport, loadUserDetail, searchAnalyses, searchUsers } from './admin-dashboard';
import { loadEngineReport } from './engine-report';

// Opt-in explicito, como o setup-alerts.pg.spec.ts. Nunca usa o DATABASE_URL de ninguem.
const integration = process.env.TICKRIFY_PG_INTEGRATION === '1' ? describe : describe.skip;
const NOW = new Date('2026-11-23T15:00:00Z');
const H = 60 * 60 * 1000;

integration('PostgreSQL descartavel: relatorios do /admin', () => {
  jest.setTimeout(60_000);
  let prisma: any;

  const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);

  async function analysis(id: string, userId: string, createdAt: Date, result: unknown, status = 'completed') {
    await exec(
      `INSERT INTO tickrify."Analysis" ("id","userId","status","createdAt","updatedAt","result","isDemo","imageUrl") VALUES ($1,$2,$3,$4,$4,$5::jsonb,false,$6)`,
      id, userId, status, createdAt, result === null ? null : JSON.stringify(result), `${userId}/${id}.png`,
    );
  }
  const engineResult = (symbol: string, action: string, agreement: string, readers: unknown[], totalMs: number, extra: { decidedBy?: string; rules?: string } = {}) => ({
    analysis: { symbol, timeframe: '5m' },
    signalState: action === 'wait' ? 'WATCH' : 'ENTER_NOW',
    codeSummary: { action },
    engine: { vote: { agreement, strongRead: agreement === '3/3', ...(extra.decidedBy ? { decidedBy: extra.decidedBy } : {}) }, readers, ...(extra.rules ? { rules: extra.rules } : {}), timings: { server_total_ms: totalMs } },
  });

  beforeAll(async () => {
    const url = new URL(process.env.TICKRIFY_PG_TEST_URL || '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_concurrency_test' || url.username !== 'tickrify_test') {
      throw new Error('Refusing any database except the disposable loopback fixture.');
    }
    process.env.DATABASE_URL = url.toString();
    process.env.DIRECT_URL = url.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    await exec('DROP SCHEMA IF EXISTS tickrify CASCADE');
    await exec('CREATE SCHEMA tickrify');
    await exec(`CREATE TYPE tickrify."TickTxType" AS ENUM ('PURCHASE','USAGE','REFUND','BONUS')`);
    const types: Record<string, string> = { String: 'TEXT', Int: 'INTEGER', Float: 'DOUBLE PRECISION', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB', TickTxType: 'tickrify."TickTxType"' };
    for (const model of Prisma.dmmf.datamodel.models.filter((m) => ['User', 'Analysis', 'Subscription'].includes(m.name))) {
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
      await exec(`CREATE TABLE tickrify."${model.dbName || model.name}" (${columns.join(',')})`);
    }
    // Colunas e tabelas que o app cria no boot (fora do Prisma), so as que os relatorios leem.
    await exec('ALTER TABLE tickrify."Analysis" ADD COLUMN "groundingStats" JSONB');
    await exec(`CREATE TABLE tickrify."UserTrial" ("userId" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL, "endedAt" TIMESTAMP(3), "endReason" TEXT, "source" TEXT NOT NULL DEFAULT 'signup')`);
    await exec(`CREATE TABLE tickrify."TrackedSetup" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "symbol" TEXT, "timeframe" TEXT, "status" TEXT NOT NULL, "lastAnalysisAt" TIMESTAMP(3) NOT NULL)`);
    await exec(`CREATE TABLE tickrify."SetupAlert" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "setupId" TEXT, "symbol" TEXT NOT NULL, "level" DOUBLE PRECISION NOT NULL, "label" TEXT NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL, "triggeredAt" TIMESTAMP(3), "emailedAt" TIMESTAMP(3), "armCheck" JSONB)`);
    await exec(`CREATE TABLE tickrify."AnalysisTrack" ("analysisId" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "outcome" TEXT, "touched" BOOLEAN NOT NULL DEFAULT false, "filled" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT, "fillPrice" DOUBLE PRECISION, "stopLoss" DOUBLE PRECISION, "takeProfit1" DOUBLE PRECISION, "mfeR" DOUBLE PRECISION, "maeR" DOUBLE PRECISION)`);
    await exec(`CREATE TABLE tickrify."SupportThread" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "status" TEXT NOT NULL, "lastMessageAt" TIMESTAMP(3))`);
    await exec(`CREATE TABLE tickrify."SupportMessage" ("id" TEXT PRIMARY KEY, "threadId" TEXT NOT NULL)`);

    const user = (id: string, email: string, role: string, createdAt: Date) =>
      exec(`INSERT INTO tickrify."User" ("id","clerkUserId","email","role","plan","createdAt") VALUES ($1,$1,$2,$3,'FREE',$4)`, id, email, role, createdAt);
    await user('u_ana', 'ana@example.com', 'user', new Date(NOW.getTime() - 2 * H));
    await user('u_bob', 'bob@example.com', 'user', new Date(NOW.getTime() - 3 * 24 * H));
    await user('u_adm', 'dono@example.com', 'admin', new Date(NOW.getTime() - 30 * 24 * H));
    await user('u_old', 'old@example.com', 'user', new Date(NOW.getTime() - 20 * 24 * H));
    // Assinantes: Ana (real), dono (manual, admin) e Bob cancelado nao contam.
    const sub = (id: string, userId: string, stripeId: string, status: string) =>
      exec(`INSERT INTO tickrify."Subscription" ("id","userId","stripeId","status","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())`, id, userId, stripeId, status);
    await sub('s1', 'u_ana', 'sub_123', 'active');
    await sub('s2', 'u_adm', 'manual_owner_1', 'active');
    await sub('s3', 'u_bob', 'sub_456', 'canceled');
    await exec(`INSERT INTO tickrify."UserTrial" VALUES ('u_bob','active',$1,NULL,NULL,'signup')`, new Date(NOW.getTime() - 3 * 24 * H));

    await analysis('a_btc', 'u_ana', new Date(NOW.getTime() - 1 * H), engineResult('BTCUSDT', 'buy_pullback', '3/3', [
      { label: 'A', provider: 'openai', status: 'used', costUsd: 0.01 }, { label: 'B', provider: 'openai', status: 'used', costUsd: 0.01 }, { label: 'C', provider: 'anthropic', status: 'failed', costUsd: null, error: 'timeout' },
    ], 16000, { decidedBy: 'majority', rules: 'filter-2026-11-23' }));
    await analysis('a_xau', 'u_ana', new Date(NOW.getTime() - 2 * H), engineResult('XAUUSD', 'wait', '2/3', [{ label: 'A', provider: 'openai', status: 'used', costUsd: 0.02 }, { label: 'C', provider: 'anthropic', status: 'failed', costUsd: null, error: 'x'.repeat(120) }], 20000, { decidedBy: 'candle_bias' }));
    await analysis('a_old', 'u_ana', new Date(NOW.getTime() - 3 * 24 * H), engineResult('EURUSD', 'sell_now', '3/3', [], 14000));
    await analysis('a_legacy', 'u_bob', new Date(NOW.getTime() - 4 * H), { analysis: { symbol: 'ETHUSDT' }, signalState: 'NO_TRADE' });
    await analysis('a_fail', 'u_bob', new Date(NOW.getTime() - 5 * H), null, 'failed');

    // Trade fechado do rastreador na analise BTC: WIN com TP1 a 1,5R.
    await exec(`INSERT INTO tickrify."AnalysisTrack" VALUES ('a_btc','tracked','WIN',true,true,NULL,100,99,101.5,1.5,0.2)`);
    // Alertas: um armado e avisado 90 s depois, um invalidado sem aviso, um ativo, um disparado fora da semana.
    const alert = (id: string, status: string, triggeredAt: Date | null, emailedAt: Date | null, arm: unknown) =>
      exec(`INSERT INTO tickrify."SetupAlert" VALUES ($1,'u_ana',NULL,'BTCUSDT',100,'entry',$2,$3,$4,$5,$6::jsonb)`, id, status, new Date(NOW.getTime() - 9 * 24 * H), triggeredAt, emailedAt, arm === null ? null : JSON.stringify(arm));
    const t0 = new Date(NOW.getTime() - 30 * 60 * 1000);
    await alert('al1', 'triggered', t0, new Date(t0.getTime() + 90_000), { status: 'armed' });
    await alert('al2', 'triggered', new Date(NOW.getTime() - 40 * 60 * 1000), null, { status: 'invalidated' });
    await alert('al3', 'active', null, null, null);
    await alert('al4', 'triggered', new Date(NOW.getTime() - 10 * 24 * H), null, null);
    await exec(`INSERT INTO tickrify."SupportThread" VALUES ('t1','u_ana','open',$1)`, NOW);
    await exec(`INSERT INTO tickrify."SupportMessage" VALUES ('m1','t1'), ('m2','t1')`);
    await exec(`INSERT INTO tickrify."TrackedSetup" VALUES ('ts1','u_ana','BTCUSDT','5m','tracking',$1)`, NOW);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('Inicio: hoje e 7 dias, assinantes reais, trials, alertas e atraso do aviso', async () => {
    const home = await loadHomeReport(prisma, NOW);
    expect(home.subscribers).toBe(1);
    expect(home.activeTrials).toBe(1);
    expect(home.activeAlerts).toBe(1);
    expect(home.today.signups).toBe(1);
    expect(home.week.signups).toBe(2);
    expect(home.today.analysis).toMatchObject({
      analyses: 3, failed: 1, byAction: { buy_pullback: 1, wait: 1 }, agreement: { '3/3': 1, '2/3': 1 }, strongRead: 1, readerFailures: 2, readersSeen: 5,
      decidedBy: { majority: 1, candle_bias: 1 }, withoutMajority: 1,
    });
    expect(home.today.analysis.readerLabels).toEqual([
      { label: 'A', seen: 2, failures: 0, topError: null },
      { label: 'B', seen: 1, failures: 0, topError: null },
      { label: 'C', seen: 2, failures: 2, topError: 'timeout' },
    ]);
    expect(home.today.analysis.costUsd).toBeCloseTo(0.04, 6);
    expect(home.today.analysis.totalMsP50).toBe(16000);
    expect(home.week.analysis.analyses).toBe(4);
    expect(home.today.alerts).toMatchObject({ triggered: 2, armed: 1, invalidated: 1, notified: 1, notifyDelayP50Ms: 90_000 });
    expect(home.week.alerts.triggered).toBe(2);
  });

  it('Inspetor: acha por id, e-mail e ativo, sem tratar % e _ como curinga', async () => {
    expect((await searchAnalyses(prisma, 'a_btc')).map((h) => h.id)).toEqual(['a_btc']);
    expect((await searchAnalyses(prisma, 'ANA@example')).map((h) => h.id)).toEqual(['a_btc', 'a_xau', 'a_old']);
    expect((await searchAnalyses(prisma, 'xauusd')).map((h) => h.id)).toEqual(['a_xau']);
    expect(await searchAnalyses(prisma, '%%')).toEqual([]);
    expect(await searchAnalyses(prisma, "x'; DROP TABLE tickrify.\"Analysis\"; --")).toEqual([]);
    const [hit] = await searchAnalyses(prisma, 'a_btc');
    expect(hit).toMatchObject({ email: 'ana@example.com', symbol: 'BTCUSDT', action: 'buy_pullback', agreement: '3/3' });
  });

  it('Inspetor: abre a analise inteira com o rastreador, e id desconhecido devolve null', async () => {
    const detail = await loadAnalysisDetail(prisma, 'a_btc');
    expect(detail).toMatchObject({ id: 'a_btc', imageRef: 'u_ana/a_btc.png', user: { id: 'u_ana', email: 'ana@example.com' }, track: { outcome: 'WIN', filled: true } });
    expect((detail!.result as any).engine.readers).toHaveLength(3);
    expect((await loadAnalysisDetail(prisma, 'a_xau'))!.track).toBeNull();
    expect(await loadAnalysisDetail(prisma, 'nao_existe')).toBeNull();
  });

  it('Usuario: busca por e-mail e ficha com plano, trial, analises, setups, alertas e chat', async () => {
    expect((await searchUsers(prisma, 'ana@')).map((u) => u.id)).toEqual(['u_ana']);
    const ficha = await loadUserDetail(prisma, 'u_ana', NOW);
    expect(ficha!.subscriptions.map((s) => s.stripeId)).toEqual(['sub_123']);
    expect(ficha!.analyses).toMatchObject({ total: 3, last7d: 3 });
    expect(ficha!.analyses.recent[0].id).toBe('a_btc');
    expect(ficha!.setups).toHaveLength(1);
    expect(ficha!.alerts.byStatus).toEqual({ triggered: 3, active: 1 });
    expect(ficha!.chat).toMatchObject({ threadId: 't1', messages: 2 });
    expect((await loadUserDetail(prisma, 'u_bob', NOW))!.trial).toMatchObject({ status: 'active' });
    expect(await loadUserDetail(prisma, 'nao_existe', NOW)).toBeNull();
  });

  it('Usuario: sem as tabelas criadas no boot, a ficha sai com blocos vazios', async () => {
    await exec('ALTER TABLE tickrify."SupportThread" RENAME TO "SupportThread_off"');
    try {
      const ficha = await loadUserDetail(prisma, 'u_ana', NOW);
      expect(ficha!.chat).toBeNull();
      expect(ficha!.analyses.total).toBe(3);
    } finally {
      await exec('ALTER TABLE tickrify."SupportThread_off" RENAME TO "SupportThread"');
    }
  });

  it('Motor: so o motor novo (com voto), por entrada e classe, com o R do rastreador', async () => {
    const report = await loadEngineReport(prisma);
    expect(report.total.analyses).toBe(3);
    expect(report.byEntry.map((e) => e.entry)).toEqual(['now', 'pullback', 'wait']);
    expect(report.byClass.map((c) => c.assetClass)).toEqual(['metal', 'forex', 'crypto']);
    expect(report.agreement).toEqual([{ agreement: '3/3', count: 2 }, { agreement: '2/3', count: 1 }]);
    expect(report.decidedBy).toEqual([{ decidedBy: 'candle_bias', count: 1 }, { decidedBy: 'majority', count: 1 }, { decidedBy: 'sem registro', count: 1 }]);
    expect(report.withoutMajorityPct).toBeCloseTo(100 / 3, 6);
    const failedC = report.readerFailures.find((l) => l.label === 'C')!;
    expect(failedC).toMatchObject({ seen: 2, failures: 2, topError: 'timeout' });
    expect(report.byRules.map((g) => [g.rules, g.stats.analyses])).toEqual([['filter-2026-11-23', 1], [null, 2]]);
    const pullback = report.byEntry.find((e) => e.entry === 'pullback')!.stats;
    expect(pullback).toMatchObject({ closedTrades: 1, win: 1, decision: 'wait' });
    expect(pullback.meanR).toBeGreaterThan(1);
    expect(report.since).toBe(new Date(NOW.getTime() - 3 * 24 * H).toISOString());
  });
});
