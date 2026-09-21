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

describe('funil gratis no backend', () => {
  const prisma = (used: number) => ({
    user: { findUnique: jest.fn().mockResolvedValue({ clerkUserId: 'user_clerk' }) },
    analysis: { count: jest.fn().mockResolvedValue(used) },
  });

  beforeEach(() => (captureServer as jest.Mock).mockClear());

  it('numera a analise pelo banco (a linha recem-criada ja conta)', async () => {
    await trackFreeAnalysisStarted(prisma(2), { userId: 'u1', analysisId: 'a2', createdAt: new Date(0) });

    expect(captureServer).toHaveBeenCalledWith(
      'user_clerk',
      'free_analysis_started',
      expect.objectContaining({ analysisNumber: 2, freeRemaining: 1 }),
      { dedupeKey: 'free_analysis_started:a2', timestamp: new Date(0) },
    );
  });

  it('conclusao da 3a marca isLastFree e emite free_quota_exhausted uma vez por pessoa', async () => {
    await trackFreeAnalysisCompleted(prisma(3), { userId: 'u1', analysisId: 'a3' });

    const calls = (captureServer as jest.Mock).mock.calls;
    expect(calls[0][1]).toBe('free_analysis_completed');
    expect(calls[0][2]).toEqual(expect.objectContaining({ analysisNumber: 3, freeRemaining: 0, isLastFree: true }));
    expect(calls[1][1]).toBe('free_quota_exhausted');
    expect(calls[1][3]).toEqual(expect.objectContaining({ dedupeKey: 'free_quota_exhausted:u1' }));
  });

  it('conclusao da 1a nao emite esgotamento', async () => {
    await trackFreeAnalysisCompleted(prisma(1), { userId: 'u1', analysisId: 'a1' });

    const events = (captureServer as jest.Mock).mock.calls.map((c) => c[1]);
    expect(events).toEqual(['free_analysis_completed']);
  });

  it('usuario sem id do Clerk ou banco fora do ar: nada quebra', async () => {
    const broken = { user: { findUnique: jest.fn().mockRejectedValue(new Error('db')) }, analysis: { count: jest.fn() } };
    await expect(trackFreeAnalysisCompleted(broken, { userId: 'u1', analysisId: 'a1' })).resolves.toBeUndefined();
    expect(captureServer).not.toHaveBeenCalled();
  });
});
