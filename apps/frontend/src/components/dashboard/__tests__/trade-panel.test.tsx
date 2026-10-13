import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TradePanel from '@/components/dashboard/TradePanel';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { TradeView } from '@/lib/api';

const api = {
  getTrade: vi.fn(),
  markTrade: vi.fn(),
  checkTrade: vi.fn(),
};
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useAPIClient: () => api,
}));
vi.mock('@/hooks/useAnalysisLimit', () => ({ useIncrementAnalysis: () => vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const base: TradeView = {
  analysisId: 'an1',
  status: 'suggested',
  direction: 'BUY',
  symbol: 'FX:XAUUSD',
  timeframe: '1H',
  entryPrice: null,
  plannedEntry: 4160,
  stopLoss: 4100,
  target: 4300,
  closeReason: null,
  timeline: [],
  checks: [],
  checksLeft: 10,
  analysisCreatedAt: '2026-10-13T10:00:00.000Z',
};

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <TradePanel analysisId="an1" />
      </LanguageProvider>
    </QueryClientProvider>,
  );

describe('painel da operacao', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marca "estou no trade" com o preco real de entrada', async () => {
    api.getTrade.mockResolvedValue(base);
    api.markTrade.mockResolvedValue({ ...base, status: 'in_trade', entryPrice: 4162.5 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: "I'm in this trade" }));
    fireEvent.change(screen.getByLabelText('Entry price'), { target: { value: '4162,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.markTrade).toHaveBeenCalledWith('an1', { status: 'in_trade', entryPrice: 4162.5 }));
    expect(await screen.findByText('In this trade')).toBeTruthy();
  });

  it('encerra com motivo de lista fechada', async () => {
    api.getTrade.mockResolvedValue({ ...base, status: 'in_trade' });
    api.markTrade.mockResolvedValue({ ...base, status: 'closed', closeReason: 'stop_hit' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Close trade' }));
    fireEvent.change(screen.getByLabelText('Why did it close?'), { target: { value: 'stop_hit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.markTrade).toHaveBeenCalledWith('an1', { status: 'closed', closeReason: 'stop_hit' }));
  });

  it('mostra a conferencia: situacao, acao e que o preco digitado decidiu', async () => {
    api.getTrade.mockResolvedValue({
      ...base,
      status: 'in_trade',
      checks: [
        {
          id: 'k1',
          createdAt: '2026-10-13T12:00:00.000Z',
          currentPrice: 4310,
          result: {
            situation: 'target_hit',
            action: 'exit',
            reason: 'Price is above the target.',
            watch: 'Lock the profit.',
            priceReadable: true,
            readPrice: 4305,
            needsCurrentPrice: false,
            decidedByPrice: true,
          },
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText('Target hit · Suggested action: Exit')).toBeTruthy();
    expect(screen.getByText('Decided by the price you typed, not by the AI.')).toBeTruthy();
  });

  it('WAIT nunca chega aqui; sem estado o servidor devolve erro e o painel some', async () => {
    api.getTrade.mockRejectedValue(new Error('not_a_trade'));
    const { container } = renderPanel();
    await waitFor(() => expect(api.getTrade).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
