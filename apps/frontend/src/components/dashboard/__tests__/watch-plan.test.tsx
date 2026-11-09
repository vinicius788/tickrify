import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import { spreadLabels } from '@/components/dashboard/WatchPlanChart';
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
    expect(text).toContain('This is a level to watch, not a signal. The entry only counts if price gets there.');
    expect(text).not.toMatch(/limit/i);
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

  it('ENTER_NOW: entrar agora com a direcao, sem bloco de ordem pendente', () => {
    renderResult('ENTER_NOW', null);
    expect(screen.getByTestId('signal-state').textContent).toBe('Buy now');
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

describe('continuacao do setup', () => {
  afterEach(cleanup);
  const line = () => screen.queryByTestId('setup-continuation')?.textContent ?? null;

  it.each([
    ['long', 'CONFIRMED', 'Buy', 'Confirmed'],
    ['long', 'STILL_WAITING', 'Buy', 'Still waiting'],
    ['short', 'CHANGED', 'Sell', 'Changed'],
    ['short', 'INVALIDATED', 'Sell', 'Invalidated'],
  ])('%s %s', (direction, status, side, label) => {
    renderResult('WATCH', plan, { continuation: { setupId: 's', priorAnalysisId: 'p', status, direction, level: 2345 } });
    expect(line()).toBe(`Earlier plan: ${side} at $ 2,345.00. Now: ${label}`);
  });

  it('sem status ou sem continuacao, a linha nao aparece', () => {
    renderResult('WATCH', plan, { continuation: { setupId: 's', priorAnalysisId: 'p', status: null, direction: 'long', level: 2345 } });
    expect(line()).toBeNull();
    cleanup();
    renderResult('WATCH', plan);
    expect(line()).toBeNull();
  });
});

describe('modo leitura: Read, Where price is e Action em toda analise', () => {
  afterEach(cleanup);
  const location = {
    price: 2351, atr: 4, rangePosPct: 72, htfTrend: 'uptrend',
    invalidation: { price: 2336, atr: 3.75 }, support: { price: 2345, atr: 1.5 }, resistance: { price: 2362, atr: 2.75 }, planLevel: { price: 2345, atr: 1.5 },
  };

  it('ENTER_NOW: leitura, distancias em ATR, niveis e a invalidacao estrutural em linha propria', () => {
    renderResult('ENTER_NOW', plan, { location, dataMode: 'real_data', analysis: {
      symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, trendStrength: 'strong',
      executiveSummary: 'Bullish and strong: buyers defend 2345. Enter now.', entry: 2351, stopLoss: 2335, takeProfit1: 2362, entryType: 'market',
    } });
    const text = screen.getByTestId('read-mode').textContent ?? '';
    expect(text).toContain('Bullish, strong');
    expect(text).toContain('Bullish and strong: buyers defend 2345.');
    expect(text).toContain('72% of the recent range');
    expect(text).toContain('3.8 ATR away');
    expect(text).toContain('4h trend');
    expect(text).toContain('Idea invalid if a candle closes below $ 2,336.00');
    expect(screen.queryByTestId('read-mode-estimated')).toBeNull();
  });

  it('WATCH: o nivel e a condicao que destravam, e a chance calibrada quando existe', () => {
    renderResult('WATCH', plan, { location, dataMode: 'real_data', watchReach: { probability: 0.42, candles: 12 } });
    const text = screen.getByTestId('read-mode').textContent ?? '';
    expect(text).toContain('Unlocks if price reaches $ 2,345.00: A sweep of 2340 that closes back above it.');
    expect(screen.getByTestId('read-mode-reach').textContent).toBe('About 42% chance price reaches this level within 12 candles');
    cleanup();
    renderResult('WATCH', plan, { location, dataMode: 'real_data' });
    expect(screen.queryByTestId('read-mode-reach')).toBeNull();
  });

  it('sem REAL DATA: o aviso de niveis estimados no lugar das distancias', () => {
    renderResult('WATCH', plan, { dataMode: 'print' });
    expect(screen.getByTestId('read-mode-estimated').textContent).toBe('Levels estimated from the screenshot');
  });

  it('API antiga (v10.3) e historico: sem location, watchReach, trendStrength nem contrato, a tela abre sem inventar', () => {
    // Velas reais sem location: nada de "estimated from the screenshot".
    renderResult('WATCH', plan, { dataMode: 'real_data' });
    let text = screen.getByTestId('read-mode').textContent ?? '';
    expect(text).toContain('Bullish');
    expect(text).toContain('Unlocks if price reaches $ 2,345.00');
    expect(text).not.toContain('ATR away');
    expect(screen.queryByTestId('read-mode-estimated')).toBeNull();
    expect(screen.queryByTestId('read-mode-reach')).toBeNull();
    cleanup();
    // ARMED do v10.3 continua mostrando os niveis gravados.
    renderResult('ARMED', plan, { dataMode: 'real_data' });
    text = screen.getByTestId('read-mode').textContent ?? '';
    expect(text).toContain('Pending order');
    expect(text).toContain('$ 2,345.00');
    cleanup();
    // NO_TRADE sem contrato do motor: a primeira frase da leitura.
    renderResult('NO_TRADE', null, { dataMode: 'real_data' });
    expect(screen.getByTestId('read-mode').textContent).toContain('Watch 2340-2345.');
    cleanup();
    // Historico de antes do estado e do dataMode.
    renderResult('ENTER_NOW', null, { signalState: undefined, dataMode: undefined });
    expect(screen.getByTestId('read-mode')).toBeTruthy();
    expect(screen.queryByTestId('read-mode-estimated')).toBeNull();
  });

  it('NO_TRADE: o motivo em uma linha, do contrato do motor', () => {
    renderResult('NO_TRADE', null, { engine: { contract: { no_trade_reason: 'There is no complete setup.' } } });
    const text = screen.getByTestId('read-mode').textContent ?? '';
    expect(text).toContain('No trade');
    expect(text).toContain('There is no complete setup.');
    expect(text).not.toMatch(/hit rate|win rate|high probability/i);
  });

  it('com watchLevels: alvos do motor (TP1 com teto e o R) no grafico e no C6, sem o calculo do modelo', () => {
    const watchLevels = { entry: 2345, stopLoss: 2334.5, takeProfit1: 2360.75, takeProfit2: 2380, tp1R: 1.5, riskAtr: 1.05 };
    renderResult('WATCH', plan, {
      watchLevels,
      analysis: {
        symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, executiveSummary: 'Watch 2340-2345.',
        structureValidation: 'C1 PASS: H1. C2 PASS: discount. C3 PASS: sweep. C4 PASS: control. C5 PASS: fresh. C6 PASS: limit 2345, Rk48, TP1 2362 gives 3.4R. C7 FAIL: support. 6/7, WATCH.',
      },
    });
    const card = screen.getByTestId('watch-plan').textContent ?? '';
    expect(card).toContain('Target 1 (1.5R) $ 2,360.75');
    expect(card).not.toContain('$ 2,362.00');
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('If price reaches $ 2,345.00: stop $ 2,334.50, TP1 $ 2,360.75 (1.5R).');
    expect(body).not.toContain('Rk48');
    expect(body).not.toContain('3.4R');
  });

  it('analise antiga sem watchLevels: alvos e C6 como o modelo escreveu', () => {
    renderResult('WATCH', plan, {
      analysis: {
        symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, executiveSummary: 'Watch 2340-2345.',
        structureValidation: 'C1 PASS: a. C2 PASS: b. C3 PASS: c. C4 PASS: d. C5 PASS: e. C6 PASS: limit 2345, Rk48, TP1 2362 gives 3.4R. C7 FAIL: f. 6/7, WATCH.',
      },
    });
    expect(screen.getByTestId('watch-plan').textContent).toContain('Target 1 $ 2,362.00');
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    expect(document.body.textContent).toContain('Rk48');
  });

  it('rotulos de niveis a menos de 1 ATR se afastam; linhas ficam onde estao', () => {
    const ys = spreadLabels([60, 62, 140]);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(13);
    expect(ys[2]).toBe(140);
    const low = spreadLabels([160, 162, 165]);
    expect(Math.max(...low)).toBeLessThanOrEqual(166);
    expect(low[1] - low[0]).toBeGreaterThanOrEqual(13);
    expect(low[2] - low[1]).toBeGreaterThanOrEqual(13);
    // No grafico: invalidacao 2336 colada na area (2340-2345) com o alvo longe.
    renderResult('WATCH', { ...plan, invalidation: 2339.9, target1: 2420, target2: null });
    const texts = [...screen.getByTestId('watch-plan').querySelectorAll('svg text')];
    const zone = texts.find((n) => n.textContent?.startsWith('Area of interest'))!;
    const inv = texts.find((n) => n.textContent?.startsWith('Invalidation'))!;
    expect(Math.abs(Number(zone.getAttribute('y')) - Number(inv.getAttribute('y')))).toBeGreaterThanOrEqual(13);
    // A linha da invalidacao fica no preco (o fundo do desenho); so o rotulo sai do lugar.
    const invLine = [...screen.getByTestId('watch-plan').querySelectorAll('svg line')][0];
    expect(Number(invLine.getAttribute('y1'))).toBeCloseTo(168 - 14, 6);
  });

  it('modelo diz WATCH e o codigo decidiu NO_TRADE: so o estado do codigo aparece, o checklist fica sem rotulo de estado', () => {
    renderResult('NO_TRADE', null, {
      validatorNotes: [{ from: 'WATCH', to: 'NO_TRADE', reason: 'invalidation_unsnapped' }],
      analysis: {
        symbol: 'XAUUSD', timeframe: '5M', currentPrice: 3934, executiveSummary: 'No trade.',
        structureValidation: 'C1 PASS: a. C2 PASS: b. C3 PASS: c. C4 PASS: d. C5 PASS: e. C6 PASS: f. C7 FAIL: g. 6/7 WATCH',
      },
    });
    expect(screen.getByTestId('signal-state').textContent).toBe('No trade');
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('6/7');
    expect(body).not.toMatch(/6\/7\s*·?\s*WATCH/);
    expect(body).not.toContain('WATCH');
  });

  it('validador recusou o plano: "AI level" com o preco e resumo sem falar do plano recusado', () => {
    renderResult('NO_TRADE', null, {
      dataMode: 'print',
      aiLevel: { price: 4100 },
      validatorNotes: [{ from: 'WATCH', to: 'NO_TRADE', reason: 'no_valid_geometry' }],
    });
    expect(screen.getByTestId('ai-level').textContent).toContain('AI level');
    expect(screen.getByTestId('ai-level').textContent).toContain('4,100.00');
    const body = document.body.textContent ?? '';
    expect(body).toContain('The AI saw a possible setup, but it did not pass the risk check.');
    expect(body).not.toContain('Watch 2340-2345.');
  });

  it('rebaixado por risco: linha da decisao final acima do resumo e frase de acao do modelo fora da tela', () => {
    renderResult('NO_TRADE', null, {
      dataMode: 'real_data',
      aiLevel: { price: 4100, direction: 'long', invalidation: 4080, validForCandles: 12, reason: 'no_valid_geometry' },
      validatorNotes: [{ from: 'WATCH', to: 'NO_TRADE', reason: 'no_valid_geometry' }],
      analysis: { symbol: 'XAUUSD', timeframe: '5M', currentPrice: 4120, executiveSummary: 'Price is holding above support. Buy at 4,100 with a stop below 4,080.' },
    });
    expect(screen.getByTestId('final-decision').textContent).toBe('Final decision: No trade. Reason: the distance to the stop or to the target does not fit our risk rules.');
    expect(screen.getByTestId('ai-level').textContent).toContain('The AI saw a possible buy at');
    const body = document.body.textContent ?? '';
    expect(body).toContain('Price is holding above support.');
    expect(body).not.toContain('Buy at 4,100');
  });

  it('o proprio modelo disse NO_TRADE: resumo do modelo e nenhum "AI level"', () => {
    renderResult('NO_TRADE', null, { validatorNotes: [] });
    expect(screen.queryByTestId('ai-level')).toBeNull();
    expect(document.body.textContent).toContain('Watch 2340-2345.');
  });

  it('imagem do grafico com o texto alternativo no idioma da tela', () => {
    render(
      <LanguageProvider>
        <AnalysisResult analysisData={{ ...analysis('WATCH', plan), imageUrl: 'https://example.com/chart.png' } as AIAnalysisResponse} uploadedImage={null} />
      </LanguageProvider>,
    );
    expect(screen.getByAltText('Analyzed chart')).toBeTruthy();
    expect(screen.queryByAltText('Gráfico analisado')).toBeNull();
  });

  it.each([
    ['long', 'BUY', 'Buy now', { entry: 2345, stopLoss: 2335, takeProfit1: 2360 }],
    ['short', 'SELL', 'Sell now', { entry: 2345, stopLoss: 2355, takeProfit1: 2330 }],
  ] as const)('ENTER_NOW %s: "%s" vira "%s" no titulo e no bloco Action', (direction, recommendation, label, levels) => {
    const sellPlan: WatchPlan = { ...plan, direction, invalidation: direction === 'long' ? 2336 : 2354, target1: direction === 'long' ? 2362 : 2328, target2: null };
    const data = analysis('ENTER_NOW', sellPlan);
    Object.assign(data, { recommendation });
    Object.assign(data.fullResponse!, { recommendation, analysis: { ...data.fullResponse!.analysis, ...levels, entryType: 'market' } });
    render(<LanguageProvider><AnalysisResult analysisData={data} uploadedImage={null} /></LanguageProvider>);
    expect(screen.getByTestId('signal-state').textContent).toBe(label);
    expect(screen.getByTestId('read-mode-action').textContent).toBe(label);
    expect(document.body.textContent).not.toContain('Enter now');
  });

  it('motor rejeitou a geometria do WATCH (watchLevels null com velas reais): sem alvos nem R, so nivel e invalidacao', () => {
    // Entrada no nivel igual a invalidacao: entryLevels devolve wrong_side e o motor grava null.
    renderResult('WATCH', { ...plan, zoneLow: 2336, zoneHigh: 2336, invalidation: 2336 }, {
      dataMode: 'real_data',
      watchLevels: null,
      analysis: {
        symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, executiveSummary: 'Watch.',
        structureValidation: 'C1 PASS: a. C2 PASS: b. C3 PASS: c. C4 PASS: d. C5 PASS: e. C6 PASS: limit 2336, Rk48, TP1 2362 gives 3.4R. C7 FAIL: g. 6/7 WATCH',
      },
    });
    const card = screen.getByTestId('watch-plan').textContent ?? '';
    expect(screen.getByTestId('targets-rejected').textContent).toBe('The targets did not pass the risk check, so none are shown.');
    expect(card).not.toContain('Target 1');
    expect(card).not.toContain('Target 2');
    expect(card).not.toMatch(/\dR\)/);
    expect(card).toContain('Invalidation');
    expect(card).toContain('Area of interest');
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('Rk48');
    expect(body).not.toContain('3.4R');
  });

  it('campo ausente (analise antiga) e WATCH sem velas reais seguem com os alvos do modelo', () => {
    renderResult('WATCH', plan, { dataMode: 'real_data' });
    expect(screen.getByTestId('watch-plan').textContent).toContain('Target 1 $ 2,362.00');
    expect(screen.queryByTestId('targets-rejected')).toBeNull();
    cleanup();
    renderResult('WATCH', plan, { dataMode: 'print', watchLevels: null });
    expect(screen.getByTestId('watch-plan').textContent).toContain('Target 1 $ 2,362.00');
    expect(screen.queryByTestId('targets-rejected')).toBeNull();
  });

  it('cauda de direcao do modelo sem placar ("MTF 2/3 → SELL") some do checklist quando o codigo decidiu WATCH', () => {
    renderResult('WATCH', plan, {
      analysis: {
        symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2351, executiveSummary: 'Watch.',
        structureValidation: '✅ HTF 1H LH/LL | ✅ Premium $4308 | ✅ OB $4305-15 | ✅ No bullish confirmation | ✅ Bearish BOS | ✅ R:R 1:2.3 | ✅ MTF 2/3 → SELL',
      },
    });
    expect(screen.getByTestId('signal-state').textContent).toBe('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('MTF 2/3');
    expect(body).not.toContain('SELL');
  });
});

