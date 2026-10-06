import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JournalCalendar from '@/components/dashboard/JournalCalendar';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: { id: 'u-1' } }) }));
const getJournal = vi.fn();
vi.mock('@/lib/api', () => ({ useAPIClient: () => ({ getJournal }) }));

const now = new Date();
const at = (day: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), day, hour).toISOString();
const item = (id: string, day: number, symbol: string, recommendation: string, outcome: string | null, pnlAmount: number | null, riskRewardTp1: number | null) => ({
  id, status: 'completed', symbol, timeframe: '15M', recommendation, outcome, pnlAmount, riskRewardTp1, riskRewardTp2: 3, createdAt: at(day, 10),
});

function renderJournal() {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <JournalCalendar />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('Diario: desempenho do mes', () => {
  afterEach(() => {
    cleanup();
    getJournal.mockReset();
  });

  it('mostra R medio, fator de lucro, maior queda, curva e recortes a partir dos trades fechados', async () => {
    getJournal.mockResolvedValue({
      truncated: false,
      items: [
        item('a', 1, 'XAUUSD', 'BUY', 'tp1', 300, 2),
        item('b', 1, 'BTCUSD', 'SELL', 'stop', -100, 1.5),
        item('c', 1, 'XAUUSD', 'WAIT', null, null, null),
      ],
    });
    renderJournal();

    expect(await screen.findByText('Performance this month')).toBeTruthy();
    // (2 - 1) / 2 = +0.50R
    expect(screen.getByText('+0.50R')).toBeTruthy();
    expect(screen.getByText('planned R per closed trade (2)')).toBeTruthy();
    expect(screen.getByText('3.00')).toBeTruthy();
    expect(screen.getByText('By asset')).toBeTruthy();
    expect(screen.getByText('Buy vs sell')).toBeTruthy();
    // Curva trade a trade: dois trades no mesmo dia ja desenham a linha.
    expect(screen.getByText('Equity curve (logged P&L)')).toBeTruthy();
    expect(screen.queryByText('Log the amount on your closed trades in My Trades to see the curve.')).toBeNull();
  });

  it('mes sem trade fechado: explica como preencher, sem numero inventado', async () => {
    getJournal.mockResolvedValue({ truncated: false, items: [item('w', 1, 'XAUUSD', 'WAIT', null, null, null)] });
    renderJournal();
    expect(await screen.findByText('Mark TP or Stop on your trades in My Trades and your stats for the month show up here.')).toBeTruthy();
    expect(screen.queryByText('Performance this month')).toBeNull();
  });
});

describe('Diario: voce x o plano da IA', () => {
  afterEach(() => {
    cleanup();
    getJournal.mockReset();
  });

  it('compara o que o trader marcou com o resultado do mercado em 48h', async () => {
    getJournal.mockResolvedValue({
      truncated: false,
      items: [
        { ...item('a', 1, 'XAUUSD', 'BUY', 'tp1', 300, 2), marketOutcome: 'WIN' },
        { ...item('b', 1, 'BTCUSD', 'SELL', 'stop', -100, 1.5), marketOutcome: 'WIN' },
        { ...item('c', 2, 'EURUSD', 'BUY', null, null, 2), marketOutcome: 'LOSS' },
        { ...item('d', 2, 'EURUSD', 'BUY', null, null, 2), marketOutcome: null },
      ],
    });
    renderJournal();
    expect(await screen.findByText('You vs the AI plan')).toBeTruthy();
    expect(screen.getByText('2 of 3 reached TP1 before the stop')).toBeTruthy();
    expect(screen.getByText('1 of 2 trades you logged')).toBeTruthy();
    expect(screen.getByText('You hit the stop where the plan reached TP1: 1')).toBeTruthy();
    expect(screen.getByText('1, of which 0 reached TP1')).toBeTruthy();
    expect(screen.getByText('1 still inside the 48h window')).toBeTruthy();
  });
});
