export type DispatchAuditRow = {
  id: string;
  status: string;
  isDemo: boolean;
  createdAt: Date;
};

export type DispatchAuditFinding = {
  analysisId: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
  jobState: string;
  assessment: 'present' | 'review' | 'lookup_error';
};

export async function inspectAnalysisDispatch(
  rows: DispatchAuditRow[],
  lookup: (analysisId: string) => Promise<{ state: string; analysisId: unknown } | null>,
): Promise<DispatchAuditFinding[]> {
  const findings: DispatchAuditFinding[] = [];

  // Sequential lookups keep an operational audit from flooding Redis.
  for (const row of rows) {
    let jobState = 'lookup_error';
    let assessment: DispatchAuditFinding['assessment'] = 'lookup_error';
    try {
      const job = await lookup(row.id);
      if (!job) {
        jobState = 'not_found';
        assessment = 'review';
      } else {
        jobState = job.state;
        assessment = job.analysisId === row.id &&
          ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children', 'paused'].includes(job.state)
          ? 'present' : 'review';
      }
    } catch {
      // A failed Redis lookup does not prove that the job is absent.
    }

    findings.push({
      analysisId: row.id,
      status: row.status,
      isDemo: row.isDemo,
      createdAt: row.createdAt.toISOString(),
      jobState,
      assessment,
    });
  }

  return findings;
}
