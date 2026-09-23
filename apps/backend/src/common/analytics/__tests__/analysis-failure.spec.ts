import { trackAnalysisExecutionFailed } from '../analysis-failure';
import { captureServer } from '../posthog';

jest.mock('../posthog', () => ({ captureServer: jest.fn() }));

describe('trackAnalysisExecutionFailed', () => {
  const prisma = () => ({
    user: { findUnique: jest.fn().mockResolvedValue({ clerkUserId: 'clerk_1' }) },
  });

  beforeEach(() => (captureServer as jest.Mock).mockReset());

  it('envia só código autorizado e tipo, com identidade Clerk e dedupe estável', async () => {
    const createdAt = new Date('2026-09-23T00:00:00.000Z');
    await trackAnalysisExecutionFailed(prisma(), {
      userId: 'internal_1', analysisId: 'analysis_1', analysisType: 'quick',
      code: 'openai_rate_limit', createdAt,
    });
    expect(captureServer).toHaveBeenCalledWith(
      'clerk_1',
      'analysis_execution_failed',
      { analysisType: 'quick', code: 'openai_rate_limit' },
      { dedupeKey: 'analysis_execution_failed:analysis_1', timestamp: createdAt },
    );
  });

  it('não envia texto arbitrário e não deixa analytics quebrar o fluxo', async () => {
    (captureServer as jest.Mock).mockImplementationOnce(() => { throw new Error('PostHog indisponível'); });
    await expect(trackAnalysisExecutionFailed(prisma(), {
      userId: 'internal_1', analysisId: 'analysis_2', analysisType: 'deep',
      code: 'email=user@example.com', createdAt: new Date(0),
    })).resolves.toBeUndefined();
    expect((captureServer as jest.Mock).mock.calls[0][2]).toEqual({
      analysisType: 'deep', code: 'processing_unclassified',
    });
  });

  it('não envia evento quando não há identidade Clerk', async () => {
    await trackAnalysisExecutionFailed(prisma(), {
      analysisId: 'a', analysisType: 'quick', code: 'validation_failed', createdAt: new Date(0),
    });
    const db = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    await trackAnalysisExecutionFailed(db, {
      userId: 'u', analysisId: 'a', analysisType: 'quick', code: 'validation_failed', createdAt: new Date(0),
    });
    expect(captureServer).not.toHaveBeenCalled();
  });
});
