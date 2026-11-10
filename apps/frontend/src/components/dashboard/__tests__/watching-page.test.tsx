import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WatchingPage, { WatchingLink } from '@/components/dashboard/WatchingPage';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { WatchSummary } from '@/lib/api';
import { checkFrequencyText, formatUtcMoment, type WatchingItem, type WatchJourney } from '@/lib/setups';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  track: (...a: unknown[]) => track(...a),
}));
let watchingItems: WatchingItem[] = [];
const seenMutate = vi.fn();
const followMutate = vi.fn();
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useWatching: () => ({ data: { items: watchingItems }, isLoading: false }),
  useAlertActions: () => ({ seen: { mutate: seenMutate } }),
  useSetupActions: () => ({ follow: { mutate: followMutate, isPending: false } }),
}));
vi.mock('@/components/dashboard/SetupsSection', () => ({
  default: ({ hiddenSetupIds }: { hiddenSetupIds: ReadonlySet<string> }) => <p data-testid="setups-list">{[...hiddenSetupIds].join(',')}</p>,
}));

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2026-11-01T00:00:00.000Z';
const noJourney: WatchJourney = { priceReached: false, recheck: null, entered: null, end: null };
const item = (over: Partial<WatchingItem> = {}, w: Partial<WatchSummary> = {}): WatchingItem => ({
  analysisId: 'w1', symbol: 'XAUUSD', timeframe: '15m', createdAt: '2026-11-09T10:00:00Z',
  watch: { direction: 'long', level: 4180, invalidation: 4150, validForCandles: 12, expiresAt: FUTURE, outcome: 'pending', alertAvailable: true, setupId: 's1', ...w },
  lastPrice: 4200, checkedAt: '2026-11-09T13:50:00.000Z', checkIntervalMs: 300_000, marketClosed: false,
  alert: { id: 'al1', setupId: 's1', status: 'active', triggeredAt: null, seenAt: null }, journey: noJourney, ...over,
});
const page = (language = 'en') => {
  window.localStorage.setItem('tickrify-language', language);
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <WatchingPage base="/dashboard" eyebrow={null} onStartAnalysis={vi.fn()} />
      </LanguageProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  watchingItems = [];
  navigate.mockClear();
  seenMutate.mockClear();
  followMutate.mockClear();
  track.mockClear();
});

