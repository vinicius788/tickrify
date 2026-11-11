import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyAssets from '@/components/dashboard/MyAssets';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import de from '@/lib/i18n/de';
import en from '@/lib/i18n/en';
import es from '@/lib/i18n/es';
import fr from '@/lib/i18n/fr';
import ja from '@/lib/i18n/ja';
import pt from '@/lib/i18n/pt';
import type { WatchAssets } from '@/lib/setups';

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const empty: WatchAssets = {
  assets: [], timeframe: '15m', maxAssets: 2, alertsAvailable: true,
  suggested: ['XAUUSD', 'BTCUSDT', 'EURUSD'], timeframes: ['1m', '5m', '15m', '1h', '4h'],
};
const asset = (symbol: string, timeframe: string) => ({
  symbol, timeframe, status: 'ok' as const, alerts: [],
  levels: { price: 4102, atr: 3.1, trend: 'range' as const, above: { price: 4118.5, atr: 5.3, pct: 0.4 }, below: { price: 4089.3, atr: 4.1, pct: 0.31 }, candleAt: 0 },
});

function renderBlock(newAccount = true) {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider>
          <MyAssets base="/dashboard" newAccount={newAccount} />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Servidor falso: guarda a lista salva e quais ativos tiveram o alerta ligado. */
function server() {
  let saved: { symbols: string[]; timeframe: string } | null = null;
  const alerts: string[] = [];
  fetchMock.mockImplementation(async (url: string, init: { method?: string; body?: string }) => {
    if (init?.method === 'PUT' && url.includes('/alert')) {
      alerts.push(decodeURIComponent(url.split('/watch-assets/')[1].split('/')[0]));
    } else if (init?.method === 'PUT') {
      saved = JSON.parse(String(init.body));
    }
    return json(saved ? { ...empty, timeframe: saved.timeframe, assets: saved.symbols.map((s) => asset(s, saved!.timeframe)) } : empty);
  });
  return { saved: () => saved, alerts };
}

describe('quiz de conta nova', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    window.localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('tres respostas montam o painel: ativos, tempo grafico e a frase da dor, sem ligar alerta sozinho', async () => {
    const api = server();
    renderBlock();
    expect(await screen.findByText('What do you trade most?')).toBeTruthy();
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'XAUUSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'BTCUSDT' }));
    // Teto do plano: o terceiro nao entra.
    await userEvent.click(screen.getByRole('button', { name: 'EURUSD' }));
    expect(screen.getByRole('button', { name: 'EURUSD' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /1 hour/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /I enter too late/ }));
    await userEvent.click(screen.getByRole('button', { name: 'See my dashboard' }));

    expect(await screen.findByText(/You said you enter too late/)).toBeTruthy();
    expect(api.saved()).toEqual({ symbols: ['XAUUSD', 'BTCUSDT'], timeframe: '1h' });
    expect(api.alerts).toEqual([]);
    expect(screen.getByRole('link', { name: 'Send my first chart' }).getAttribute('href')).toBe('/dashboard/new?asset=XAUUSD');
    expect(track).toHaveBeenCalledWith('onboarding_quiz_viewed', {});
    expect(track).toHaveBeenCalledWith('onboarding_quiz_completed', { assets: 2, other: false, timeframe: '1h', pain: 'late', alerts_on: false });
  });

  it('quem perde o movimento por estar longe sai com o alerta ligado em cada ativo', async () => {
    const api = server();
    renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'XAUUSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /15 minutes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /I miss the move/ }));
    await userEvent.click(screen.getByRole('button', { name: 'See my dashboard' }));
    expect(await screen.findByText(/Alerts are on for your assets/)).toBeTruthy();
    expect(api.alerts).toEqual(['XAUUSD']);
    expect(track).toHaveBeenCalledWith('onboarding_quiz_completed', expect.objectContaining({ pain: 'miss', alerts_on: true }));
  });

  it('pular em qualquer pergunta nao grava nada e cai no seletor de sempre; nao volta a aparecer', async () => {
    const api = server();
    const first = renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('My assets')).toBeTruthy();
    expect(api.saved()).toBeNull();
    expect(track).toHaveBeenCalledWith('onboarding_quiz_skipped', { step: 1 });
    first.unmount();
    renderBlock();
    expect(await screen.findByText('My assets')).toBeTruthy();
    expect(screen.queryByText('What do you trade most?')).toBeNull();
  });

  it('so "Something else": termina sem gravar lista e sem prometer alerta', async () => {
    const api = server();
    renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'Something else' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /4 hours/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /I miss the move/ }));
    await userEvent.click(screen.getByRole('button', { name: 'See my dashboard' }));
    expect(await screen.findByText('My assets')).toBeTruthy();
    expect(api.saved()).toBeNull();
    expect(api.alerts).toEqual([]);
    expect(track).toHaveBeenCalledWith('onboarding_quiz_completed', { assets: 0, other: true, timeframe: '4h', pain: 'miss', alerts_on: false });
  });

  it('falha ao salvar: avisa, fica na pergunta e nao marca como feito', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method?: string }) => (init?.method === 'PUT' ? json({ code: 'x' }, 500) : json(empty)));
    renderBlock();
    await userEvent.click(await screen.findByRole('button', { name: 'XAUUSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /15 minutes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /I enter too late/ }));
    await userEvent.click(screen.getByRole('button', { name: 'See my dashboard' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(screen.getByText('Question 3 of 3')).toBeTruthy();
    expect(window.localStorage.getItem('tickrify_onboarding_quiz')).toBeNull();
  });

  it('conta que ja analisou ou ja tem lista nunca ve o quiz', async () => {
    fetchMock.mockResolvedValue(json(empty));
    renderBlock(false);
    expect(await screen.findByText('My assets')).toBeTruthy();
    expect(screen.queryByText('What do you trade most?')).toBeNull();
    cleanup();
    fetchMock.mockResolvedValue(json({ ...empty, assets: [asset('XAUUSD', '15m')] }));
    renderBlock(true);
    await waitFor(() => expect(screen.getByText('Level above')).toBeTruthy());
    expect(screen.queryByText('What do you trade most?')).toBeNull();
  });

  it('todo texto do quiz existe nos 6 idiomas, sem travessao', () => {
    const keys = Object.keys(en.quiz) as Array<keyof typeof en.quiz>;
    for (const lang of [pt, en, es, fr, de, ja]) {
      for (const key of keys) {
        expect(lang.quiz[key]).toBeTruthy();
        expect(lang.quiz[key]).not.toMatch(/[—–]/);
      }
    }
  });
});
