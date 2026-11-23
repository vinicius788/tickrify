import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult, { stripContradictingActions } from '@/components/dashboard/AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { buildCodeSummaryText, type CodeSummaryTexts } from '@/lib/code-summary';
import en from '@/lib/i18n/en';
import pt from '@/lib/i18n/pt';
import es from '@/lib/i18n/es';
import fr from '@/lib/i18n/fr';
import de from '@/lib/i18n/de';
import ja from '@/lib/i18n/ja';
import type { AIAnalysisResponse, CodeSummary } from '@/lib/api';

vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: [], loading: false, unreliable: false }) }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useAlertOptions: () => ({ isLoading: false, isError: false, data: { available: false } }),
  useSetupForAnalysis: () => ({ data: { setup: null } }),
  useSetupAlerts: () => ({ data: { items: [] } }),
  useSetupActions: () => ({ follow: { mutate: vi.fn(), isPending: false }, setStatus: { mutate: vi.fn(), isPending: false } }),
  useAlertActions: () => ({ create: { mutate: vi.fn(), isPending: false }, cancel: { mutate: vi.fn(), isPending: false }, seen: { mutate: vi.fn() } }),
}));

const fmt = (v: number | null) => String(v);
const base: CodeSummary = { action: 'wait', waitReason: null, entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null, level: null, turnsBuyAbove: 1.1, turnsSellBelow: 1.05, flippedFromPrior: false };
const texts = (l: { analysis: { result: { codeSummary: unknown } } }) => l.analysis.result.codeSummary as CodeSummaryTexts;

const REASONS = ['neutral_direction', 'conflicting_direction', 'no_geometry', 'no_majority', 'news_event', 'stale_print', 'no_data', 'veto_news', 'veto_structure_broken', 'veto_stale_print', 'veto_not_a_chart', 'veto_unclear_chart', 'veto_conflicting_signals'];

describe('resumo montado pelo codigo', () => {
  it.each(REASONS)('waitReason %s: motivo + o que viraria operacao, nos 6 idiomas', (reason) => {
    for (const lang of [en, pt, es, fr, de, ja]) {
      const { text } = buildCodeSummaryText({ ...base, waitReason: reason }, texts(lang), fmt);
      expect(text).toContain(texts(lang).reasons[reason]);
      expect(text).toContain('1.1');
      expect(text).toContain('1.05');
      expect(text).not.toContain('{');
    }
  });

  it('compra agora, recuo e rompimento com os numeros finais', () => {
    const now = buildCodeSummaryText({ ...base, action: 'buy_now', entry: 100, stopLoss: 98, takeProfit1: 103, takeProfit2: 105 }, texts(en), fmt).text;
    expect(now).toBe('Buy now at 100. Stop 98. Target 1 103. Target 2 105.');
    const pull = buildCodeSummaryText({ ...base, action: 'sell_pullback', entry: 100, level: 101, stopLoss: 102, takeProfit1: 97 }, texts(en), fmt).text;
    expect(pull).toContain('Sell on pullback: wait for price to return to 101 and enter at 100.');
    const brk = buildCodeSummaryText({ ...base, action: 'buy_breakout', entry: 101, level: 100.9, stopLoss: 99, takeProfit1: 104, flippedFromPrior: true }, texts(en), fmt).text;
    expect(brk).toContain('only after a candle closes above 100.9');
    expect(brk).toContain('direction flipped');
  });

  it('numero nulo cai no rotulo, nunca em chave solta', () => {
    expect(buildCodeSummaryText({ ...base, action: 'buy_breakout' }, texts(pt), fmt).text).toBe('Comprar no rompimento.');
  });
});

describe('stripContradictingActions: agora', () => {
  it.each([
    ['Momentum fades. Sell now before the drop.', 'Momentum fades.'],
    ['Tendência fraca. Vender agora é melhor.', 'Tendência fraca.'],
    ['Precio débil. Comprar ahora con stop corto.', 'Precio débil.'],
    ['Tendance faible. Acheter maintenant serait risqué.', 'Tendance faible.'],
    ['Schwacher Trend. Jetzt verkaufen ist ideal.', 'Schwacher Trend.'],
    ['トレンドは弱いです。今すぐ売りです。', 'トレンドは弱いです。'],
  ])('%s', (input, expected) => {
    expect(stripContradictingActions(input)).toBe(expected);
  });
});

