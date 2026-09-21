export const TICK_COSTS = {
  ANALYSIS_QUICK: 1,
  ANALYSIS_DEEP: 3,
  EXPORT_PDF: 2,
} as const;

export type AnalysisType = 'quick' | 'deep';
