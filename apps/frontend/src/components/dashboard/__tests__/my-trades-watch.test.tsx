import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyTrades from '@/components/dashboard/MyTrades';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: { id: 'u-1' } }), useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useAPIClient: () => ({ setOutcome: vi.fn(), setFavorite: vi.fn() }),
}));
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useSetupAlerts: () => ({ data: undefined }),
  useAlertActions: () => ({ create: { mutate: vi.fn(), isPending: false } }),
}));
const rows = [
  {
    id: 'w1', status: 'completed', recommendation: 'WAIT', signalState: 'WATCH', symbol: 'BTCUSDT', timeframe: '15m',
    outcome: null, createdAt: '2026-11-03T11:00:00Z', updatedAt: '2026-11-03T11:00:00Z',
    watch: { direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12, expiresAt: '2026-11-03T14:00:00.000Z', outcome: 'expired', alertAvailable: true },
  },
  {
    id: 'b1', status: 'completed', recommendation: 'BUY', signalState: 'ENTER_NOW', symbol: 'XAUUSD', timeframe: '1h',
    outcome: 'tp1', riskRewardTp1: 1.2, createdAt: '2026-11-02T11:00:00Z', updatedAt: '2026-11-02T11:00:00Z',
  },
];
vi.mock('@/hooks/useAnalyses', () => ({
  useAnalyses: () => ({ analyses: rows, loading: false, hasMore: false, loadingMore: false, loadMore: vi.fn(), refetch: vi.fn() }),
}));

describe('My Trades: WATCH pendente', () => {
  afterEach(cleanup);

  it('mostra o WATCH como pendente (nivel e desfecho), nunca como "nada a marcar", e fora do acerto', () => {
    window.localStorage.setItem('tickrify-language', 'en');
    render(<QueryClientProvider client={new QueryClient()}><LanguageProvider><MyTrades /></LanguageProvider></QueryClientProvider>);
    const card = screen.getByTestId('watch-pending');
    expect(card.textContent).toContain('Possible sell at 77,800. Re-check the chart when price gets there.');
    expect(card.textContent).toContain('Expired without reaching it');
    expect(screen.queryByText('A wait call is not a trade. Nothing to mark.')).toBeNull();
    // So o BUY conta: 1 vitoria em 1 decidido = 100%; o WATCH nao vira derrota nem pendente de resultado.
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('1W / 0L')).toBeTruthy();
  });
});
