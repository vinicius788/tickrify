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
    // O R/R principal é o do TP1 (alvo que a /accuracy mede): 10 / 5 = 2.0,
    // não o do TP2 (20 / 5 = 4.0), que fica só na linha de baixo.
    expect(screen.getByText(t.result.rrTp1Label)).toBeTruthy();
    expect(screen.getByText('2.0 : 1')).toBeTruthy();
    expect(screen.queryByText('4.0 : 1')).toBeNull();
  });

  // Synthetic values exercise the known numeric field contract; they do not
  // claim to reproduce any of the unavailable 21 manual-review inputs.
  it.each([0, 1, 7, 8, 10, 71.43])('renders confluenceScore %s on the percentage scale', score => {
    const data = analysis(110);
    Object.assign(data.fullResponse!.analysis!, { confluenceScore: score, factorsPresent: 5 });
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    const label = screen.getByText(getTranslations('pt').analysis.confluence);
    expect(label.parentElement!.textContent).toContain(`${Math.round(score)}/100`);
    expect(label.parentElement!.textContent).not.toContain('/8');
    expect(data.fullResponse!.analysis!.confluenceScore).toBe(score);
    expect(data.fullResponse!.analysis!.factorsPresent).toBe(5);
  });

  it.each([null, '', '   '])('does not turn an absent confluence into a numeric zero: %s', score => {
    const data = analysis(110);
    Object.assign(data.fullResponse!.analysis!, { confluenceScore: score });
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    const label = screen.getByText(getTranslations('pt').analysis.confluence);
    expect(label.parentElement!.textContent).toContain('N/A');
    expect(label.parentElement!.textContent).not.toContain('0/100');
  });

  it.each([
    ['EURUSD', 1.085, 1.08395, 1.08705, 1.08905],
    ['USDJPY', 150, 149.895, 150.205, 150.405],
  ])('preserves fractional pip distances for reliably identified %s quotes', (symbol, entry, stopLoss, takeProfit1, takeProfit2) => {
    const data = analysis(110);
    const levels = { symbol, currentPrice: entry, entry, stopLoss, takeProfit1, takeProfit2 };
    Object.assign(data.fullResponse!.analysis!, levels);
    const before = JSON.stringify(data);
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    expect(screen.getByText('10.5p')).toBeTruthy();
    expect(screen.getByText('20.5p')).toBeTruthy();
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each(['XAUUSD', 'BTCUSDT', 'NAS100', 'EURUSDT'])('does not invent a forex pip size for %s', symbol => {
    const data = analysis(110);
    Object.assign(data.fullResponse!.analysis!, { symbol });
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    expect(screen.queryByText(/^\d+(?:\.\d+)?p$/)).toBeNull();
  });

  // B1 synthetic language cases: rendering never certifies confirmation or fills.
  it.each([
  [
    "en",
    "Place limit 100 only after a sweep and rejection."
  ],
  [
    "en",
    "Limit 100; preferably enter after a sweep and rejection."
  ],
  [
    "en",
    "Limit 100 after the sweep already confirmed; enter on touch."
  ],
  [
    "en",
    "Limit 100 on touch; cancel after a close below 95."
  ],
  [
    "pt",
    "Coloque limit 100 somente após varredura e rejeição."
  ],
  [
    "pt",
    "Limit 100; preferencialmente entrar após varredura e rejeição."
  ],
  [
    "pt",
    "Limit 100 após varredura já confirmada; entrar no toque."
  ],
  [
    "pt",
    "Limit 100 no toque; cancelar após fechamento abaixo de 95."
  ],
  [
    "es",
    "Orden limit 100 solo después de barrida y rechazo."
  ],
  [
    "es",
    "Limit 100; preferiblemente entrar después de barrida y rechazo."
  ],
  [
    "es",
    "Limit 100 después de barrida ya confirmada; entrar al toque."
  ],
  [
    "es",
    "Limit 100 al toque; cancelar después de cierre bajo 95."
  ],
  [
    "fr",
    "Ordre limit 100 uniquement après balayage et rejet."
  ],
  [
    "fr",
    "Limit 100; de préférence entrer après balayage et rejet."
  ],
  [
    "fr",
    "Limit 100 après balayage déjà confirmé; entrer au toucher."
  ],
  [
    "fr",
    "Limit 100 au toucher; annuler après clôture sous 95."
  ],
  [
    "de",
    "Limit 100 erst nach Sweep und Ablehnung platzieren."
  ],
  [
    "de",
    "Limit 100; vorzugsweise nach Sweep und Ablehnung einsteigen."
  ],
  [
    "de",
    "Limit 100 nach bereits bestätigtem Sweep; Einstieg bei Berührung."
  ],
  [
    "de",
    "Limit 100 bei Berührung; stornieren nach Schlusskurs unter 95."
  ],
  [
    "ja",
    "リミット100、スイープと反発の確認後のみ注文。"
  ],
  [
    "ja",
    "リミット100、できればスイープと反発の確認後に注文。"
  ],
  [
    "ja",
    "スイープは確認済み。リミット100でタッチ時に注文。"
  ],
  [
    "ja",
    "リミット100でタッチ時に注文。終値が95以下ならキャンセル。"
  ]
])('preserves LIMIT and literal conditions in %s', (language, entryCondition) => {
    window.localStorage.setItem('tickrify-language', language);
    const data = analysis(110);
    Object.assign(data.fullResponse!.analysis!, { entryType: 'limit', entryCondition });
    const before = JSON.stringify(data);
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    expect(screen.getByText('limit')).toBeTruthy();
    expect(screen.getByText(entryCondition)).toBeTruthy();
    expect(data.status).toBe('completed'); // Analysis processing, not an executed trade.
    expect(JSON.stringify(data)).toBe(before);
  });

});

