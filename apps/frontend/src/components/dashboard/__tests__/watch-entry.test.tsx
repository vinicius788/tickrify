import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchEntryLog } from '@/components/dashboard/WatchEntryLog';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { asLoggedTrade, isTradeCall } from '@/lib/verdict';
import type { WatchEntry } from '@/lib/api';
import de from '@/lib/i18n/de';
import en from '@/lib/i18n/en';
import es from '@/lib/i18n/es';
import fr from '@/lib/i18n/fr';
import ja from '@/lib/i18n/ja';
import pt from '@/lib/i18n/pt';

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const levels = { entry: 74470, stopLoss: 74310, takeProfit1: 74710, takeProfit2: null, tp1R: 1.5, riskAtr: 1.3 };
const logged: WatchEntry = { plan: 'level', direction: 'long', entry: 74480, stopLoss: 74310, takeProfit1: 74710, rr: 1.35, at: '2026-11-11T15:00:00.000Z' };
const price = (value: number | null) => (value === null ? '' : `$${value.toLocaleString('en-US')}`);

function Harness({ initial = null, plan = 'level', closed = false }: { initial?: WatchEntry | null; plan?: 'level' | 'market'; closed?: boolean }) {
  const [entry, setEntry] = useState<WatchEntry | null>(initial);
  return <WatchEntryLog analysisId="an-1" plan={plan} levels={levels} entry={entry} onChange={setEntry} formatPrice={price} base="/dashboard" closed={closed} />;
}
function renderLog(props: Parameters<typeof Harness>[0] = {}) {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider>
          <Harness {...props} />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('I entered num WATCH', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('registra o plano e o preco digitado; stop e alvo nunca saem da tela', async () => {
    fetchMock.mockResolvedValue(json({ id: 'an-1', watchEntry: logged }));
    renderLog();
    await userEvent.click(screen.getByRole('button', { name: 'I entered this plan' }));
    expect(screen.getByText('Stop $74,310 · Target $74,710')).toBeTruthy();
    const input = screen.getByLabelText('Your entry price') as HTMLInputElement;
    expect(input.value).toBe('74470');
    await userEvent.clear(input);
    await userEvent.type(input, '74480');
    await userEvent.click(screen.getByRole('button', { name: 'Log trade' }));
    expect(await screen.findByText('You logged a buy at $74,480')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/ai\/analysis\/an-1\/watch-entry$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ plan: 'level', entry: 74480 });
    expect(screen.getByRole('link', { name: 'Open My Trades' }).getAttribute('href')).toBe('/dashboard/trades');
    expect(track).toHaveBeenCalledWith('watch_entry_logged', { analysisId: 'an-1', plan: 'level' });
  });

  it('preco fora do intervalo entre stop e alvo: avisa e nao envia', async () => {
    renderLog();
    await userEvent.click(screen.getByRole('button', { name: 'I entered this plan' }));
    const input = screen.getByLabelText('Your entry price');
    await userEvent.clear(input);
    await userEvent.type(input, '74200');
    expect(screen.getByText('The entry price has to be between the stop and the target.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Log trade' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('desfazer apaga o registro e o botao volta', async () => {
    fetchMock.mockResolvedValue(json({ id: 'an-1', watchEntry: null }));
    renderLog({ initial: logged });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'I entered this plan' })).toBeTruthy();
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('servidor recusou: avisa e continua no formulario', async () => {
    fetchMock.mockResolvedValue(json({ code: 'entry_out_of_plan' }, 400));
    renderLog();
    await userEvent.click(screen.getByRole('button', { name: 'I entered this plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log trade' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Your entry price')).toBeTruthy();
  });

  it('registrada no outro plano, este cartao nao oferece nada; janela encerrada sem registro tambem nao', async () => {
    const other = renderLog({ initial: logged, plan: 'market' });
    expect(other.container.textContent).toBe('');
    cleanup();
    const closed = renderLog({ closed: true });
    expect(closed.container.textContent).toBe('');
    cleanup();
    renderLog({ initial: logged, closed: true });
    await waitFor(() => expect(screen.getByText('You logged a buy at $74,480')).toBeTruthy());
  });

  it('nas listas, o WATCH com registro vira operacao do trader com os niveis do registro', () => {
    const watch = { id: 'an-1', recommendation: 'HOLD', signalState: 'WATCH', entry: null, stopLoss: null, takeProfit1: null, riskRewardTp1: null, watchEntry: { ...logged, direction: 'short' as const } };
    const trade = asLoggedTrade(watch);
    expect(isTradeCall(trade.recommendation, trade.signalState)).toBe(true);
    expect(trade).toMatchObject({ recommendation: 'SELL', entry: 74480, stopLoss: 74310, takeProfit1: 74710, riskRewardTp1: 1.35 });
    // Sem registro, ou fora do WATCH, nada muda.
    const plain = { recommendation: 'HOLD', signalState: 'WATCH', watchEntry: null };
    expect(asLoggedTrade(plain)).toBe(plain);
    expect(isTradeCall(plain.recommendation, plain.signalState)).toBe(false);
    const buy = { recommendation: 'BUY', signalState: 'ENTER_NOW', watchEntry: logged };
    expect(asLoggedTrade(buy)).toBe(buy);
  });

  it('textos do registro nos 6 idiomas, sem travessao', () => {
    const keys = (Object.keys(en.analysis.result.watch) as Array<keyof typeof en.analysis.result.watch>).filter((key) => key.startsWith('entry'));
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const lang of [pt, en, es, fr, de, ja]) {
      for (const key of keys) {
        expect(lang.analysis.result.watch[key]).toBeTruthy();
        expect(String(lang.analysis.result.watch[key])).not.toMatch(/[—–]/);
      }
      expect(lang.trades.fromWatchPlan).toBeTruthy();
    }
  });
});
