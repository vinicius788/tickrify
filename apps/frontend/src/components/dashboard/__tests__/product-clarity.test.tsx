import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AnalysisResult from '../AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations, LANGUAGES } from '@/lib/i18n';
import type { AIAnalysisResponse } from '@/lib/api';

vi.mock('@/hooks/useEconomicCalendar', () => ({
  useEconomicCalendar: () => ({ events: [], loading: false, error: false, unreliable: true }),
}));
vi.mock('@/hooks/useMarketContext', () => ({
  useMarketContext: () => ({ data: null, loading: false, error: false }),
}));

function fixture(state: 'ENTER_NOW' | 'ARMED' | 'WATCH' | 'NO_TRADE', recommendation: 'BUY' | 'SELL' | 'WAIT' = 'BUY'): AIAnalysisResponse {
  return {
    id: 'clarity-fixture', status: 'completed', recommendation, bias: 'bullish', confidence: 70,
    reasoning: 'Stored technical reason.',
    createdAt: '2026-09-23T12:00:00Z', updatedAt: '2026-09-23T12:00:00Z',
    fullResponse: {
      signalState: state, recommendation, bias: 'bullish', confidence: 70, reasoning: '',
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 115,
        entryType: state === 'ARMED' ? 'limit' : 'market',
        entryCondition: 'Only after the stored chart condition.',
        riskFactors: 'Stored risk, without an invented price.',
        marketStructure: { bias: 'bullish' },
      },
    },
  };
}

function show(data: AIAnalysisResponse) {
  render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} sample /></LanguageProvider>);
  const guide = screen.getByLabelText(getTranslations('en').productClarity.readingGuide);
  expect(within(guide).getByText(getTranslations('en').productClarity.reviewConditions)).toBeTruthy();
  const timestamp = new Date(data.createdAt).toLocaleString('en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  expect(screen.getByText(timestamp)).toBeTruthy();
  return guide;
}

