import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AnalysisEvidencePanel } from '../AnalysisEvidencePanel';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations, type Language } from '@/lib/i18n';

const show = (evidence: unknown) => render(
  <LanguageProvider><AnalysisEvidencePanel evidence={evidence} /></LanguageProvider>,
);

describe('AnalysisEvidencePanel', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('shows only data delivered to the model and states that screenshot time is unknown', () => {
    show({
      version: 1, additionalChartsDelivered: 1,
      candleFeedAttached: false, marketContextAttached: true,
      calendar: 'no_events_returned',
    });
    expect(within(screen.getByText('Chart images:').parentElement!).getByText('2')).toBeTruthy();
    expect(within(screen.getByText('Additional charts:').parentElement!).getByText('1')).toBeTruthy();
    expect(within(screen.getByText('Current candles:').parentElement!).getByText('Not attached')).toBeTruthy();
    expect(within(screen.getByText('Current market context:').parentElement!).getByText('Attached')).toBeTruthy();
    expect(screen.getByText('Source returned no events')).toBeTruthy();
    expect(screen.getByText('Current data does not establish when the screenshot was captured.')).toBeTruthy();
  });

  it('does not invent source coverage for responses without a record', () => {
    show(undefined);
    expect(screen.getByText('Input coverage was not recorded for this analysis.')).toBeTruthy();
    expect(screen.queryByText('Current candles:')).toBeNull();
  });

  it('has every evidence label in each supported language', () => {
    const keys = [
      'evidenceTitle', 'evidenceCharts', 'evidenceAdditionalCharts', 'evidenceCandles',
      'evidenceMarketContext', 'evidenceCalendar', 'evidenceAttached', 'evidenceNotAttached',
      'evidenceEventsAttached', 'evidenceNoEventsReturned', 'evidenceNotConfirmed',
      'evidenceTimeNote', 'evidenceLegacy', 'mtfEvidenceWarning',
    ] as const;
    for (const language of ['pt', 'en', 'es', 'fr', 'de', 'ja'] as Language[]) {
      const translations = getTranslations(language).analysis;
      for (const key of keys) expect(translations[key]).toBeTruthy();
    }
  });
});