// C1 synthetic fixtures; output-language coverage, not newly generated model analyses.
describe('C1 technical evidence caution presentation', () => {
  const pending = [
    ['en', 'Structure: close confirmation pending'],
    ['pt', 'Estrutura: confirmação por fechamento pendente'],
    ['es', 'Estructura: confirmación por cierre pendiente'],
    ['fr', 'Structure: confirmation par clôture en attente'],
    ['de', 'Struktur: Bestätigung per Schlusskurs ausstehend'],
    ['ja', '構造: 終値による確認待ち'],
  ] as const;
  afterEach(cleanup);
  it.each(pending)('keeps caution distinct from failure in %s', (language, text) => {
    window.localStorage.clear();
    window.localStorage.setItem('tickrify-language', language);
    const data = analysis(110);
    Object.assign(data.fullResponse!.analysis!, { factorsPresent: 5, confluenceScore: 71.43,
      structureValidation: `✅ HTF | ✅ Zone | ✅ ICT | ✅ Anti-retail | ✅ R:R | ❌ MTF | ⚠ ${text} → 5/7 → BUY` });
    const before = JSON.stringify(data);
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    const t = getTranslations(language).analysis;
    fireEvent.click(screen.getByRole('button', { name: t.technicalPanel }));
    expect(screen.getByRole('button', { name: t.marketStructure }).getAttribute('aria-expanded')).toBe('true');
    const item = screen.getByText(text.split(': ')[1]).closest('li')!;
    const marker = item.querySelector('span')!;
    expect(marker.textContent).toBe('!');
    expect(marker.className).toContain('text-[var(--signal-hold)]');
    expect(marker.className).not.toContain('text-[var(--signal-sell)]');
    expect(screen.getByText('5/7')).toBeTruthy();
    expect(JSON.stringify(data)).toBe(before);
  });
});

// C3 synthetic fixtures: aliases and target provenance, not certified market cases.
describe('C3 target labels and WAIT alias consistency', () => {
  afterEach(cleanup);
  const languages = ['en', 'pt', 'es', 'fr', 'de', 'ja'] as const;
  it.each(languages.flatMap(language => ['BUY', 'SELL'].map(side => [language, side] as const)))(
    'labels a TP2-only ratio as TP2 in %s/%s without changing levels', (language, side) => {
      window.localStorage.setItem('tickrify-language', language);
      const data = analysis(110);
      Object.assign(data, { recommendation: side });
      Object.assign(data.fullResponse!, { recommendation: side });
      Object.assign(data.fullResponse!.analysis!, { takeProfit1: null,
        stopLoss: side === 'BUY' ? 95 : 105, takeProfit2: side === 'BUY' ? 120 : 80 });
      const before = JSON.stringify(data);
      render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
      const t = getTranslations(language).analysis;
      expect(screen.getByText(t.result.rrTp1Label.replace('TP1', 'TP2'))).toBeTruthy();
      expect(screen.queryByText(t.result.rrTp1Label)).toBeNull();
      expect(screen.getByText('4.0 : 1')).toBeTruthy();
      expect(JSON.stringify(data)).toBe(before);
    },
  );
  it.each(languages)('preserves TP1 provenance when both targets exist in %s', language => {
    window.localStorage.setItem('tickrify-language', language);
    const data = analysis(110), before = JSON.stringify(data);
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    expect(screen.getByText(getTranslations(language).analysis.result.rrTp1Label)).toBeTruthy();
    expect(screen.getByText('2.0 : 1')).toBeTruthy();
    expect(JSON.stringify(data)).toBe(before);
  });
  it.each(languages.flatMap(language => ['AGUARDAR', ' wait ', 'WAIT', 'HOLD'].map(side => [language, side] as const)))(
    'keeps %s/%s as observation without an operational levels card', (language, side) => {
      window.localStorage.setItem('tickrify-language', language);
      const data = analysis(110);
      Object.assign(data, { recommendation: side });
      Object.assign(data.fullResponse!, { recommendation: side });
      const condition = 'Reassess BUY above 110 or SELL below 90; no operation authorized.';
      Object.assign(data.fullResponse!.analysis!, { entryCondition: condition });
      const before = JSON.stringify(data);
      render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
      expect(screen.queryByTestId('levels-card')).toBeNull();
      expect(screen.getByText(condition)).toBeTruthy();
      expect(JSON.stringify(data)).toBe(before);
    },
  );
});