function fixture(extra: Record<string, unknown>, state = 'NO_TRADE'): AIAnalysisResponse {
  const prose = 'Bearish pressure is clear. Sell now at 1.0850 with a stop above 1.0900.';
  return {
    id: 'v4', status: 'completed', createdAt: '2026-11-23T10:00:00Z', updatedAt: '2026-11-23T10:00:00Z', recommendation: 'WAIT', bias: 'neutral', confidence: 40,
    fullResponse: {
      recommendation: 'WAIT', signalState: state, bias: 'neutral', confidence: 40, reasoning: prose, dataMode: 'real_data',
      analysis: { symbol: 'EURUSD', timeframe: 'M15', currentPrice: 1.0865, executiveSummary: prose, technicalAnalysis: prose, reasoning: prose },
      ...extra,
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}
const show = (d: AIAnalysisResponse) => render(<LanguageProvider><MemoryRouter><AnalysisResult analysisData={d} uploadedImage={null} /></MemoryRouter></LanguageProvider>);

describe('tela com codeSummary', () => {
  afterEach(cleanup);

  it('V4: NO_TRADE com prosa "sell now": o resumo e o do codigo, sem a ordem do modelo', () => {
    const view = fixture({
      validatorNotes: [{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'no_valid_geometry' }],
      codeSummary: { ...base, waitReason: 'no_geometry', turnsBuyAbove: 1.09, turnsSellBelow: 1.08 },
    });
    show(view);
    const summaryText = document.body.textContent ?? '';
    expect(summaryText).toContain('Wait. No entry fits the risk rules right now.');
    expect(summaryText).toContain('A candle close above');
    expect(screen.getByTestId('signal-state').textContent).toBe('Wait');
  });

  it('selo Strong read so com os 3 leitores de acordo; rompimento mostra o rotulo', () => {
    const cs = { ...base, action: 'buy_breakout', entry: 1.0875, level: 1.087, stopLoss: 1.083, takeProfit1: 1.094 };
    show(fixture({ codeSummary: cs, engine: { vote: { agreement: '3/3', strongRead: true } } }, 'WATCH'));
    expect(screen.getByTestId('strong-read').textContent).toBe('Strong read');
    expect(screen.getByTestId('signal-state').textContent).toBe('Buy on breakout');
    cleanup();
    show(fixture({ codeSummary: cs, engine: { vote: { agreement: '2/3', strongRead: false } } }, 'WATCH'));
    expect(screen.queryByTestId('strong-read')).toBeNull();
  });

  it('"What the AI saw": so dados presentes; volume so com dado; colunas por lado', () => {
    show(fixture({
      candleBias: { direction: 'long', score: 2, structure: 'up', htfTrend: 'uptrend', vsEma50: 'below', htfVsEma50: null, stretched: false, rsi14: 41.2, relVolumeLast: null },
      evidence: { version: 1, additionalChartsDelivered: 0, candleFeedAttached: true, marketContextAttached: true, calendar: 'not_attached' },
      codeSummary: base,
    }));
    const box = screen.getByTestId('what-ai-saw').textContent ?? '';
    expect(box).toContain('4h trend');
    expect(box).toContain('RSI(14)41');
    expect(box).not.toContain('Volume');
    expect(box).toContain('Not attached');
    expect(screen.getByTestId('ai-saw-buy').textContent).toContain('The 4h trend is up.');
    expect(screen.getByTestId('ai-saw-sell').textContent).toContain('Price is below the EMA50.');
  });

  it('sem velas reais o bloco nao aparece', () => {
    show(fixture({ dataMode: 'print', candleBias: { direction: 'long', score: 2, structure: 'up', htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: null, stretched: false }, codeSummary: base }));
    expect(screen.queryByTestId('what-ai-saw')).toBeNull();
  });
});
