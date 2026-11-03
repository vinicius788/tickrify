import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import TodaySection from '@/components/dashboard/TodaySection';
import { LevelMapCard, WatchPending } from '@/components/dashboard/PendingLevels';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { APIError, type AIAnalysisResponse, type LevelMap, type WatchSummary } from '@/lib/api';
import { formatTimeLeft, type SetupAlert } from '@/lib/setups';

vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: [], loading: false, unreliable: false }) }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  track: (...a: unknown[]) => track(...a),
}));
const mutate = vi.fn();
let alertItems: SetupAlert[] = [];
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useSetupAlerts: () => ({ data: { paused: false, pausedSymbol: null, items: alertItems, unseen: 0, emailEnabled: false } }),
  useAlertActions: () => ({ create: { mutate, isPending: false }, cancel: { mutate: vi.fn() }, seen: { mutate: vi.fn() } }),
}));

const NOW = Date.parse('2026-11-03T12:00:00Z');
const watch = (over: Partial<WatchSummary> = {}): WatchSummary => ({
  direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12,
  expiresAt: '2026-11-03T14:00:00.000Z', outcome: 'pending', alertAvailable: true, ...over,
});
const wrap = (node: React.ReactNode) => {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(<MemoryRouter><LanguageProvider>{node}</LanguageProvider></MemoryRouter>);
};
const alert = (over: Partial<SetupAlert> = {}): SetupAlert => ({
  id: 'al1', setupId: 's1', analysisId: 'w1', symbol: 'BTCUSDT', timeframe: '15m', level: 77800, label: 'entry', side: 'above',
  status: 'active', createdAt: '2026-11-03T11:00:00Z', triggeredAt: null, triggerPrice: null, seenAt: null, lastPrice: null, checkedAt: null,
  ...over,
});

