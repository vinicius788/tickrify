import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const REASONS = ['neutral_direction', 'conflicting_direction', 'no_geometry', 'no_majority', 'against_trend', 'news_event', 'stale_print', 'no_data', 'veto_news', 'veto_structure_broken', 'veto_stale_print', 'veto_not_a_chart', 'veto_unclear_chart', 'veto_conflicting_signals'];

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

  it('plano anterior sob pressao: frase propria nos 6 idiomas', () => {
    for (const lang of [en, pt, es, fr, de, ja]) {
      const { text } = buildCodeSummaryText({ ...base, priorUnderPressure: true }, texts(lang), fmt);
      expect(text).toContain(texts(lang).underPressure);
      const plain = buildCodeSummaryText(base, texts(lang), fmt).text;
      expect(plain).not.toContain(texts(lang).underPressure);
    }
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

  it('XAUUSD cmww3tjdx: nenhum leitor bate com a decisao (displayReader null): so o resumo do codigo, sem prosa nem checklist do modelo', async () => {
    const cs = { ...base, action: 'sell_now', entry: 2650, stopLoss: 2655, takeProfit1: 2642.5 };
    const model = { analysis: { symbol: 'XAUUSD', timeframe: '5m', currentPrice: 2650, technicalAnalysis: 'No valid entry now; wait.', executiveSummary: 'No valid entry now; wait.', structureValidation: 'C1 FAIL: a; C2 FAIL: b; C3 PASS: c. 2/7', marketStructure: { bias: 'neutral', lastStructure: 'Range without direction' } } };
    const open = async () => fireEvent.click(screen.getByRole('button', { name: en.analysis.technicalPanel }));
    show(fixture({ ...model, codeSummary: cs, engine: { vote: { agreement: '1/3', decidedBy: 'candle_bias' }, displayReader: null } }, 'ENTER_NOW'));
    expect(screen.getByTestId('readers-disagreed').textContent).toBe('Readers disagreed; this decision comes from the candle structure.');
    await open();
    const hidden = document.body.textContent ?? '';
    expect(hidden).not.toContain('No valid entry now');
    expect(hidden).not.toContain('2/7');
    expect(hidden).not.toContain('Range without direction');
    cleanup();
    show(fixture({ ...model, codeSummary: cs, engine: { vote: { agreement: '2/3' }, displayReader: 'openai-2' } }, 'ENTER_NOW'));
    expect(screen.queryByTestId('readers-disagreed')).toBeNull();
    await open();
    expect(document.body.textContent).toContain('No valid entry now');
    cleanup();
    // Analise antiga (sem displayReader): nada muda.
    show(fixture({ ...model, codeSummary: cs, engine: { vote: { agreement: '1/3' } } }, 'ENTER_NOW'));
    expect(screen.queryByTestId('readers-disagreed')).toBeNull();
  });

  it('a linha "readers disagreed" existe nos 6 idiomas, sem travessao', () => {
    for (const lang of [en, pt, es, fr, de, ja]) {
      const line = (texts(lang) as unknown as { readersDisagreed: string }).readersDisagreed;
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/[\u2014\u2013]/);
    }
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

  it('"What the AI saw": usa o tempo grafico da direcao e mostra a escada', () => {
    const bias = { direction: 'long', score: 2, structure: 'up', htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: 'above', stretched: false } as const;
    show(fixture({ candleBias: { ...bias, timeframes: { chart: '5m', direction: '1h', setup: '15m' } }, codeSummary: base }));
    const box = screen.getByTestId('what-ai-saw').textContent ?? '';
    expect(box).toContain('1h trend');
    expect(box).not.toContain('4h');
    expect(box).toContain('Chart 5m, direction 1h, setup 15m');
    expect(screen.getByTestId('ai-saw-buy').textContent).toContain('The 1h trend is up.');
    expect(box).toContain('above it on the 1h');
    cleanup();
    show(fixture({ candleBias: { ...bias }, codeSummary: base }));
    const old = screen.getByTestId('what-ai-saw').textContent ?? '';
    expect(old).toContain('4h trend');
    expect(old).not.toContain('Timeframes');
  });

  it('sem velas reais o bloco nao aparece', () => {
    show(fixture({ dataMode: 'print', candleBias: { direction: 'long', score: 2, structure: 'up', htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: null, stretched: false }, codeSummary: base }));
    expect(screen.queryByTestId('what-ai-saw')).toBeNull();
  });
});
