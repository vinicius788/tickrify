import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramCard from '@/components/dashboard/TelegramCard';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const getToken = vi.fn().mockResolvedValue('tok');
const fetchMock = vi.fn();
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });

function renderCard() {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <TelegramCard getToken={getToken} className="card" />
    </LanguageProvider>,
  );
}

describe('TelegramCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sem bot configurado no servidor, o cartao nao aparece', async () => {
    fetchMock.mockResolvedValue(json({ available: false, linked: false, botUsername: null }));
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('falha ao ler o estado tambem nao mostra nada', async () => {
    fetchMock.mockRejectedValue(new Error('rede'));
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('conectar pede o link da conta e mostra o botao que abre o bot', async () => {
    fetchMock.mockImplementation(async (url: string, init: { method: string }) =>
      init.method === 'POST'
        ? json({ url: 'https://t.me/TickrifyAlertsBot?start=abc', expiresAt: '2026-11-10T15:00:00Z' })
        : json({ available: true, linked: false, botUsername: 'TickrifyAlertsBot' }),
    );
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    const open = await screen.findByRole('link', { name: /Open Telegram/ });
    expect(open.getAttribute('href')).toBe('https://t.me/TickrifyAlertsBot?start=abc');
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/telegram/link', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok' } }));
    expect(track).toHaveBeenCalledWith('telegram_connect_clicked', {});
  });

  it('conta ligada mostra o estado e desconecta pelo servidor', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      json({ available: true, linked: init.method !== 'DELETE', botUsername: 'TickrifyAlertsBot' }),
    );
    renderCard();
    expect(await screen.findByText('Connected. Your alerts go to Telegram.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });

  it('erro ao pedir o link avisa na tela', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      init.method === 'POST' ? json({}, false) : json({ available: true, linked: false, botUsername: 'b' }),
    );
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
