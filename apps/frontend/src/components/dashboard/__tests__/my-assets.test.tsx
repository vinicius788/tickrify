import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyAssets from '@/components/dashboard/MyAssets';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { WatchAssets } from '@/lib/setups';

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const base: WatchAssets = {
  assets: [],
  timeframe: '15m',
  maxAssets: 2,
  suggested: ['XAUUSD', 'BTCUSDT', 'EURUSD'],
  timeframes: ['1m', '5m', '15m', '1h', '4h'],
};
const gold = {
  symbol: 'XAUUSD', timeframe: '5m', status: 'ok' as const,
  levels: { price: 4102, atr: 3.1, trend: 'uptrend' as const, above: { price: 4118.5, atr: 5.3, pct: 0.4 }, below: { price: 4089.3, atr: 4.1, pct: 0.31 }, candleAt: 0 },
};

function renderBlock() {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider>
          <MyAssets base="/dashboard" />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MyAssets', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('conta travada ou servidor fora: o bloco nao aparece', async () => {
    fetchMock.mockResolvedValue(json({ code: 'free_quota_exhausted' }, 402));
    const { container } = renderBlock();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('sem lista: escolhe os ativos ate o teto do plano e salva com o tempo grafico', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method?: string; body?: string }) =>
      init?.method === 'PUT' ? json({ ...base, assets: [gold], timeframe: '5m' }) : json(base),
    );
    renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'XAUUSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'BTCUSDT' }));
    await userEvent.click(screen.getByRole('button', { name: 'EURUSD' }));
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'EURUSD' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('radio', { name: '5m' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body)).toEqual({ symbols: ['XAUUSD', 'BTCUSDT'], timeframe: '5m' });
    expect(await screen.findByText('Level above')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('watch_assets_saved', { count: 2, timeframe: '5m' });
  });

  it('com lista: mostra preco, estrutura e os dois niveis com a distancia, e diz que nao e sinal', async () => {
    fetchMock.mockResolvedValue(json({ ...base, assets: [gold], timeframe: '5m' }));
    renderBlock();
    expect(await screen.findByText('XAUUSD')).toBeTruthy();
    expect(screen.getByText('Uptrend')).toBeTruthy();
    expect(screen.getByText('4,118.5')).toBeTruthy();
    expect(screen.getByText('0.31% away')).toBeTruthy();
    expect(screen.getByText('Levels computed from real candles, 5m. Market information, not a signal.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analyze' }).getAttribute('href')).toBe('/dashboard/new');
  });

  it('dado atrasado e sem dado avisam em vez de mostrar nivel como se fosse de agora', async () => {
    fetchMock.mockResolvedValue(json({ ...base, assets: [{ ...gold, status: 'stale' }, { symbol: 'EURUSD', timeframe: '5m', levels: null, status: 'unavailable' }] }));
    renderBlock();
    expect(await screen.findByText('Market closed or data delayed. Levels from the last candles available.')).toBeTruthy();
    expect(screen.getByText("Price data isn't available right now. Try again in a few minutes.")).toBeTruthy();
  });

  it('erro ao salvar avisa e mantem a escolha', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method?: string }) =>
      init?.method === 'PUT' ? json({ code: 'asset_limit' }, 400) : json(base),
    );
    renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'XAUUSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'XAUUSD' }).getAttribute('aria-pressed')).toBe('true');
  });
});