describe('product clarity without changing the stored decision', () => {
  beforeEach(() => window.localStorage.setItem('tickrify-language', 'en'));
  afterEach(cleanup);

  it('explicitly places the reading and levels at the recorded analysis time', () => {
    expect(getTranslations('en').productClarity.reviewConditions).toContain(
      'refer to the recorded analysis time and do not confirm a current opportunity',
    );
  });

  it.each(['BUY', 'SELL'] as const)('keeps %s and its levels intact; explains entry as an analysis-time reading', recommendation => {
    const data = fixture('ENTER_NOW', recommendation);
    if (recommendation === 'SELL') Object.assign(data.fullResponse!.analysis!, {
      stopLoss: 105, takeProfit1: 90, takeProfit2: 85,
    });
    const before = JSON.stringify(data);
    const guide = show(data);
    expect(within(guide).getByText('Stored technical reason.')).toBeTruthy();
    expect(within(guide).getByText('Stored risk, without an invented price.')).toBeTruthy();
    expect(screen.getByText(getTranslations('en').productClarity.entryNow)).toBeTruthy();
    expect(screen.getByTestId('signal-state').textContent).toContain(recommendation === 'BUY' ? 'Buy now' : 'Sell now');
    expect(JSON.stringify(data)).toBe(before);
  });

  it('distinguishes a pending entry from a filled trade without rewriting its condition', () => {
    const data = fixture('ARMED');
    const before = JSON.stringify(data);
    show(data);
    expect(screen.getByText(getTranslations('en').productClarity.pendingEntry)).toBeTruthy();
    expect(screen.getByText('Only after the stored chart condition.')).toBeTruthy();
    expect(screen.queryByText(getTranslations('en').productClarity.entryNow)).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('previews the stored first paragraph and retains the complete technical reading', () => {
    const data = fixture('ENTER_NOW');
    const fullReading = 'Stored first paragraph.\nStored second paragraph.';
    data.fullResponse!.analysis!.executiveSummary = fullReading;
    const before = JSON.stringify(data);
    const guide = show(data);
    expect(within(guide).getByText('Stored first paragraph.')).toBeTruthy();
    expect(guide.textContent).not.toContain('Stored second paragraph.');
    fireEvent.click(screen.getByRole('button', { name: getTranslations('en').analysis.technicalPanel }));
    expect(screen.getByText(fullReading, { exact: true, normalizer: value => value })).toBeTruthy();
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each(['WATCH', 'NO_TRADE'] as const)('does not turn %s or bullish bias into an entry or invented invalidation', state => {
    const data = fixture(state, 'WAIT');
    data.reasoning = undefined;
    Object.assign(data.fullResponse!.analysis!, {
      entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null,
      reasoning: '', riskFactors: [], entryCondition: '',
    });
    const guide = show(data);
    const c = getTranslations('en').productClarity;
    expect(within(guide).getByText(c.reasonMissing)).toBeTruthy();
    expect(within(guide).getByText(c.riskMissing)).toBeTruthy();
    expect(guide.textContent).not.toMatch(/\$|100|95/);
    expect(screen.getByTestId('signal-state').textContent).toContain(getTranslations('en').analysis.states[state]);
    expect(screen.queryByText(c.entryNow)).toBeNull();
    expect(screen.queryByText(c.pendingEntry)).toBeNull();
  });

  it.each(['WATCH', 'NO_TRADE'] as const)('keeps explanation, plan and technical reading before the clarity guide for %s', state => {
    const data = fixture(state, 'WAIT');
    const a = data.fullResponse!.analysis!;
    a.executiveSummary = 'Stored complete technical reading.';
    a.invalidationNote = 'Stored invalidation note.';
    const before = JSON.stringify(data);
    const guide = show(data);
    const t = getTranslations('en');
    const explanation = screen.getByText(state === 'WATCH' ? t.analysis.result.watchExplain : t.analysis.result.noTradeExplain, { exact: false });
    const plan = screen.getByText('Only after the stored chart condition.');
    // A leitura tambem abre o painel do modo leitura (topo); aqui vale o bloco da leitura completa.
    const readMode = screen.getByTestId('read-mode');
    const reading = screen.getAllByText('Stored complete technical reading.').find(el => !guide.contains(el) && !readMode.contains(el))!;
    const follows = (first: Element, second: Element) =>
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    follows(explanation, plan);
    follows(plan, reading);
    follows(reading, guide);
    expect(within(guide).getByText('Stored invalidation note.')).toBeTruthy();
    expect(screen.queryByTestId('levels-card')).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('uses only a validated stored watch-plan invalidation for WATCH', () => {
    const data = fixture('WATCH', 'WAIT');
    data.fullResponse!.watchPlan = {
      direction: 'long', triggerType: 'zone_reaction', trigger: 'Stored reaction',
      zoneLow: 98, zoneHigh: 99, invalidation: 94, target1: 110, target2: null, validForCandles: 8,
    };
    show(data);
    expect(screen.getByTestId('watch-changes').textContent).toContain('94.0000');
    expect(screen.getByTestId('signal-state').textContent).toContain('Watch');
  });

  it('preserves the existing guard for a contradictory legacy plan', () => {
    const data = fixture('ENTER_NOW');
    data.fullResponse!.analysis!.takeProfit1 = 90;
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} sample /></LanguageProvider>);
    expect(screen.queryByLabelText(getTranslations('en').productClarity.readingGuide)).toBeNull();
    expect(screen.getByText(getTranslations('en').analysis.result.invalidTradePlan)).toBeTruthy();
  });

  it.each(LANGUAGES.map(l => l.code))('has the complete clarity and metric distinction copy in %s', language => {
    const t = getTranslations(language);
    expect(Object.keys(t.productClarity).sort()).toEqual(Object.keys(getTranslations('en').productClarity).sort());
    for (const value of Object.values(t.productClarity)) expect(value.trim().length).toBeGreaterThan(0);
    expect(t.trackRecord.title).not.toEqual(t.verdict.statsLabel);
    expect(t.marketResult.title).not.toEqual(t.trades.winRate);
  });
});
