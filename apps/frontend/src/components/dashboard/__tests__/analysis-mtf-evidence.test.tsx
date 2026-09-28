import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AnalysisResult from '../AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations } from '@/lib/i18n';
import type { AIAnalysisResponse } from '@/lib/api';

vi.mock('@/hooks/useEconomicCalendar', () => ({
  useEconomicCalendar: () => ({ events: [], loading: false, error: false, unreliable: true }),
}));
vi.mock('@/hooks/useMarketContext', () => ({
  useMarketContext: () => ({ data: null, loading: false, error: false }),
}));

const alignment = 'H1/H4 aligned 3/3';

function analysis(additionalChartsDelivered?: number): AIAnalysisResponse {
  return {
    id: 'mtf-analysis', status: 'completed', recommendation: 'WAIT', bias: 'neutral',
    confidence: 50, createdAt: '2026-09-23T12:00:00Z', updatedAt: '2026-09-23T12:00:00Z',
    fullResponse: {
      recommendation: 'WAIT', bias: 'neutral', confidence: 50, reasoning: 'No entry',
      ...(additionalChartsDelivered === undefined ? {} : { evidence: {
        version: 1, additionalChartsDelivered,
        candleFeedAttached: false, marketContextAttached: false, calendar: 'not_confirmed',
      } }),
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        marketStructure: { bias: 'neutral' }, multiTimeframeAlignment: alignment,
      },
    },
  };
}

function show(additionalChartsDelivered?: number) {
  render(<LanguageProvider><AnalysisResult analysisData={analysis(additionalChartsDelivered)} uploadedImage={null} /></LanguageProvider>);
  const t = getTranslations('pt').analysis;
  fireEvent.click(screen.getByRole('button', { name: t.technicalPanel }));
  return t;
}

describe('timeframe evidence in stored analyses', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('tickrify-language', 'pt');
  });
  afterEach(cleanup);

  it('warns and withholds a claimed H1/H4 reading when exactly one chart was delivered', () => {
    const t = show(0);
    expect(screen.getByRole('alert').textContent).toContain(t.mtfEvidenceWarning);
    expect(screen.getAllByText(t.mtfEvidenceWarning).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(alignment)).toBeNull();
  });

  it('keeps the original field when an additional chart was delivered', () => {
    const t = show(1);
    expect(screen.queryByText(t.mtfEvidenceWarning)).toBeNull();
    expect(screen.getByText(alignment)).toBeTruthy();
  });

  it('does not invent chart coverage for an older analysis without evidence metadata', () => {
    const t = show();
    expect(screen.queryByText(t.mtfEvidenceWarning)).toBeNull();
    expect(screen.getByText(alignment)).toBeTruthy();
    expect(screen.getByText(t.evidenceLegacy)).toBeTruthy();
  });
});
