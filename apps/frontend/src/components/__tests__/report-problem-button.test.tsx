import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportProblemButton } from '@/components/ReportProblemButton';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { openChat, useVisiblePolling } from '@/lib/support-chat';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  buildApiUrl: (p: string) => `https://api.test${p}`,
}));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

type Msg = { id: string; author: 'user' | 'founder'; body: string; createdAt: string };

/** Servidor falso do chat (e do relato), com estado. */
function serve(state: { messages: Msg[]; unread: number; sendStatus?: number } = { messages: [], unread: 0 }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.test', '').split('?')[0];
    const method = init?.method ?? 'GET';
    if (path === '/api/support/thread') {
      return json(200, { thread: state.messages.length ? { id: 'thread-1234567890', status: 'open', lastMessageAt: null, unread: state.unread } : null });
    }
    if (path === '/api/support/messages' && method === 'GET') return json(200, { items: state.messages, nextCursor: null });
    if (path === '/api/support/messages' && method === 'POST') {
      if (state.sendStatus) return json(state.sendStatus, { code: 'chat_rate_limited' });
      const { body } = JSON.parse(String(init?.body));
      const message = { id: `m${state.messages.length + 1}xxxxxxxx`, author: 'user' as const, body, createdAt: '2026-10-12T12:00:00.000Z' };
      state.messages.push(message);
      return json(201, { message });
    }
    if (path === '/api/support/read') {
      state.unread = 0;
      return json(201, { ok: true });
    }
    if (path === '/api/reports') return json(201, { id: 'abcdef1234' });
    throw new Error(`rota nao mockada: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderBolha(path = '/dashboard/trades') {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <ReportProblemButton />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('bolha "Chat, feedback or problem"', () => {
  beforeEach(() => setVisibility('visible'));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    toast.mockReset();
    track.mockReset();
  });

  it('abre no chat: fundador pelo nome, sem "online", e a frase de boas-vindas na conversa vazia', async () => {
    const user = userEvent.setup();
    serve();
    renderBolha();

    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Talk to Vinícius, founder of Tickrify')).toBeTruthy();
    expect(screen.getByText('Usually replies within a few hours')).toBeTruthy();
    expect(await screen.findByText(/I'm Vinícius, I built Tickrify/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/online/i);
    expect(document.body.textContent).not.toMatch(/\bVini\b/);
    expect(track).toHaveBeenCalledWith('chat_opened', { surface: 'bubble', unread: 0 });
  });

  it('nunca fica em cima de um botao: some enquanto houver acao embaixo e volta depois', async () => {
    serve();
    const cta = document.createElement('button');
    cta.textContent = 'Subscribe';
    document.body.appendChild(cta);
    let underneath: Element[] = [cta];
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => underneath;
    try {
      renderBolha('/dashboard/plans');
      const bubble = screen.getByRole('button', { name: 'Chat, feedback or problem' });
      await waitFor(() => expect(bubble.getAttribute('data-covering')).toBe('true'));
      expect(bubble.className).toContain('opacity-0');
      expect(bubble.className).toContain('pointer-events-none');
      underneath = [document.body];
      window.dispatchEvent(new Event('scroll'));
      await waitFor(() => expect(bubble.getAttribute('data-covering')).toBeNull());
    } finally {
      document.elementsFromPoint = original;
      cta.remove();
    }
  });

  it('Enter envia, Shift+Enter quebra linha; o evento leva so o tamanho', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    renderBolha();
    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));

    const box = screen.getByRole('textbox', { name: 'Write a message' });
    expect(box.className).toContain('text-base');
    await user.type(box, 'first line{Shift>}{Enter}{/Shift}second line');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.type(box, '{Enter}');

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ body: 'first line\nsecond line' });
    expect(track).toHaveBeenCalledWith('chat_message_submitted', { length: 22 });
    expect(JSON.stringify(track.mock.calls)).not.toContain('second line');
    expect(await screen.findByText(/first line\s+second line/)).toBeTruthy();
  });

  it('texto com <script> aparece como texto, nunca como HTML', async () => {
    const user = userEvent.setup();
    serve({ messages: [{ id: 'm1xxxxxxxxxx', author: 'user', body: '<script>alert(1)</script><b>bold</b>', createdAt: '2026-10-12T12:00:00.000Z' }], unread: 0 });
    const { container } = renderBolha();
    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));

    expect(await screen.findByText('<script>alert(1)</script><b>bold</b>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('resposta nao lida: numero no botao; abrir o chat marca como lida', async () => {
    const user = userEvent.setup();
    const state = {
      messages: [
        { id: 'm1xxxxxxxxxx', author: 'user' as const, body: 'help', createdAt: '2026-10-12T12:00:00.000Z' },
        { id: 'm2xxxxxxxxxx', author: 'founder' as const, body: 'On it', createdAt: '2026-10-12T12:05:00.000Z' },
      ],
      unread: 1,
    };
    const fetchMock = serve(state);
    renderBolha();

    const bubble = await screen.findByRole('button', { name: 'Chat, feedback or problem (1 unread)' });
    await user.click(bubble);
    expect(await screen.findByText('On it')).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/support/read'))).toBe(true));
    expect(track).toHaveBeenCalledWith('chat_opened', { surface: 'bubble', unread: 1 });
  });

  it('limite por hora: avisa sem perder o rascunho', async () => {
    const user = userEvent.setup();
    serve({ messages: [], unread: 0, sendStatus: 429 });
    renderBolha();
    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));
    const box = screen.getByRole('textbox', { name: 'Write a message' });
    await user.type(box, 'hello{Enter}');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('a lot of messages');
    expect((box as HTMLTextAreaElement).value).toBe('hello');
  });

  it('menu do painel e link do e-mail abrem direto no chat', async () => {
    serve();
    renderBolha('/dashboard?chat=open');
    expect(await screen.findByText('Talk to Vinícius, founder of Tickrify')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('chat_opened', { surface: 'email_link', unread: 0 });

    cleanup();
    track.mockReset();
    serve();
    renderBolha();
    act(() => openChat('dashboard_menu'));
    expect(await screen.findByText('Talk to Vinícius, founder of Tickrify')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('chat_opened', { surface: 'dashboard_menu', unread: 0 });
  });

  it('"Report a problem" segue igual: contexto tecnico, sem kind', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    renderBolha();

    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));
    await user.click(screen.getByRole('tab', { name: 'Report a problem' }));
    await user.type(screen.getByRole('textbox'), 'The chart upload froze');
    await user.click(screen.getByRole('button', { name: 'send' }));

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'));
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.kind).toBeUndefined();
    expect(body.context).toBeDefined();
    expect(body.route).toBe('/dashboard/trades');
  });

  it('aba de opiniao manda kind feedback, sem contexto tecnico, e agradece', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    renderBolha();

    await user.click(screen.getByRole('button', { name: 'Chat, feedback or problem' }));
    await user.click(screen.getByRole('tab', { name: 'Share your opinion' }));
    expect(screen.getByText('What do you think of Tickrify so far?')).toBeTruthy();
    await user.type(screen.getByRole('textbox'), 'I love the WAIT reads');
    await user.click(screen.getByRole('button', { name: 'send' }));

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ message: 'I love the WAIT reads', route: '/dashboard/trades', kind: 'feedback' });
    expect(track).toHaveBeenCalledWith('feedback_sent', { length: 21, surface: 'bubble' });
    expect(toast).toHaveBeenCalledWith({ title: 'Thank you. It goes straight to the team.' });
  });
});

describe('polling do chat', () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('pergunta no intervalo com a aba visivel, para com a aba oculta e retoma ao voltar', () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const tick = vi.fn();
    const { unmount } = renderHook(() => useVisiblePolling(tick, 10_000, true));

    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(3);

    setVisibility('hidden');
    vi.advanceTimersByTime(120_000);
    expect(tick).toHaveBeenCalledTimes(3);

    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(5);

    unmount();
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it('desligado (chat fechado) nao pergunta', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    renderHook(() => useVisiblePolling(tick, 10_000, false));
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
