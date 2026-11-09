import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JournalCalendar from '@/components/dashboard/JournalCalendar';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: { id: 'u-1' } }), useAuth: () => ({ getToken: vi.fn() }) }));
const getJournal = vi.fn();
const setTradeNote = vi.fn();
vi.mock('@/lib/api', () => ({ useAPIClient: () => ({ getJournal, setTradeNote }) }));
// O pre-push roda tudo de uma vez e a primeira carga da query passa de 1 s
// (padrao do findBy) com a maquina cheia: o teste quebrava no push da noite.
const LOAD = { timeout: 5000 };

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

    expect(await screen.findByText('Your logged trading results', {}, LOAD)).toBeTruthy();
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
    expect(await screen.findByText('Mark TP or Stop on your trades in My Trades and your stats for the month show up here.', {}, LOAD)).toBeTruthy();
    expect(screen.queryByText('Your logged trading results')).toBeNull();
  });
});

describe('Diario: WATCH pendente', () => {
  afterEach(() => {
    cleanup();
    getJournal.mockReset();
  });

  it('aparece com o nivel e o desfecho, fora das estatisticas de trade', async () => {
    const today = new Date().getDate();
    const watch = {
      ...item('w', today, 'BTCUSDT', 'WAIT', 'stop', -42, null),
      signalState: 'WATCH',
      watch: { direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12, expiresAt: '2026-01-01T00:00:00.000Z', outcome: 'reached', alertAvailable: true },
    };
    getJournal.mockResolvedValue({ truncated: false, items: [watch, { ...item('nt', today, 'EURUSD', 'WAIT', 'tp1', 70, null), signalState: 'NO_TRADE' }] });
    renderJournal();
    expect(await screen.findByText('Sell level $ 77,800.00', {}, LOAD)).toBeTruthy();
    expect(screen.getByTestId('watch-pending').textContent).toContain('Price reached the level');
    expect(screen.getByTestId('watch-pending').textContent).not.toContain('No trade (wait)');
    // Nao e operacao: o mes segue sem trade fechado, sem numero.
    expect(screen.getByText('Mark TP or Stop on your trades in My Trades and your stats for the month show up here.')).toBeTruthy();
    expect(screen.queryByText('Your logged trading results')).toBeNull();
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
    expect(await screen.findByText('You vs the AI plan', {}, LOAD)).toBeTruthy();
    expect(screen.getByText('2 of 3 reached TP1 before the stop')).toBeTruthy();
    expect(screen.getByText('1 of 2 trades you logged')).toBeTruthy();
    expect(screen.getByText('You hit the stop where the plan reached TP1: 1')).toBeTruthy();
    expect(screen.getByText('1, of which 0 reached TP1')).toBeTruthy();
    expect(screen.getByText('1 still inside the 48h window')).toBeTruthy();
  });
});

describe('Diario: anotacao do trade', () => {
  afterEach(() => {
    cleanup();
    getJournal.mockReset();
    setTradeNote.mockReset();
  });

  it('anota setup, emocao, erro e nota; mostra o resumo e o recorte por erro', async () => {
    const user = userEvent.setup();
    const today = new Date().getDate();
    const base = { ...item('a', today, 'XAUUSD', 'BUY', 'stop', -50, 2) };
    getJournal.mockResolvedValueOnce({ truncated: false, items: [base] });
    setTradeNote.mockResolvedValue({ id: 'a', tradeNote: { note: 'Moved my stop', setup: 'pullback', emotion: 'fomo', mistakes: ['moved_stop'] } });
    renderJournal();

    await user.click(await screen.findByRole('button', { name: 'Add note' }, LOAD));
    await user.click(screen.getByRole('button', { name: 'Pullback' }));
    await user.click(screen.getByRole('button', { name: 'FOMO' }));
    await user.click(screen.getByRole('button', { name: 'Moved the stop' }));
    await user.type(screen.getByRole('textbox', { name: /Trade notes/ }), '  Moved my stop  ');

    getJournal.mockResolvedValueOnce({
      truncated: false,
      items: [{ ...base, tradeNote: { note: 'Moved my stop', setup: 'pullback', emotion: 'fomo', mistakes: ['moved_stop'] } }],
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setTradeNote).toHaveBeenCalledWith('a', { note: 'Moved my stop', setup: 'pullback', emotion: 'fomo', mistakes: ['moved_stop'] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit note' })).toBeTruthy());
    expect(screen.getByText('Moved my stop')).toBeTruthy();
    expect(screen.getByText('Mistakes')).toBeTruthy();
    expect(screen.getAllByText('Moved the stop').length).toBeGreaterThanOrEqual(2);
    // Muitos cliques e digitacao: com a maquina cheia (pre-push) 5 s nao bastam.
  }, 15000);

  it('WAIT nao tem botao de anotar (nao e operacao)', async () => {
    getJournal.mockResolvedValue({ truncated: false, items: [item('w', new Date().getDate(), 'XAUUSD', 'WAIT', null, null, null)] });
    renderJournal();
    await screen.findByText('XAUUSD', {}, LOAD);
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });
});