describe('Aba Watching', () => {
  it('vazia: frase e botao de nova analise', () => {
    page();
    expect(screen.getByTestId('watching-empty').textContent).toContain('Nothing being watched right now');
  });

  it('vigiando: laranja, "Watch for a buy at", distancia, validade em UTC, alerta, ultimo check e Re-check now', () => {
    watchingItems = [item()];
    page();
    const group = screen.getByTestId('watching-open');
    const row = within(group).getByTestId('watching-item');
    expect(row.getAttribute('data-state')).toBe('open');
    expect(row.textContent).toContain('XAUUSD 15m');
    expect(row.textContent).toContain('Watch for a buy at $ 4,180.00');
    expect(row.textContent).toContain('0.48% away ($ 20.00)');
    expect(row.textContent).toContain('Invalidation $ 4,150.00');
    expect(row.textContent).toContain(`Valid until ${formatUtcMoment(FUTURE, 'en-US')}`);
    expect(row.textContent).toContain('Alert: watching · Last checked 13:50 UTC · Checked every 5 minutes');
    expect(within(row).getByText('Watching').className).toContain('--signal-hold');
    expect(within(row).queryByTestId('watch-journey')).toBeNull();
    fireEvent.click(within(row).getByText('Re-check now'));
    expect(navigate).toHaveBeenCalledWith('/dashboard/new?setup=s1');
    expect(seenMutate).not.toHaveBeenCalled();
  });

  it('preco chegou: no topo, marca visto e abre a reanalise com o alerta', () => {
    watchingItems = [
      item({ analysisId: 'w2' }),
      item({ alert: { id: 'al1', setupId: 's1', status: 'triggered', triggeredAt: '2026-11-09T13:00:00.000Z', seenAt: null }, journey: { ...noJourney, priceReached: true } }),
    ];
    page();
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('data-testid'));
    expect(groups.indexOf('watching-reached')).toBeLessThan(groups.indexOf('watching-open'));
    const row = within(screen.getByTestId('watching-reached')).getByTestId('watching-item');
    expect(row.getAttribute('data-state')).toBe('reached');
    expect(row.textContent).toContain('Alert: triggered');
    expect(screen.getByTestId('watching-reached').querySelector('[data-step="reached"]')).toBeTruthy();
    fireEvent.click(within(row).getByText('Re-check now'));
    expect(seenMutate).toHaveBeenCalledWith('al1');
    expect(navigate).toHaveBeenCalledWith('/dashboard/new?setup=s1&alert=al1');
  });

  it('sem setup ainda: Re-check now segue o setup e abre a reanalise dele', () => {
    watchingItems = [item({ alert: null }, { setupId: null })];
    page();
    fireEvent.click(screen.getByText('Re-check now'));
    expect(followMutate).toHaveBeenCalledWith('w1', expect.anything());
    followMutate.mock.calls[0][1].onSuccess({ setup: { id: 's9' } });
    expect(navigate).toHaveBeenCalledWith('/dashboard/new?setup=s9');
  });

  it.each([
    ['reached', 'target', 2.1, 'Level reached, target hit (+2.1 R)', 'target'],
    ['reached', 'invalidation', null, 'Level reached, stopped (-1 R)', 'stopped'],
    ['reached', 'neither', null, 'Level reached, no target or stop in 48 hours', 'neutral'],
    ['invalidated', null, null, 'Invalidated before reaching it', 'neutral'],
    ['expired', null, null, 'Expired without reaching it', 'neutral'],
    ['pending', null, null, 'Checking the result', 'checking'],
  ] as const)('encerrado %s/%s: cor e rotulo da regra unica, sem cara de operacao', (outcome, afterReach, targetR, label, tone) => {
    watchingItems = [item({ alert: null }, { outcome, afterReach, targetR, expiresAt: PAST })];
    page();
    const row = within(screen.getByTestId('watching-closed')).getByTestId('watching-item');
    expect(row.getAttribute('data-state')).toBe('closed');
    expect(screen.getByTestId('watch-outcome').getAttribute('data-tone')).toBe(tone);
    expect(row.textContent).toContain(label);
    expect(row.textContent).toContain('Buy level $ 4,180.00');
    expect(row.textContent).not.toMatch(/\b(win|loss|profit|filled|hit rate|P&L)\b/i);
    expect(row.textContent).not.toContain('away');
    expect(within(row).queryByText('Re-check now')).toBeNull();
    const pill = screen.getByTestId('watch-outcome').lastElementChild!.className;
    expect(pill).not.toContain('--signal-hold');
    expect(pill.includes('--signal-buy')).toBe(tone === 'target');
    expect(pill.includes('--signal-sell')).toBe(tone === 'stopped');
  });

  it.each([
    ['entered', { priceReached: true, recheck: { analysisId: 'n1', createdAt: '2026-11-09T14:00:00Z', signalState: 'ENTER_NOW' }, entered: { analysisId: 'n1' }, end: 'entered' }, ['watching', 'reached', 'rechecked', 'entered']],
    ['skipped', { priceReached: true, recheck: { analysisId: 'n1', createdAt: '2026-11-09T14:00:00Z', signalState: 'NO_TRADE' }, entered: null, end: 'skipped' }, ['watching', 'reached', 'rechecked', 'skipped']],
    ['invalidated', { ...noJourney, end: 'invalidated' }, ['watching', 'invalidated']],
    ['expired', { ...noJourney, end: 'expired' }, ['watching', 'expired']],
  ] as const)('jornada %s', (_name, journey, steps) => {
    watchingItems = [item({ alert: null, journey: journey as WatchJourney }, { expiresAt: PAST, outcome: 'reached', afterReach: 'target', targetR: 1.5 })];
    page();
    const list = screen.getByTestId('watch-journey');
    expect([...list.querySelectorAll('[data-step]')].map((n) => n.getAttribute('data-step'))).toEqual(steps);
    if (journey.recheck) {
      expect(within(list).getByText('Re-checked').getAttribute('href')).toBe('/dashboard/analysis/n1');
    }
    if (journey.end === 'entered') expect(within(list).getByText('Entered').getAttribute('href')).toBe('/dashboard/trades');
  });

  it('setups seguidos: o que ja aparece num WATCH nao repete', () => {
    watchingItems = [item(), item({ analysisId: 'w2', alert: null }, { setupId: 's2' })];
    page();
    expect(screen.getByTestId('setups-list').textContent).toBe('s1,s2');
  });

  it('frequencia de checagem', () => {
    const a = { everyMinute: 'Checked every minute', everyMinutes: 'Checked every {n} minutes', marketClosed: 'Market closed.' };
    expect(checkFrequencyText(a, { checkIntervalMs: 60_000 })).toBe('Checked every minute');
    expect(checkFrequencyText(a, { checkIntervalMs: null, marketClosed: true })).toBe('Market closed.');
  });

  it('nos 6 idiomas os textos vem traduzidos, sem travessao', () => {
    for (const [language, title, recheck] of [
      ['pt', 'Vigiando', 'Reanalisar agora'], ['en', 'Watching', 'Re-check now'], ['es', 'Vigilando', 'Reanalizar ahora'],
      ['fr', 'Sous surveillance', 'Réanalyser'], ['de', 'Beobachtet', 'Jetzt neu prüfen'], ['ja', '監視中', '今すぐ再分析'],
    ]) {
      watchingItems = [item(), item({ analysisId: 'w3', alert: null }, { expiresAt: PAST, outcome: 'expired' })];
      const { container } = page(language);
      expect(container.textContent).toContain(title);
      expect(container.textContent).toContain(recheck);
      expect(container.textContent).not.toMatch(/[—–]/);
      cleanup();
    }
  });
});

describe('WatchingLink (My Trades e Diario)', () => {
  const link = () => render(<MemoryRouter><LanguageProvider><WatchingLink /></LanguageProvider></MemoryRouter>);
  it('conta so o que ainda vale ou pede revisao; sem nada, some', () => {
    window.localStorage.setItem('tickrify-language', 'en');
    watchingItems = [item({ alert: null }, { expiresAt: PAST, outcome: 'expired' })];
    link();
    expect(screen.queryByTestId('watching-link')).toBeNull();
    cleanup();
    watchingItems = [item(), item({ analysisId: 'w2' })];
    link();
    expect(screen.getByTestId('watching-link').textContent).toBe('2 setups being watched');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/dashboard/watching');
    cleanup();
    watchingItems = [item()];
    link();
    expect(screen.getByTestId('watching-link').textContent).toBe('1 setup being watched');
  });
});
