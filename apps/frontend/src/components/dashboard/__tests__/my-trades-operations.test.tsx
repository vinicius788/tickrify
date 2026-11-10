import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyTrades from '@/components/dashboard/MyTrades';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: { id: 'u-1' } }), useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useAPIClient: () => ({ setOutcome: vi.fn(), setFavorite: vi.fn() }),
}));
vi.mock('@/components/dashboard/WatchingPage', () => ({ WatchingLink: () => <p data-testid="watching-link">1 setup being watched</p> }));
const rows = [
  {
    id: 'w1', status: 'completed', recommendation: 'WAIT', signalState: 'WATCH', symbol: 'BTCUSDT', timeframe: '15m',
    outcome: 'stop', pnlAmount: -42, createdAt: '2026-11-03T11:00:00Z', updatedAt: '2026-11-03T11:00:00Z',
    watch: { direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12, expiresAt: '2026-11-03T14:00:00.000Z', outcome: 'expired', alertAvailable: true },
  },
  {
    id: 'n1', status: 'completed', recommendation: 'WAIT', signalState: 'NO_TRADE', symbol: 'EURUSD', timeframe: '1h',
    outcome: 'stop', pnlAmount: -75, createdAt: '2026-11-02T11:00:00Z', updatedAt: '2026-11-02T11:00:00Z',
  },
  {
    id: 'b1', status: 'completed', recommendation: 'BUY', signalState: 'ENTER_NOW', symbol: 'XAUUSD', timeframe: '1h',
    outcome: 'tp1', riskRewardTp1: 1.2, createdAt: '2026-11-02T11:00:00Z', updatedAt: '2026-11-02T11:00:00Z',
    fromWatch: { analysisId: 'w0', createdAt: '2026-11-01T09:00:00Z' },
  },
  {
    id: 's1', status: 'completed', recommendation: 'SELL', signalState: 'ENTER_NOW', symbol: 'ETHUSDT', timeframe: '4h',
    outcome: null, createdAt: '2026-11-01T11:00:00Z', updatedAt: '2026-11-01T11:00:00Z',
  },
];
vi.mock('@/hooks/useAnalyses', () => ({
  useAnalyses: () => ({ analyses: rows, loading: false, hasMore: false, loadingMore: false, loadMore: vi.fn(), refetch: vi.fn() }),
}));

describe('My Trades: so operacoes', () => {
  afterEach(cleanup);
  const mount = () => {
    window.localStorage.setItem('tickrify-language', 'en');
    return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><LanguageProvider><MyTrades /></LanguageProvider></QueryClientProvider></MemoryRouter>);
  };

  it('WATCH e NO_TRADE saem; a linha discreta aponta para a aba Watching', () => {
    mount();
    expect(screen.queryByText('BTCUSDT')).toBeNull();
    expect(screen.queryByText('EURUSD')).toBeNull();
    expect(screen.queryByTestId('watch-pending')).toBeNull();
    expect(screen.queryByTestId('watching-section')).toBeNull();
    expect(screen.getAllByText('XAUUSD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ETHUSDT').length).toBeGreaterThan(0);
    expect(screen.getByTestId('watching-link')).toBeTruthy();
    // So as operacoes contam: 1 vitoria em 1 decidido; o SELL sem marcacao fica pendente.
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('1W / 0L')).toBeTruthy();
  });

  it('operacao que veio de um WATCH: "From a watch on <data>" com link para ele', () => {
    mount();
    const link = screen.getByTestId('from-watch');
    expect(link.textContent).toBe('From a watch on Nov 1');
    expect(link.getAttribute('href')).toBe('/dashboard/analysis/w0');
    expect(screen.getAllByTestId('from-watch')).toHaveLength(1);
  });

  it('o filtro nao oferece mais Watch nem No trade', () => {
    mount();
    const options = [...document.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).not.toContain('Watch');
    expect(options).not.toContain('No trade');
  });
});
