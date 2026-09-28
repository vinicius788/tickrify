import { inspectAnalysisDispatch } from './analysis-dispatch-audit';

const rows = [
  { id: 'analysis-a', status: 'pending', isDemo: false, createdAt: new Date('2026-09-28T00:00:00Z') },
  { id: 'analysis-b', status: 'processing', isDemo: true, createdAt: new Date('2026-09-28T00:01:00Z') },
  { id: 'analysis-c', status: 'pending', isDemo: false, createdAt: new Date('2026-09-28T00:02:00Z') },
  { id: 'analysis-d', status: 'pending', isDemo: false, createdAt: new Date('2026-09-28T00:03:00Z') },
];

describe('read-only dispatch audit', () => {
  it('separates present, missing, mismatched and unobservable jobs without changing any state', async () => {
    const lookup = jest.fn(async (id: string) => {
      if (id === 'analysis-a') return { state: 'waiting', analysisId: id };
      if (id === 'analysis-b') return null;
      if (id === 'analysis-c') return { state: 'active', analysisId: 'different-analysis' };
      throw new Error('Redis unavailable');
    });

    const findings = await inspectAnalysisDispatch(rows, lookup);

    expect(lookup.mock.calls.map(([id]) => id)).toEqual(rows.map((row) => row.id));
    expect(findings.map((finding) => [finding.jobState, finding.assessment])).toEqual([
      ['waiting', 'present'],
      ['not_found', 'review'],
      ['active', 'review'],
      ['lookup_error', 'lookup_error'],
    ]);
    expect(findings[0]).toEqual(expect.objectContaining({
      analysisId: 'analysis-a', status: 'pending', isDemo: false,
      createdAt: '2026-09-28T00:00:00.000Z',
    }));
  });

  it('flags completed BullMQ jobs whose analysis is still pending', async () => {
    const findings = await inspectAnalysisDispatch([rows[0]], async (id) => ({
      state: 'completed', analysisId: id,
    }));
    expect(findings[0].assessment).toBe('review');
  });
});
