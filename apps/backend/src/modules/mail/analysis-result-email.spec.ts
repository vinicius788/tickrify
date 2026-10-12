import {
  analysisResultAuditAction,
  renderAnalysisResultEmail,
  runAnalysisResultSweep,
  tp1RFromDetail,
  type AnalysisResultDeps,
} from './analysis-result-email';
import { UNSUBSCRIBE_AUDIT_ACTION } from './lifecycle-email';

const NOW = new Date('2026-10-12T12:00:00Z');

type Row = {
  id: string;
  userId: string;
  recommendation: string;
  outcome: string;
  outcomeDetail: unknown;
  result: unknown;
  createdAt: Date;
  user: { email: string | null; name: string | null };
};

const row = (id: string, userId: string, outcome: string, extra: Partial<Row> = {}): Row => ({
  id,
  userId,
  recommendation: 'BUY',
  outcome,
  outcomeDetail: { entry: 4150, stopLoss: 4140, takeProfit1: 4170, tp2Hit: false },
  result: { analysis: { symbol: 'XAUUSD', timeframe: '15m' } },
  createdAt: new Date('2026-10-10T09:41:00Z'),
  user: { email: `${userId}@x.com`, name: 'Joao Silva' },
  ...extra,
});

function makeDeps(opts: {
  enabled?: boolean;
  rows?: Row[];
  audits?: Array<{ action: string; targetUserId: string; createdAt?: Date }>;
  sendOk?: boolean;
}) {
  const audits = [...(opts.audits ?? [])].map((a, i) => ({ id: `pre_${i}`, ...a }));
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const logs: string[] = [];
  const findManyAnalysis = jest.fn(async () => opts.rows ?? []);
  const prisma = {
    analysis: { findMany: findManyAnalysis },
    adminAudit: {
      findFirst: jest.fn(async ({ where }: any) => {
        const hit = audits.find((a) => {
          if (a.targetUserId !== where.targetUserId) return false;
          if (typeof where.action === 'string' && a.action !== where.action) return false;
          if (typeof where.action === 'object' && !a.action.startsWith(where.action.startsWith)) return false;
          if (where.createdAt?.gt && !(a.createdAt && a.createdAt > where.createdAt.gt)) return false;
          return true;
        });
        return hit ? { id: hit.id } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        audits.filter((a) => a.targetUserId === where.targetUserId && where.action.in.includes(a.action)),
      ),
      create: jest.fn(async ({ data }: any) => {
        const id = `audit_${audits.length}`;
        audits.push({ id, action: data.action, targetUserId: data.targetUserId, createdAt: NOW });
        return { id };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        for (const id of where.id.in) {
          const i = audits.findIndex((a) => a.id === id);
          if (i >= 0) audits.splice(i, 1);
        }
        return { count: where.id.in.length };
      }),
    },
  };
  const deps: AnalysisResultDeps = {
    prisma: prisma as any,
    mail: {
      sendLifecycle: jest.fn(async (to, email) => {
        sent.push({ to, subject: email.subject, html: email.html });
        return opts.sendOk ?? true;
      }),
    },
    isEnabled: () => opts.enabled ?? true,
    appUrl: 'https://tickrify.com',
    apiBaseUrl: 'https://api.tickrify.com',
    now: () => NOW,
    log: (_level, message) => logs.push(message),
  };
  return { deps, prisma, audits, sent, logs, findManyAnalysis };
}

describe('analysis result email', () => {
  const oldSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  beforeAll(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
  });
  afterAll(() => {
    if (oldSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = oldSecret;
  });

  it('computes the R of Target 1 from the levels the sweeper used', () => {
    expect(tp1RFromDetail({ entry: 4150, stopLoss: 4140, takeProfit1: 4170 })).toBe(2);
    expect(tp1RFromDetail({ entry: 100, stopLoss: 100, takeProfit1: 110 })).toBeNull();
    expect(tp1RFromDetail(null)).toBeNull();
  });

  it('tells wins and losses the same way, one line per read', () => {
    const one = renderAnalysisResultEmail({
      appUrl: 'https://tickrify.com',
      firstName: 'Joao',
      unsubscribeUrl: 'https://api/u',
      items: [{ id: 'a1', symbol: 'XAUUSD', timeframe: '15m', side: 'BUY', outcome: 'LOSS', createdAt: NOW, tp1R: null }],
    });
    expect(one.subject).toBe('Your XAUUSD read: stop hit');
    expect(one.html).toContain('Stop hit (-1R)');
    expect(one.html).toContain('/dashboard/analysis/a1');
    expect(one.html).toContain('not a guaranteed fill');

    const many = renderAnalysisResultEmail({
      appUrl: 'https://tickrify.com',
      firstName: null,
      unsubscribeUrl: 'https://api/u',
      items: [
        { id: 'a1', symbol: 'XAUUSD', timeframe: '15m', side: 'BUY', outcome: 'WIN', createdAt: NOW, tp1R: 2 },
        { id: 'a2', symbol: 'BTCUSDT', timeframe: '1h', side: 'SELL', outcome: 'NO_FILL', createdAt: NOW, tp1R: null },
      ],
    });
    expect(many.subject).toBe('What happened to your last 2 reads');
    expect(many.html).toContain('Target 1 reached (+2.0R)');
    expect(many.html).toContain('Entry never reached');
    expect(many.html).toContain('/dashboard/new');
  });

  it('escapes the symbol read from the chart', () => {
    const email = renderAnalysisResultEmail({
      appUrl: 'https://tickrify.com',
      firstName: null,
      unsubscribeUrl: 'https://api/u',
      items: [{ id: 'a1', symbol: '<b>X', timeframe: '', side: 'BUY', outcome: 'WIN', createdAt: NOW, tp1R: 1 }],
    });
    expect(email.html).not.toContain('<b>X');
    expect(email.html).toContain('&lt;b&gt;X');
  });

  it('desligado: so loga quem receberia, sem marcar nem enviar', async () => {
    const { deps, sent, prisma, logs } = makeDeps({ enabled: false, rows: [row('a1', 'u1', 'WIN')] });
    const res = await runAnalysisResultSweep(deps);
    expect(res).toEqual({ users: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    expect(prisma.adminAudit.create).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('[analysis-result] dry-run user=u1 analyses=1');
  });

  it('agrupa por pessoa, marca cada analise antes de enviar e nao repete', async () => {
    const rows = [row('a1', 'u1', 'WIN'), row('a2', 'u1', 'LOSS'), row('b1', 'u2', 'NO_FILL')];
    const { deps, sent, audits } = makeDeps({ rows });
    expect(await runAnalysisResultSweep(deps)).toEqual({ users: 2, sent: 2 });
    expect(sent.map((s) => s.to).sort()).toEqual(['u1@x.com', 'u2@x.com']);
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([analysisResultAuditAction('a1'), analysisResultAuditAction('a2'), analysisResultAuditAction('b1')]),
    );

    // Segunda volta: tudo marcado e dentro das 20h.
    const again = await runAnalysisResultSweep(deps);
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('nunca para descadastrado e no maximo 1 por pessoa a cada 20h', async () => {
    const { deps, sent } = makeDeps({
      rows: [row('a1', 'u1', 'WIN'), row('b1', 'u2', 'WIN')],
      audits: [
        { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: 'u1' },
        { action: analysisResultAuditAction('old'), targetUserId: 'u2', createdAt: new Date(NOW.getTime() - 3 * 3600_000) },
      ],
    });
    expect(await runAnalysisResultSweep(deps)).toEqual({ users: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('envio recusado tira as marcas para tentar de novo', async () => {
    const { deps, audits, prisma } = makeDeps({ rows: [row('a1', 'u1', 'WIN'), row('a2', 'u1', 'LOSS')], sendOk: false });
    await runAnalysisResultSweep(deps);
    expect(prisma.adminAudit.deleteMany).toHaveBeenCalledTimes(1);
    expect(audits.filter((a) => a.action.startsWith('analysis_result:'))).toHaveLength(0);
  });

  it('so pede ao banco planos BUY/SELL fechados nas ultimas 24h, com e-mail', async () => {
    const { deps, findManyAnalysis } = makeDeps({ rows: [] });
    await runAnalysisResultSweep(deps);
    const where = (findManyAnalysis.mock.calls[0] as any)[0].where;
    expect(where.recommendation).toEqual({ in: ['BUY', 'SELL'] });
    expect(where.outcome).toEqual({ in: ['WIN', 'LOSS', 'NO_FILL', 'TIMEOUT'] });
    expect(where.outcomeAt.gte).toEqual(new Date(NOW.getTime() - 24 * 3600_000));
    expect(where.user).toEqual({ email: { not: null } });
  });

  it('ignora linha fora do formato (WAIT, outcome desconhecido) sem quebrar a volta', async () => {
    const { deps, sent } = makeDeps({ rows: [row('w1', 'u1', 'ABSTAIN', { recommendation: 'WAIT' }), row('a1', 'u2', 'TIMEOUT')] });
    expect(await runAnalysisResultSweep(deps)).toEqual({ users: 1, sent: 1 });
    expect(sent[0].subject).toBe('Your XAUUSD read: no target, no stop in 48 hours');
  });
});
