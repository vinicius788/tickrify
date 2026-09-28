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

const analysis = (takeProfit1: number): AIAnalysisResponse => ({
  id: 'legacy-analysis', status: 'completed', recommendation: 'BUY',
  bias: 'bullish', confidence: 70, createdAt: '2026-09-23T12:00:00Z', updatedAt: '2026-09-23T12:00:00Z',
  fullResponse: {
    recommendation: 'BUY', bias: 'bullish', confidence: 70, reasoning: 'Visible uptrend',
    analysis: {
      symbol: 'TEST', timeframe: '30m', currentPrice: 100,
      entry: 100, stopLoss: 95, takeProfit1, takeProfit2: 120,
      riskRewardRatio: '1:99', entryType: 'market', entryCondition: 'Buy now',
      marketStructure: { bias: 'bullish' },
    },
  },
});

describe('stored trade-plan integrity', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('tickrify-language', 'pt');
  });
  afterEach(cleanup);

  it('warns above the analysis and disables trade tools for an old contradictory BUY', () => {
    render(<LanguageProvider><AnalysisResult analysisData={analysis(90)} uploadedImage={null} /></LanguageProvider>);
    const t = getTranslations('pt').analysis;
    fireEvent.click(screen.getByRole('button', { name: t.technicalPanel }));
    expect(screen.getByRole('alert').textContent).toContain(t.result.invalidTradePlan);
    expect(screen.queryByText(t.positionSizing.title)).toBeNull();
    expect(screen.queryByText('Buy now')).toBeNull();
    expect(screen.queryByText('99.0 : 1')).toBeNull();
  });

  it('keeps the position calculator for a coherent BUY', () => {
    render(<LanguageProvider><AnalysisResult analysisData={analysis(110)} uploadedImage={null} /></LanguageProvider>);
    const t = getTranslations('pt').analysis;
    fireEvent.click(screen.getByRole('button', { name: t.technicalPanel }));
    expect(screen.queryByText(t.result.invalidTradePlan)).toBeNull();
    expect(screen.getByText(t.positionSizing.title)).toBeTruthy();
    expect(screen.getByText('4.0 : 1')).toBeTruthy();
  });
});
