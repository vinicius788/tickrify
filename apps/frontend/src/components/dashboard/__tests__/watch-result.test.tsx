import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import { buildReadCard } from '@/lib/share-card';
import { formatAssetDistance, formatAssetPrice } from '@/lib/trading-ui';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { AIAnalysisResponse, WatchPlan, WatchSummary } from '@/lib/api';

let calEvents: Array<Record<string, unknown>> = [];
vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: calEvents, loading: false, unreliable: false }) }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));

let options: Record<string, unknown>;
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useAlertOptions: () => ({ isLoading: false, isError: false, data: options }),
  useSetupForAnalysis: () => ({ data: { setup: null } }),
  useSetupAlerts: () => ({ data: { items: [] } }),
  useSetupActions: () => ({ follow: { mutate: vi.fn(), isPending: false }, setStatus: { mutate: vi.fn(), isPending: false } }),
  useAlertActions: () => ({ create: { mutate: vi.fn(), isPending: false }, cancel: { mutate: vi.fn(), isPending: false }, seen: { mutate: vi.fn() } }),
}));

const long: WatchPlan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 27710, zoneHigh: 27730, invalidation: 27650,
  target1: 27880, target2: 27910, validForCandles: 16,
  trigger: 'Watch 27710-27730 for a bullish reaction; enter only if no candle closes below 27650.',
};
const short: WatchPlan = { ...long, direction: 'short', zoneLow: 27930, zoneHigh: 27950, invalidation: 28010, target1: 27780, target2: 27740, trigger: 'Reject 27930.' };
const levels = { entry: 27720, stopLoss: 27644, takeProfit1: 27880, takeProfit2: 27910, tp1R: 2.1, riskAtr: 1.2 };
const created = '2026-11-09T18:03:34Z';
const summary: WatchSummary = {
  direction: 'long', level: 27730, invalidation: 27650, validForCandles: 16, expiresAt: '2026-11-09T19:23:34Z',
  outcome: 'pending', afterReach: null, alertAvailable: true, setupId: null, plan: null,
};
const executiveSummary = 'Bullish but moderate on M5 and the rally is late.';

