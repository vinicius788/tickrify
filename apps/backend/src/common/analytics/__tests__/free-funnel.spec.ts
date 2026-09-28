import { trackFreeAnalysisCompleted, trackFreeAnalysisStarted } from '../free-funnel';
import { captureServer, uuidFromKey } from '../posthog';

jest.mock('../posthog', () => {
  const actual = jest.requireActual('../posthog');
  return { ...actual, captureServer: jest.fn() };
});

describe('uuidFromKey', () => {
  it('mesma chave = mesmo uuid valido; chave diferente = uuid diferente', () => {
    const a = uuidFromKey('payment_succeeded:in_1');
    expect(a).toBe(uuidFromKey('payment_succeeded:in_1'));
    expect(a).not.toBe(uuidFromKey('payment_succeeded:in_2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});


/**
 * `analysis.count` falso que responde pela clausula, na mesma forma que
 * `getFreeQuota` pergunta: total nao falhado, sinais concluidos e em andamento.
 */
function quotaCount(q: { signals: number; total?: number; inFlight?: number }) {
  const inFlight = q.inFlight ?? 0;
  const total = q.total ?? q.signals + inFlight;
  return jest.fn(async ({ where }: { where: Record<string, any> }) => {
    if (where.status === 'completed') return q.signals;
    if (where.status && typeof where.status === 'object' && 'notIn' in where.status) return inFlight;
    return total;
  });
}

describe('funil gratis no backend', () => {
  const prisma = (q: { signals: number; total?: number; inFlight?: number }) => ({
    user: { findUnique: jest.fn().mockResolvedValue({ clerkUserId: 'user_clerk' }) },
    analysis: { count: quotaCount(q) },
  });

  beforeEach(() => (captureServer as jest.Mock).mockClear());

  it('numera a analise pelo banco (a linha recem-criada ja conta)', async () => {
    // 1 sinal concluido + a recem-criada em andamento; 2 no total.
    await trackFreeAnalysisStarted(prisma({ signals: 1, inFlight: 1 }), { userId: 'u1', analysisId: 'a2', createdAt: new Date(0) });

    expect(captureServer).toHaveBeenCalledWith(
      'user_clerk',
      'free_analysis_started',
      expect.objectContaining({ analysisNumber: 2, freeRemaining: 1, signalsUsed: 2 }),
      { dedupeKey: 'free_analysis_started:a2', timestamp: new Date(0) },
    );
  });

  it('conclusao do 3o sinal marca isLastFree e emite free_quota_exhausted uma vez por pessoa', async () => {
    await trackFreeAnalysisCompleted(prisma({ signals: 3 }), { userId: 'u1', analysisId: 'a3' });

    const calls = (captureServer as jest.Mock).mock.calls;
    expect(calls[0][1]).toBe('free_analysis_completed');
    expect(calls[0][2]).toEqual(expect.objectContaining({ analysisNumber: 3, freeRemaining: 0, isLastFree: true }));
    expect(calls[1][1]).toBe('free_quota_exhausted');
    expect(calls[1][3]).toEqual(expect.objectContaining({ dedupeKey: 'free_quota_exhausted:u1' }));
  });

  it('WAIT nao consome: 5 analises com 2 sinais nao emitem esgotamento', async () => {
    await trackFreeAnalysisCompleted(prisma({ signals: 2, total: 5 }), { userId: 'u1', analysisId: 'a5' });

    const calls = (captureServer as jest.Mock).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(['free_analysis_completed']);
    expect(calls[0][2]).toEqual(expect.objectContaining({ analysisNumber: 5, freeRemaining: 1, isLastFree: false }));
  });

  it('conclusao da 1a nao emite esgotamento', async () => {
    await trackFreeAnalysisCompleted(prisma({ signals: 1 }), { userId: 'u1', analysisId: 'a1' });

    const events = (captureServer as jest.Mock).mock.calls.map((c) => c[1]);
    expect(events).toEqual(['free_analysis_completed']);
  });

  it('usuario sem id do Clerk ou banco fora do ar: nada quebra', async () => {
    const broken = { user: { findUnique: jest.fn().mockRejectedValue(new Error('db')) }, analysis: { count: jest.fn() } };
    await expect(trackFreeAnalysisCompleted(broken, { userId: 'u1', analysisId: 'a1' })).resolves.toBeUndefined();
    expect(captureServer).not.toHaveBeenCalled();
  });
});