describe('WATCH pendente', () => {
  beforeEach(() => { alertItems = []; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('pendente: direcao e nivel, invalidacao, validade com o tempo que falta e o botao de alerta', () => {
    wrap(<WatchPending analysisId="w1" watch={watch()} surface="trades" now={NOW} />);
    const card = screen.getByTestId('watch-pending');
    expect(card.textContent).toContain('Pending');
    expect(card.textContent).toContain('Possible sell at 77,800. Re-check the chart when price gets there.');
    expect(card.textContent).toContain('Invalidation 78,400 · Valid for 12 candles, 2h left');
    expect(card.textContent).not.toMatch(/win|P&L|%/i);
    fireEvent.click(screen.getByRole('button', { name: 'Alert me at 77,800' }));
    expect(mutate).toHaveBeenCalledWith({ analysisId: 'w1', label: 'entry', level: 77800 }, expect.anything());
    expect(track).toHaveBeenCalledWith('pending_alert_clicked', { surface: 'trades', kind: 'watch' });
  });

  it('compra usa "Buy if"; tempo grafico desconhecido mostra so as velas', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ direction: 'long', level: 2345, expiresAt: null })} surface="journal" now={NOW} />);
    expect(screen.getByTestId('watch-pending').textContent).toContain('Possible buy at 2,345. Re-check the chart when price gets there.');
    expect(screen.getByTestId('watch-pending').textContent).toContain('Valid for 12 candles');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['reached', 'Price reached the level'],
    ['expired', 'Expired without reaching it'],
    ['invalidated', 'Invalidated before reaching it'],
    ['unavailable', 'Outcome not tracked for this asset'],
  ] as const)('desfecho %s: so o texto, sem botao, sem acerto', (outcome, text) => {
    wrap(<WatchPending analysisId="w1" watch={watch({ outcome, expiresAt: '2026-11-01T00:00:00.000Z' })} surface="trades" now={NOW} />);
    const card = screen.getByTestId('watch-pending');
    expect(card.dataset.outcome).toBe(outcome);
    expect(card.textContent).toContain(text);
    expect(card.textContent).not.toMatch(/\bwin\b|P&L/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('janela fechada sem linha no rastreador: continua Pending, sem botao', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ expiresAt: '2026-11-03T11:00:00.000Z' })} surface="trades" now={NOW} />);
    const text = screen.getByTestId('watch-pending').textContent ?? '';
    expect(text).toContain('Pending');
    expect(text).toContain('Window closed. Outcome pending.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ativo sem fonte de preco: sem botao (mesma regra do SetupAlertBar)', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ alertAvailable: false })} surface="trades" now={NOW} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('alerta ja ativo no nivel: mostra o estado em vez do botao', () => {
    alertItems = [alert()];
    wrap(<WatchPending analysisId="w1" watch={watch()} surface="trades" now={NOW} />);
    expect(screen.getByText('Alert active at 77,800')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('conta travada: o servidor responde 402 e a tela diz para assinar', () => {
    mutate.mockImplementation((_input, opts) => opts.onError(new APIError('locked', 402, 'free_quota_exhausted')));
    wrap(<WatchPending analysisId="w1" watch={watch()} surface="trades" now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alert me at 77,800' }));
    expect(toast).toHaveBeenCalledWith({ title: 'Subscribe to set price alerts.' });
  });

  it('formata o tempo que falta', () => {
    expect(formatTimeLeft(90 * 60_000, 'en-US')).toBe('1h 30m');
    expect(formatTimeLeft(26 * 3_600_000, 'en-US')).toBe('1d 2h');
    expect(formatTimeLeft(5 * 60_000, 'en-US')).toBe('5m');
  });
});

describe('Today: WATCH pendente mesmo sem alerta', () => {
  beforeEach(() => { alertItems = []; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

  const row = (id: string, w: WatchSummary | null): AIAnalysisResponse => ({
    id, status: 'completed', recommendation: 'WAIT', signalState: 'WATCH', symbol: 'BTCUSDT', timeframe: '15m',
    createdAt: '2026-11-03T11:00:00Z', updatedAt: '2026-11-03T11:00:00Z', watch: w,
  } as AIAnalysisResponse);

  it('aparece com o botao; some quando ja tem alerta ativo ou a janela fechou', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const analyses = [row('w1', watch()), row('w2', watch({ expiresAt: '2026-11-03T11:30:00.000Z' })), row('w3', null)];
    const { unmount } = wrap(<TodaySection base="/dashboard" alerts={undefined} openTrades={[]} analyses={analyses} />);
    expect(screen.getByText('Pending levels')).toBeTruthy();
    expect(screen.getAllByTestId('watch-pending')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Alert me at 77,800' })).toBeTruthy();
    expect(screen.queryByText(/Run an analysis and set an alert/)).toBeNull();
    unmount();

    alertItems = [alert()];
    wrap(<TodaySection base="/dashboard" alerts={{ paused: false, pausedSymbol: null, items: alertItems, unseen: 0, emailEnabled: false }} openTrades={[]} analyses={analyses} />);
    expect(screen.queryByText('Pending levels')).toBeNull();
  });
});

describe('NO_TRADE: mapa dos dois lados', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  const levelMap: LevelMap = {
    price: 100, atr: 2,
    above: { level: 104, atr: 2, next: 108, nextAtr: 4 },
    below: { level: 97, atr: 1.5, next: null, nextAtr: null },
  };
  const noTrade = (extra: Record<string, unknown>): AIAnalysisResponse => ({
    id: 'n1', status: 'completed', recommendation: 'WAIT', bias: 'neutral', confidence: 30,
    createdAt: '2026-11-03T11:00:00Z', updatedAt: '2026-11-03T11:00:00Z',
    fullResponse: {
      recommendation: 'WAIT', signalState: 'NO_TRADE', watchPlan: null, bias: 'neutral', confidence: 30, reasoning: 'x',
      analysis: { symbol: 'BTCUSDT', timeframe: '1h', currentPrice: 100, executiveSummary: 'No clean setup.' },
      ...extra,
    } as unknown as AIAnalysisResponse['fullResponse'],
  });

  it('com velas reais: os dois lados, a frase fixa e o alerta nos dois niveis', () => {
    wrap(<AnalysisResult analysisData={noTrade({ dataMode: 'real_data', levelMap })} uploadedImage={null} alertsEnabled />);
    const card = screen.getByTestId('level-map');
    expect(card.textContent).toContain('Levels to watch');
    // Mesmo formato de preco do "Where price is" da tela do resultado.
    expect(card.textContent).toMatch(/Above \$\s104\.0+: next level \$\s108\.0+ \(4\.0 ATR away\)/);
    expect(card.textContent).toMatch(/Below \$\s97\.0+: no lower level in the recent candles/);
    expect(card.textContent).toContain('These are levels to watch, not signals. Run a new analysis if price gets there.');
    fireEvent.click(screen.getByRole('button', { name: /^Alert me at \$\s97\.0+$/ }));
    expect(mutate).toHaveBeenCalledWith({ analysisId: 'n1', label: 'custom', level: 97 }, expect.anything());
    expect(screen.getByRole('button', { name: /^Alert me at \$\s104\.0+$/ })).toBeTruthy();
  });

  it('sem conta que possa criar alerta (demo, travada): so o mapa', () => {
    wrap(<AnalysisResult analysisData={noTrade({ dataMode: 'real_data', levelMap })} uploadedImage={null} />);
    expect(screen.getByTestId('level-map')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Alert me at/ })).toBeNull();
  });

  it('modo print ou analise antiga sem o campo: sem bloco', () => {
    wrap(<AnalysisResult analysisData={noTrade({ dataMode: 'print', levelMap: null })} uploadedImage={null} alertsEnabled />);
    expect(screen.queryByTestId('level-map')).toBeNull();
    cleanup();
    wrap(<AnalysisResult analysisData={noTrade({ dataMode: 'real_data' })} uploadedImage={null} alertsEnabled />);
    expect(screen.queryByTestId('level-map')).toBeNull();
  });

  it('LevelMapCard sem nenhum lado acima: so o de baixo', () => {
    wrap(<LevelMapCard levelMap={{ ...levelMap, above: null }} analysisId={null} alerts={false} formatPrice={(v) => String(v)} />);
    expect(screen.getByTestId('level-map').textContent).not.toContain('Above');
  });
});
