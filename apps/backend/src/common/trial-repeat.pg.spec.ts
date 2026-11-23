import { Prisma } from '@prisma/client';
import { PrismaService } from '../modules/database/prisma.service';
import { TrialService } from '../modules/ai/trial.service';
import { buildAcquisitionReport } from '../modules/admin/acquisition-report';
import { getFreeQuota } from './free-quota';
import { isRepeatEmailAccount, normalizeEmail, readTrial } from './trial';

// Opt-in explicito, como os outros .pg.spec. Nunca usa o DATABASE_URL de ninguem.
const integration = process.env.TICKRIFY_PG_INTEGRATION === '1' ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

integration('PostgreSQL descartavel: conta repetida pelo e-mail', () => {
  jest.setTimeout(60_000);
  let prisma: any;
  let trial: TrialService;
  const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);
  const user = (id: string, email: string | null, createdAt: Date, extra = '') =>
    exec(`INSERT INTO tickrify."User" ("id","clerkUserId","email","role","plan","createdAt"${extra ? ',"acquisitionSource"' : ''})
          VALUES ($1,$1,$2,'user','FREE',$3${extra ? ',$4' : ''})`, id, email, createdAt, ...(extra ? [extra] : []));
  const analysis = (id: string, userId: string) =>
    exec(`INSERT INTO tickrify."Analysis" ("id","userId","status","createdAt","updatedAt","isDemo","imageUrl") VALUES ($1,$2,'completed',$3,$3,true,'x.png')`, id, userId, ago(20));

  const EMAILS = [
    ' Allaoui.Yahya232+x@Gmail.com ', 'a.l.l.a.o.u.i.yahya232@googlemail.com', 'allaouiyahya190@gmail.com',
    'john.doe+news@outlook.com', 'JOHN.DOE@Outlook.com', 'trader1@yahoo.com', 'semarroba', '@gmail.com', '+tag@gmail.com', 'abc@', '',
  ];

  beforeAll(async () => {
    const url = new URL(process.env.TICKRIFY_PG_TEST_URL || '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_concurrency_test' || url.username !== 'tickrify_test') {
      throw new Error('Refusing any database except the disposable loopback fixture.');
    }
    process.env.DATABASE_URL = url.toString();
    process.env.DIRECT_URL = url.toString();
    delete process.env.CLERK_SECRET_KEY; // o trial nunca chama o Clerk de verdade no teste
    prisma = new PrismaService();
    await prisma.$connect();
    await exec('DROP SCHEMA IF EXISTS tickrify CASCADE');
    await exec('CREATE SCHEMA tickrify');
    const types: Record<string, string> = { String: 'TEXT', Int: 'INTEGER', Float: 'DOUBLE PRECISION', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB' };
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
    await exec(`CREATE TABLE tickrify."UserFeedback" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "bonusAnalyses" INTEGER NOT NULL DEFAULT 3)`);

    // Linha que ja existia antes do boot: a coluna gerada preenche sozinha.
    await user('u_a1', 'allaoui.yahya232@gmail.com', ago(30), 'chatgpt');
    trial = new TrialService(prisma, {} as any);
    await trial.onModuleInit();
    await trial.onModuleInit(); // idempotente

    await analysis('an_a1', 'u_a1');
    await user('u_a2', 'allaouiyahya232+x@googlemail.com', ago(10), 'google');
    await exec(`INSERT INTO tickrify."UserTrial" ("userId","status") VALUES ('u_a2','ended_unconverted')`);
    await user('u_a3', 'AllaouiYahya232@gmail.com', ago(1), 'google');
    await user('u_b190', 'allaouiyahya190@gmail.com', ago(5));
    await user('u_c1', 'c@x.com', ago(20));
    await user('u_c2', 'c+1@x.com', ago(2));
  });

  afterAll(async () => {
    delete process.env.TRIAL_MODE;
    await prisma?.$disconnect();
  });

  it('coluna gerada = normalizeEmail, inclusive nas linhas antigas', async () => {
    for (const [i, email] of EMAILS.entries()) await user(`u_n${i}`, email, ago(100));
    const rows: Array<{ id: string; email: string; n: string | null }> = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "emailNormalized" AS n FROM tickrify."User" WHERE "id" LIKE 'u_n%' OR "id" = 'u_a1'`,
    );
    for (const row of rows) expect(row.n).toBe(normalizeEmail(row.email));
    expect(rows.find((r) => r.id === 'u_a1')?.n).toBe('allaouiyahya232@gmail.com');
    await exec(`DELETE FROM tickrify."User" WHERE "id" LIKE 'u_n%'`);
  });

  it('conta mais antiga intacta; recriadas sao repetidas; e-mail diferente intacto', async () => {
    expect(await isRepeatEmailAccount(prisma, 'u_a1')).toBe(false);
    expect(await isRepeatEmailAccount(prisma, 'u_a2')).toBe(true);
    expect(await isRepeatEmailAccount(prisma, 'u_a3')).toBe(true);
    expect(await isRepeatEmailAccount(prisma, 'u_b190')).toBe(false);
  });

  it('conta antiga sem uso nao torna a nova repetida; com opiniao, torna', async () => {
    expect(await isRepeatEmailAccount(prisma, 'u_c2')).toBe(false);
    await exec(`INSERT INTO tickrify."UserFeedback" ("id","userId") VALUES ('f1','u_c1')`);
    expect(await isRepeatEmailAccount(prisma, 'u_c2')).toBe(true);
    expect(await isRepeatEmailAccount(prisma, 'u_c1')).toBe(false);
  });

  it('cota: repetida zerada (dentro da transacao serializavel), a mais antiga segue a regra', async () => {
    const quota = await prisma.$transaction((tx: any) => getFreeQuota(tx, 'u_a3'), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(quota).toMatchObject({ repeatEmail: true, exhausted: true, settledExhausted: true, remaining: 0, trial: null });
    // Repetida que ja tinha trial: cota zero do mesmo jeito.
    expect(await getFreeQuota(prisma, 'u_a2')).toMatchObject({ repeatEmail: true, exhausted: true });
    expect(await getFreeQuota(prisma, 'u_a1')).toMatchObject({ repeatEmail: false, exhausted: false });
    expect(await getFreeQuota(prisma, 'u_b190')).toMatchObject({ repeatEmail: false, exhausted: false });
  });

  it('trial: repetida ganha linha negada repeat_email, sem erro de e-mail; outra conta ganha trial', async () => {
    process.env.TRIAL_MODE = 'true';
    await expect(trial.ensure('u_a3')).resolves.toBeNull();
    expect(await readTrial(prisma, 'u_a3')).toMatchObject({ status: 'denied', denyReason: 'repeat_email' });
    await expect(trial.ensure('u_a3')).resolves.toBeNull();
    expect(await trial.ensure('u_b190')).toMatchObject({ status: 'active' });
  });

  it('/admin Origem conta pessoas, nao contas', async () => {
    const report = await buildAcquisitionReport(prisma, null);
    const chatgpt = report.declarada.find((r) => r.canal === 'chatgpt');
    // u_a1, u_a2 e u_a3 sao uma pessoa so, no canal da 1a conta, com a analise da 1a.
    expect(chatgpt).toMatchObject({ cadastros: 1, analisaram: 1 });
    expect(report.declarada.find((r) => r.canal === 'google')).toBeUndefined();
    const week = await buildAcquisitionReport(prisma, 7);
    // So conta quem fez a 1a conta no periodo: u_a3 (ontem) e u_c2 nao sao cadastro novo; u_b190 e.
    expect(week.declarada.reduce((n, r) => n + r.cadastros, 0)).toBe(1);
  });
});