function result(watchPlan: WatchPlan, extra: Record<string, unknown> = {}, watch: WatchSummary | null = summary, symbol = 'NAS100'): AIAnalysisResponse {
  return {
    id: 'a1', status: 'completed', createdAt: created, updatedAt: created, recommendation: 'WAIT', bias: 'bullish', confidence: 40, watch,
    fullResponse: {
      recommendation: 'WAIT', signalState: 'WATCH', watchPlan, bias: 'bullish', confidence: 40, reasoning: executiveSummary,
      analysis: {
        symbol, timeframe: 'M5', currentPrice: watchPlan.direction === 'long' ? 27832 : 27832, executiveSummary, reasoning: executiveSummary, technicalAnalysis: executiveSummary,
        alternativeScenario: 'A close below 27650 invalidates the continuation idea. A clean close above 27910 would reopen upside continuation after a hold.',
        riskFactors: 'H1/H4 bearish alignment; M5 move is late; 27880-27910 resistance is nearby.',
        structureValidation: 'C1 PASS: a. C2 PASS: b. C3 PASS: c. C4 PASS: d. C5 PASS: e. C6 PASS: f. C7 FAIL: market entry has limited room to 27880. 6/7, WATCH.',
      },
      ...extra,
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}

const show = (data: AIAnalysisResponse, alertsEnabled = true) => render(
  <LanguageProvider><MemoryRouter><AnalysisResult analysisData={data} uploadedImage={null} alertsEnabled={alertsEnabled} /></MemoryRouter></LanguageProvider>,
);
const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('resultado do WATCH', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-09T18:03:34Z'), toFake: ['Date'] });
    calEvents = [];
    options = { available: true, suggestions: [{ label: 'entry', level: 27730 }], alerts: [], watchAlert: null, setupId: null, emailEnabled: true, limits: { maxSetups: 10, perSetup: 3 } };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('compra com watchLevels: chip, linha, quatro numeros, condicao, distancia e validade', () => {
    show(result(long, { watchLevels: levels, dataMode: 'real_data' }));
    expect(text('signal-state')).toBe('Watch for a buy');
    expect(document.body.textContent).not.toContain('Scenario:');
    expect(text('watch-headline')).toBe('No entry at 27,832. Wait for a pullback to 27,710 to 27,730.');
    const card = text('watch-plan');
    expect(card).toContain('Plan if price reaches 27,710 to 27,730');
    expect(text('watch-numbers')).toBe('Buy at27,720Stop27,644Target 127,880(2.1R)Target 227,910');
    expect(text('watch-condition')).toBe('Enter only if no candle closes below 27650.');
    expect(text('watch-timing')).toBe('Price is 102 points above the zone · Valid until 19:23 UTC (1h 20m)');
    expect(card).not.toContain('$');
    expect(card).not.toContain('candles');
    expect(card).not.toContain('--signal-buy');
  });

  it('a escada traz rotulo inteiro, preco, stop e R nos alvos', () => {
    show(result(long, { watchLevels: levels, dataMode: 'real_data' }));
    const rows = [...screen.getByTestId('watch-ladder').querySelectorAll<HTMLElement>('[data-kind]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Target 227,9102.5R', 'Target 127,8802.1R', 'Price27,832', 'Zone27,710 to 27,730', 'Stop27,644',
    ]);
    const tops = rows.map((row) => parseFloat(row.style.top));
    expect(Math.min(...tops)).toBe(10);
    expect(Math.max(...tops)).toBe(186);
  });

  it('venda: chip, linha e rotulos de venda', () => {
    show(result(short, { watchLevels: { ...levels, entry: 27940, stopLoss: 28016, takeProfit1: 27780, takeProfit2: null }, dataMode: 'real_data' }, { ...summary, direction: 'short', level: 27930 }));
    expect(text('signal-state')).toBe('Watch for a sell');
    expect(text('watch-headline')).toBe('No entry at 27,832. Wait for a rally to 27,930 to 27,950.');
    expect(text('watch-numbers')).toContain('Sell at27,940');
    expect(text('watch-timing')).toContain('Price is 98 points below the zone');
    expect(text('watch-changes')).toContain('Cancelled if:a M5 candle closes above 28,010');
    expect(text('watch-actions')).toContain('Alert me at 27,930');
  });

  it('watchLevels null: so zona e invalidacao, sem numero inventado', () => {
    show(result(long, { watchLevels: null, dataMode: 'real_data' }));
    expect(text('targets-rejected')).toBe('The targets did not pass the risk check, so none are shown.');
    expect(text('watch-numbers')).toBe('Buy zone27,710 to 27,730Invalidation27,650');
    expect(text('watch-ladder')).not.toContain('Target');
    expect(text('watch-plan')).not.toMatch(/\dR/);
  });

  it('print sem watchLevels: zona, invalidacao e alvos do plano, sem stop nem R', () => {
    show(result(long, { watchLevels: null, dataMode: 'print' }));
    expect(screen.queryByTestId('targets-rejected')).toBeNull();
    expect(text('levels-estimated')).toBe('Levels estimated from the screenshot');
    expect(text('watch-numbers')).toBe('Buy zone27,710 to 27,730Invalidation27,650Target 127,880Target 227,910');
    expect(text('watch-plan')).not.toMatch(/\dR/);
  });

  it('ativo sem fonte de preco: alerta na corretora e seguir', () => {
    options = { ...options, available: false };
    show(result(long));
    expect(text('watch-broker')).toBe('Set an alert at 27,730 on your broker, then re-check here.');
    expect(screen.getByRole('button', { name: 'Follow setup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Alert me/ })).toBeNull();
  });

  it('alerta automatico ligado e botoes', () => {
    show(result(long));
    expect(screen.getByRole('button', { name: 'Alert me at 27,730' })).toBeTruthy();
    cleanup();
    options = { ...options, watchAlert: { id: 'al', level: 27730, status: 'active' } };
    show(result(long));
    expect(text('watch-alert-on')).toBe("Alert on at 27,730 · we'll email you");
    expect(screen.queryByRole('button', { name: /Alert me/ })).toBeNull();
  });

  it('janela fechada: sem botao de alerta nem distancia', () => {
    vi.setSystemTime(Date.parse('2026-11-09T20:00:00Z'));
    show(result(long));
    expect(text('watch-timing')).toBe('Window closed at 19:23 UTC');
    expect(screen.queryByRole('button', { name: /Alert me/ })).toBeNull();
  });

  it('why wait em 3 bullets, o que muda o plano uma vez e o resumo sem repetir', () => {
    show(result(long, { watchLevels: levels, dataMode: 'real_data' }));
    expect([...screen.getByTestId('watch-why').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'From 27,832 there is little room to 27,880.', 'H1/H4 bearish alignment', 'M5 move is late',
    ]);
    expect(text('watch-changes')).toBe('What changes the planCancelled if:a M5 candle closes below 27,650Opposite case:a clean close above 27910 would reopen upside continuation after a hold');
    const body = document.body.textContent ?? '';
    expect(body.split(executiveSummary)).toHaveLength(2);
    expect(body).not.toContain('Why this read');
    expect(body).not.toContain('Risk or invalidation');
    expect(body).not.toContain('No entry yet. Here is the plan');
    expect(screen.queryByTestId('read-mode')).toBeNull();
  });

  it('painel tecnico sem Plan B repetido e sem por que nao o oposto vazio', () => {
    show(result(long));
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    expect(screen.queryByRole('button', { name: 'Plan B' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Why not the opposite' })).toBeNull();
  });

  it('evento so destaca se cai dentro da validade do plano', () => {
    calEvents = [{ title: 'CPI', country: 'USD', impact: 'High', minutesUntil: 19 * 60, time: '08:30' }];
    show(result(long));
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    expect(document.body.textContent).toContain('CPI');
    expect(document.body.textContent).not.toContain('May affect this analysis');
    cleanup();
    calEvents = [{ title: 'CPI', country: 'USD', impact: 'High', minutesUntil: 40, time: '08:30' }];
    show(result(long));
    fireEvent.click(screen.getByRole('button', { name: 'Technical Panel' }));
    expect(document.body.textContent).toContain('May affect this analysis');
  });
});

describe('unidade do ativo', () => {
  it.each([
    ['NAS100', 27832, '27,832'],
    ['US30', 45210.5, '45,210.5'],
    ['EURUSD', 1.1605, '1.16050'],
    ['USDJPY', 149.85, '149.850'],
    ['EURUSDm', 1.1605, '1.16050'],
    ['XAUUSD', 4133.7, '$ 4,133.70'],
    ['BTCUSDT', 78310, '$ 78,310.00'],
    ['EURUSDT', 1.16, '$ 1.1600'],
  ])('%s', (symbol, value, expected) => {
    expect(formatAssetPrice(value, symbol, 'en-US')).toBe(expected);
  });

  it('distancia: pontos, pips e preco', () => {
    const units = { points: '{n} points', pips: '{n} pips' };
    expect(formatAssetDistance(102, 'NAS100', 'en-US', units)).toBe('102 points');
    expect(formatAssetDistance(0.0035, 'EURUSD', 'en-US', units)).toBe('35 pips');
    expect(formatAssetDistance(12.4, 'XAUUSD', 'en-US', units)).toBe('$ 12.40');
  });
});

describe('card de compartilhar do WATCH', () => {
  const base = { symbol: 'NAS100', timeframe: 'M5', scenario: 'BULLISH', action: 'WAIT', state: 'WATCH' as const, read: '', readIsEnglish: true, trendStrength: 'moderate' as const, date: new Date(created) };

  it('leva o nivel e a linha do plano', () => {
    const model = buildReadCard({ ...base, watch: { direction: 'long', level: 27730, plan: { entry: 27720, stopLoss: 27644, takeProfit1: 27880, tp1R: 2.1 } } });
    expect(model.status).toBe('Watch for a buy at 27,730');
    expect(model.read[0]).toBe('Plan if price reaches 27,720: buy at 27,720, stop 27,644, target 27,880 (2.1R).');
  });

  it('sem geometria valida: so o nivel', () => {
    const model = buildReadCard({ ...base, watch: { direction: 'short', level: 27930, plan: null } });
    expect(model.status).toBe('Watch for a sell at 27,930');
    expect(model.read.join(' ')).not.toContain('Plan if');
  });
});
