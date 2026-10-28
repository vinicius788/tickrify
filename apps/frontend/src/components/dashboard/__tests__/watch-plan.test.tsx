import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { AIAnalysisResponse, WatchPlan } from '@/lib/api';

vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: [], loading: false, unreliable: false }) }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));

const plan: WatchPlan = {
  direction: 'long', triggerType: 'sweep_reclaim', zoneLow: 2340, zoneHigh: 2345, invalidation: 2336,
  target1: 2362, target2: 2380, validForCandles: 12, trigger: 'A sweep of 2340 that closes back above it.',
};

type State = 'WATCH' | 'NO_TRADE' | 'ARMED' | 'ENTER_NOW';

function analysis(signalState: State, watchPlan: WatchPlan | null, extra: Record<string, unknown> = {}): AIAnalysisResponse {
  const trade = signalState === 'ARMED' || signalState === 'ENTER_NOW';
  const recommendation = trade ? 'BUY' : 'WAIT';
  return {
    id: 'a1', status: 'completed', createdAt: '2026-10-27T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z',
    recommendation, bias: 'bullish', confidence: 40,
    fullResponse: {
      recommendation, signalState, watchPlan, bias: 'bullish', confidence: 40, reasoning: 'x',
      analysis: {
        symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, executiveSummary: 'Watch 2340-2345.',
        ...(trade ? { entry: 2345, stopLoss: 2335, takeProfit1: 2360, entryType: signalState === 'ARMED' ? 'limit' : 'market' } : {}),
      },
      ...extra,
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}

const renderResult = (state: State, watchPlan: WatchPlan | null, extra: Record<string, unknown> = {}) => render(
  <LanguageProvider>
    <AnalysisResult analysisData={analysis(state, watchPlan, extra)} uploadedImage={null} />
  </LanguageProvider>,
);

describe('plano do WATCH (v10.1)', () => {
  afterEach(cleanup);

  it('mostra zona, invalidacao, alvos e gatilho, avisando que nao e sinal ativo', () => {
    renderResult('WATCH', plan);
    const card = screen.getByTestId('watch-plan');
    const text = card.textContent ?? '';
    expect(text).toContain('Not an active signal');
    expect(text).toContain('Sweep and reclaim');
    expect(text).toContain('A sweep of 2340 that closes back above it.');
    expect(text).toContain('Valid for 12 candles');
    for (const label of ['Area of interest', 'Invalidation', 'Target 1', 'Target 2']) expect(text).toContain(label);
    expect(card.innerHTML).not.toContain('--signal-buy');
    expect(screen.queryByTestId('levels-card')).toBeNull();
  });

  it('sem TP2 nao desenha a linha do alvo 2', () => {
    renderResult('WATCH', { ...plan, target2: null });
    expect(screen.getByTestId('watch-plan').textContent).not.toContain('Target 2');
  });

  it('NO_TRADE ou plano fora do formato: nada desenhado', () => {
    renderResult('NO_TRADE', plan);
    expect(screen.queryByTestId('watch-plan')).toBeNull();
    cleanup();
    renderResult('WATCH', { ...plan, zoneLow: 0 });
    expect(screen.queryByTestId('watch-plan')).toBeNull();
  });

  it('rotulo principal pelo estado; WATCH com cenario bullish nunca na cor de compra', () => {
    renderResult('WATCH', plan);
    const badge = screen.getByTestId('signal-state');
    expect(badge.textContent).toBe('Watch');
    expect(badge.className).not.toContain('--signal-buy');
    expect(document.body.textContent).toContain('Scenario: BULLISH');
    expect(document.body.textContent).not.toMatch(/hit rate|win rate|high probability/i);
  });

  it('ARMED: ordem pendente com o preco da limit e o que a cancela', () => {
    renderResult('ARMED', plan);
    expect(screen.getByTestId('signal-state').textContent).toBe('Pending order');
    const order = screen.getByTestId('pending-order').textContent ?? '';
    expect(order).toContain('Limit order at $ 2,345.00');
    expect(order).toContain('a candle closes beyond $ 2,336.00');
    expect(order).toContain('price reaches $ 2,362.00 before the order fills');
    expect(order).toContain('it does not fill within 12 candles');
    expect(screen.queryByTestId('watch-plan')).toBeNull();
  });

  it('ENTER_NOW: entrar agora, sem bloco de ordem pendente', () => {
    renderResult('ENTER_NOW', null);
    expect(screen.getByTestId('signal-state').textContent).toBe('Enter now');
    expect(screen.queryByTestId('pending-order')).toBeNull();
  });

  it('sem velas reais (dataMode print): avisa que os niveis sao estimados do print', () => {
    renderResult('ARMED', plan, { dataMode: 'print' });
    expect(screen.getByTestId('levels-estimated').textContent).toBe('Levels estimated from the screenshot');
    cleanup();
    renderResult('WATCH', plan, { dataMode: 'print' });
    expect(screen.getByTestId('watch-plan').textContent).toContain('Levels estimated from the screenshot');
    cleanup();
    renderResult('ARMED', plan, { dataMode: 'real_data' });
    expect(screen.queryByTestId('levels-estimated')).toBeNull();
  });

  it('historico antigo sem estado: deriva pela recomendacao e pelo tipo de entrada', () => {
    renderResult('ARMED', null, { signalState: undefined });
    expect(screen.getByTestId('signal-state').textContent).toBe('Pending order');
  });
});
