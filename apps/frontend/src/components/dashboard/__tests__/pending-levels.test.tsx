import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import TodaySection from '@/components/dashboard/TodaySection';
import { LevelMapCard, WatchPending, WatchingSection } from '@/components/dashboard/PendingLevels';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { APIError, type AIAnalysisResponse, type LevelMap, type WatchSummary } from '@/lib/api';
import { checkFrequencyText, formatTimeLeft, type SetupAlert, type WatchingItem } from '@/lib/setups';

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
let priceAvailable = true;
let alertItems: SetupAlert[] = [];
let watchingItems: WatchingItem[] = [];
const seenMutate = vi.fn();
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useAlertOptions: () => ({ data: { available: priceAvailable, setupId: 's1' } }),
  useSetupAlerts: () => ({ data: { paused: false, pausedSymbol: null, items: alertItems, unseen: 0, emailEnabled: false } }),
  useAlertActions: () => ({ create: { mutate, isPending: false }, cancel: { mutate: vi.fn() }, seen: { mutate: seenMutate } }),
  useWatching: () => ({ data: { items: watchingItems } }),
}));

const NOW = Date.parse('2026-11-03T12:00:00Z');
const watch = (over: Partial<WatchSummary> = {}): WatchSummary => ({
  direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12,
  expiresAt: '2026-11-03T14:00:00.000Z', outcome: 'pending', alertAvailable: true, ...over,
});
const wrap = (node: React.ReactNode, language = 'en') => {
  window.localStorage.setItem('tickrify-language', language);
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

  it('plano condicional com geometria valida; sem ela so nivel e invalidacao', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ plan: { entry: 77800, stopLoss: 78500, takeProfit1: 76000, tp1R: 2.57 } })} surface="trades" now={NOW} />);
    expect(screen.getByTestId('conditional-plan').textContent).toBe('Plan if price reaches 77,800: sell at 77,800, stop 78,500, target 76,000 (2.6R).');
    cleanup();
    wrap(<WatchPending analysisId="w1" watch={watch({ plan: null })} surface="trades" now={NOW} />);
    expect(screen.queryByTestId('conditional-plan')).toBeNull();
    expect(screen.getByTestId('watch-pending').textContent).toContain('Invalidation');
    cleanup();
    wrap(<WatchPending analysisId="w1" watch={watch({ plan: { entry: 77800, stopLoss: 78500, takeProfit1: 76000, tp1R: 2.57 } })} surface="trades" now={Date.parse('2026-11-03T15:00:00Z')} />);
    expect(screen.queryByTestId('conditional-plan')).toBeNull();
  });

  it('nivel da IA: so promete o aviso quando o alerta existe', () => {
    const aiLevel = { price: 77800, direction: 'long' as const, invalidation: 77000, validForCandles: 12, reason: 'no_valid_geometry' };
    wrap(<LevelMapCard levelMap={null} aiLevel={aiLevel} analysisId="w1" alerts formatPrice={(v) => String(v)} />);
    expect(screen.getByTestId('ai-level').textContent).toContain('The AI saw a possible buy at 77800, but the stop does not fit our risk rules.');
    expect(screen.queryByTestId('ai-level-alert')).toBeNull();
    cleanup();
    alertItems = [alert({ level: 77800 })];
    wrap(<LevelMapCard levelMap={null} aiLevel={aiLevel} analysisId="w1" alerts formatPrice={(v) => String(v)} />);
    expect(screen.getByTestId('ai-level-alert').textContent).toContain("We'll alert you if price gets there.");
  });

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

  it('fecha no instante da validade sem nova resposta do servidor', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      wrap(<WatchPending analysisId="w1" watch={watch({ expiresAt: new Date(NOW + 5000).toISOString() })} surface="journal" />);
      expect(screen.getByRole('button')).toBeTruthy();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByText('Window closed. Outcome pending.')).toBeTruthy();
      expect(screen.queryByText(/Re-check the chart/)).toBeNull();
    } finally { vi.useRealTimers(); }
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
  ] as const)('desfecho %s: so o nivel e a direcao, sem instrucao, sem botao, sem acerto', (outcome, text) => {
    wrap(<WatchPending analysisId="w1" watch={watch({ outcome, expiresAt: '2026-11-01T00:00:00.000Z' })} surface="trades" now={NOW} />);
    const card = screen.getByTestId('watch-pending');
    expect(card.dataset.outcome).toBe(outcome);
    expect(card.textContent).toContain(text);
    expect(card.textContent).toContain('Sell level 77,800');
    expect(card.textContent).not.toContain('Invalidation');
    expect(card.textContent).not.toContain('Possible');
    expect(card.textContent).not.toContain('Re-check the chart');
    expect(card.textContent).not.toMatch(/\bwin\b|P&L/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('desfecho de compra: "Buy level"', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ direction: 'long', level: 3982.5, outcome: 'reached', expiresAt: '2026-11-01T00:00:00.000Z' })} surface="trades" now={NOW} />);
    const text = screen.getByTestId('watch-pending').textContent ?? '';
    expect(text).toContain('Buy level 3,982.5');
    expect(text).not.toContain('Re-check the chart');
  });

  it('janela fechada sem linha no rastreador: continua Pending, so o nivel, sem botao', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ expiresAt: '2026-11-03T11:00:00.000Z' })} surface="trades" now={NOW} />);
    const text = screen.getByTestId('watch-pending').textContent ?? '';
    expect(text).not.toContain('Invalidation');
    expect(text).toContain('Window closed. Outcome pending.');
    expect(text).toContain('Sell level 77,800');
    expect(text).not.toContain('Re-check the chart');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ativo sem fonte de preco: sem botao (mesma regra do SetupAlertBar)', () => {
    wrap(<WatchPending analysisId="w1" watch={watch({ alertAvailable: false })} surface="trades" now={NOW} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('alerta ja ativo no nivel: mostra o estado em vez do botao', () => {
    alertItems = [alert({ analysisId: 'outra-versao' })];
    wrap(<WatchPending analysisId="w1" watch={watch({ setupId: 's1' })} surface="trades" now={NOW} />);
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
    const sameAnalysisOtherLevel = [alert({ level: 78400, label: 'invalidation' })];
    const other = wrap(<TodaySection base="/dashboard" alerts={{ paused: false, pausedSymbol: null, items: sameAnalysisOtherLevel, unseen: 0, emailEnabled: false }} openTrades={[]} analyses={analyses} />);
    expect(screen.getByText('Pending levels')).toBeTruthy();
    other.unmount();

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

  it.each(['pt', 'de', 'fr', 'es'])('formats the ATR distance using the %s decimal separator', (language) => {
    const map = { ...levelMap, above: { level: 101, atr: 0.5, next: 103, nextAtr: 1.5 } };
    wrap(<LevelMapCard levelMap={map} analysisId={null} alerts={false} formatPrice={String} />, language);
    expect(screen.getByTestId('level-map').textContent).toContain('1,5 ATR');
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

  it('PETR4 com mapa real mas sem fonte no SetupAlert mostra os dois niveis sem botoes', () => {
    priceAvailable = false;
    try {
      wrap(<AnalysisResult analysisData={noTrade({ dataMode: 'real_data', levelMap, analysis: { symbol: 'PETR4', currentPrice: 100 } })} uploadedImage={null} alertsEnabled />);
      expect(screen.getByTestId('level-map')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Alert me at/ })).toBeNull();
    } finally { priceAvailable = true; }
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

describe('WatchingSection', () => {
  const FUTURE = '2099-01-01T00:00:00.000Z';
  const item = (over: Partial<WatchingItem> = {}, w: Partial<WatchSummary> = {}): WatchingItem => ({
    analysisId: 'w1', symbol: 'XAUUSD', timeframe: '15m', createdAt: '2026-11-09T10:00:00Z',
    watch: { direction: 'long', level: 4180, invalidation: 4150, validForCandles: 12, expiresAt: FUTURE, outcome: 'pending', alertAvailable: true, ...w },
    lastPrice: 4200, checkedAt: '2026-11-09T13:50:00.000Z', checkIntervalMs: 300_000, marketClosed: false,
    alert: { id: 'al1', setupId: 's1', status: 'active', triggeredAt: null, seenAt: null }, ...over,
  });
  const section = (language = 'en') => wrap(<WatchingSection surface="trades" enabled />, language);
  afterEach(() => {
    cleanup();
    watchingItems = [];
    navigate.mockClear();
    seenMutate.mockClear();
  });

  it('sem WATCH, nao aparece', () => {
    section();
    expect(screen.queryByTestId('watching-section')).toBeNull();
  });

  it('valendo: ativo, direcao, nivel, distancia em % e no preco, invalidacao, tempo, frequencia e alerta', () => {
    watchingItems = [item()];
    section();
    const row = screen.getByTestId('watching-item');
    expect(row.textContent).toContain('XAUUSD 15m');
    expect(row.textContent).toContain('Possible buy at 4,180');
    expect(row.textContent).toContain('0.48% away (20)');
    expect(row.textContent).toContain('Invalidation 4,150');
    expect(row.textContent).toMatch(/\d.* left/);
    expect(row.textContent).toContain('Last checked 13:50 UTC · Checked every 5 minutes');
    expect(row.textContent).toContain('Alert: watching');
    expect(screen.queryByText('Update chart')).toBeNull();
  });

  it('cripto diz a cada minuto; forex no fim de semana nao promete checagem', () => {
    const a = { everyMinute: 'Checked every minute', everyMinutes: 'Checked every {n} minutes', marketClosed: 'Market closed.' };
    expect(checkFrequencyText(a, { checkIntervalMs: 60_000 })).toBe('Checked every minute');
    expect(checkFrequencyText(a, { checkIntervalMs: 8 * 60_000 })).toBe('Checked every 8 minutes');
    expect(checkFrequencyText(a, { checkIntervalMs: null, marketClosed: true })).toBe('Market closed.');
    expect(checkFrequencyText(a, { checkIntervalMs: null })).toBeNull();
  });

  it('disparou: estado e botao que marca visto e abre a atualizacao do setup', () => {
    watchingItems = [item({ alert: { id: 'al1', setupId: 's1', status: 'triggered', triggeredAt: '2026-11-09T13:00:00.000Z', seenAt: null } })];
    section();
    expect(screen.getByTestId('watching-item').textContent).toContain('Alert: triggered');
    fireEvent.click(screen.getByText('Update chart'));
    expect(seenMutate).toHaveBeenCalledWith('al1');
    expect(navigate).toHaveBeenCalledWith('/dashboard/new?setup=s1&alert=al1');
  });

  it('cancelado aparece como cancelado enquanto a janela vale', () => {
    watchingItems = [item({ alert: { id: 'al1', setupId: 's1', status: 'cancelled', triggeredAt: null, seenAt: null } })];
    section();
    expect(screen.getByTestId('watching-item').textContent).toContain('Alert: cancelled');
  });

  it.each([
    ['reached', 'target', 'Level reached', 'Afterwards price reached the plan target.'],
    ['reached', 'invalidation', 'Level reached', 'Afterwards price reached the invalidation.'],
    ['reached', 'neither', 'Level reached', 'Afterwards price reached neither within 48 hours.'],
    ['invalidated', null, 'Invalidated before the level', null],
    ['expired', null, 'Window closed', null],
  ] as const)('encerrado %s/%s mostra o que o preco fez, sem cara de operacao', (outcome, afterReach, label, after) => {
    watchingItems = [item({ alert: null }, { outcome, afterReach, expiresAt: '2026-11-01T00:00:00.000Z' })];
    section();
    const row = screen.getByTestId('watching-item');
    expect(row.getAttribute('data-state')).toBe('closed');
    expect(row.textContent).toContain(label);
    expect(row.textContent).toContain('Buy level 4,180');
    if (after) expect(row.textContent).toContain(after);
    expect(row.textContent).not.toMatch(/\b(win|loss|profit|filled|hit rate|P&L)\b/i);
    expect(row.textContent).not.toContain('away');
  });

  it('janela fechada sem linha no rastreador: diz que falta conferir, ou o nivel se o alerta disparou dentro dela', () => {
    const expiresAt = '2026-11-01T00:00:00.000Z';
    watchingItems = [item({ alert: null }, { expiresAt })];
    section();
    expect(screen.getByTestId('watching-item').textContent).toContain('Window closed. Price check pending.');
    cleanup();
    watchingItems = [item({ alert: { id: 'al1', setupId: 's1', status: 'triggered', triggeredAt: '2026-10-31T00:00:00.000Z', seenAt: '2026-10-31T01:00:00.000Z' } }, { expiresAt })];
    section();
    expect(screen.getByTestId('watching-item').textContent).toContain('Level reached');
    expect(screen.queryByText('Update chart')).toBeNull();
  });

  it('nos 6 idiomas o titulo e o texto vem traduzidos, sem travessao', () => {
    for (const [language, title] of [['pt', 'Vigiando'], ['en', 'Watching'], ['es', 'Vigilando'], ['fr', 'Sous surveillance'], ['de', 'Beobachtet'], ['ja', '監視中']]) {
      watchingItems = [item()];
      section(language);
      const node = screen.getByTestId('watching-section');
      expect(node.textContent).toContain(title);
      expect(node.textContent).not.toMatch(/[\u2014\u2013]/);
      cleanup();
    }
  });
});
