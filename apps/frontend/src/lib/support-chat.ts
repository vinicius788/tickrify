import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError, buildApiUrl } from './api';

/**
 * Chat com o fundador (12/10/2026). Sem WebSocket/SSE (o Render roda 2
 * instancias): a tela pergunta. 10 s com o chat aberto, 60 s para o contador de
 * nao lidas, e nada com a aba oculta. O texto das mensagens nunca vai ao
 * PostHog nem ao Sentry; a tela mostra como texto puro.
 */
export const CHAT_OPEN_POLL_MS = 10_000;
export const CHAT_UNREAD_POLL_MS = 60_000;
export const CHAT_BODY_MAX = 2000;
/** Outras telas (menu do painel, link do e-mail) abrem o chat por este evento. */
export const OPEN_CHAT_EVENT = 'tickrify:open-chat';

export type ChatMessage = { id: string; author: 'user' | 'founder'; body: string; createdAt: string };
export type ChatThread = { id: string; status: 'open' | 'closed'; lastMessageAt: string | null; unread: number };

async function send<T>(path: string, init: RequestInit, token: string | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new APIError('network', 0, 'network_error', error);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: unknown };
    throw new APIError(typeof body.message === 'string' ? body.message : `chat_${response.status}`, response.status, body.code);
  }
  return (await response.json()) as T;
}

/**
 * Chama `tick` a cada `intervalMs` so com a aba VISIVEL. Ao voltar a aba,
 * chama na hora e retoma; ao esconder, para.
 */
export function useVisiblePolling(tick: () => void, intervalMs: number, active: boolean) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (document.visibilityState === 'hidden') return;
      timer = window.setInterval(() => tickRef.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      tickRef.current();
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, active]);
}

function useToken() {
  const { getToken } = useAuth();
  return () => getToken();
}

/**
 * Conversa e contador de nao lidas. Quem pergunta a cada 60 s e a bolha
 * (`poll`); o menu do painel le o mesmo cache sem um segundo relogio.
 */
export function useChatThread(enabled: boolean, poll = true) {
  const token = useToken();
  const query = useQuery({
    queryKey: ['support', 'thread'],
    queryFn: async () => send<{ thread: ChatThread | null }>('/api/support/thread', { method: 'GET' }, await token()),
    enabled,
    staleTime: CHAT_UNREAD_POLL_MS / 2,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useVisiblePolling(() => void query.refetch(), CHAT_UNREAD_POLL_MS, enabled && poll);
  return query;
}

export function useChatMessages(open: boolean) {
  const token = useToken();
  const query = useInfiniteQuery({
    queryKey: ['support', 'messages'],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', String(pageParam));
      return send<{ items: ChatMessage[]; nextCursor: string | null }>(`/api/support/messages?${params}`, { method: 'GET' }, await token());
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useVisiblePolling(() => void query.refetch(), CHAT_OPEN_POLL_MS, open);
  return query;
}

export function useChatActions() {
  const token = useToken();
  const queryClient = useQueryClient();
  const sendMessage = useMutation({
    mutationFn: async (body: string) =>
      send<{ message: ChatMessage }>('/api/support/messages', { method: 'POST', body: JSON.stringify({ body }) }, await token()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support'] }),
  });
  const markRead = useMutation({
    mutationFn: async () => send<{ ok: true }>('/api/support/read', { method: 'POST' }, await token()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support', 'thread'] }),
  });
  return { sendMessage, markRead };
}

/** `surface` vai no `chat_opened` (ex.: dashboard_menu). */
export function openChat(surface: string) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { surface } }));
}

// ── /admin, aba Chat ─────────────────────────────────────────────────────────

export type AdminChatThread = {
  id: string;
  userId: string;
  status: 'open' | 'closed';
  lastMessageAt: string | null;
  /** Ultima vez que a pessoa abriu o chat com mensagem nova (ou escreveu). */
  userReadAt: string | null;
  createdAt: string;
  email: string | null;
  name: string | null;
  acquisitionSource: string | null;
  unread: number;
  lastMessage: string | null;
  lastAuthor: 'user' | 'founder' | null;
  lastAnalysisAt: string | null;
  isSubscriber: boolean;
  plan: string;
};

/** Lista do /admin. O topo do painel pergunta (contador); a aba le o mesmo cache. */
export function useAdminChatThreads(poll = true) {
  const token = useToken();
  const query = useQuery({
    queryKey: ['admin-support', 'threads'],
    queryFn: async () => send<{ items: AdminChatThread[] }>('/api/admin/support/threads', { method: 'GET' }, await token()),
    staleTime: CHAT_UNREAD_POLL_MS / 2,
    retry: false,
  });
  useVisiblePolling(() => void query.refetch(), CHAT_UNREAD_POLL_MS, poll);
  return query;
}

export function useAdminChatThread(threadId: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: ['admin-support', 'thread', threadId],
    queryFn: async () =>
      send<{
        thread: { id: string; userId: string; status: 'open' | 'closed'; email: string | null; userReadAt: string | null };
        items: ChatMessage[];
        nextCursor: string | null;
      }>(
        `/api/admin/support/threads/${encodeURIComponent(String(threadId))}`,
        { method: 'GET' },
        await token(),
      ),
    enabled: Boolean(threadId),
    retry: false,
  });
  useVisiblePolling(() => void query.refetch(), CHAT_OPEN_POLL_MS, Boolean(threadId));
  return query;
}

/** Mensagem do fundador ja vista: a pessoa abriu o chat depois dela. */
export function founderMessageSeen(createdAt: string, userReadAt: string | null | undefined): boolean {
  return Boolean(userReadAt) && new Date(createdAt).getTime() <= new Date(String(userReadAt)).getTime();
}

export function useAdminChatActions() {
  const token = useToken();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-support'] });
  const reply = useMutation({
    mutationFn: async (input: { threadId: string; body: string }) =>
      send(`/api/admin/support/threads/${encodeURIComponent(input.threadId)}/messages`, { method: 'POST', body: JSON.stringify({ body: input.body }) }, await token()),
    onSuccess: refresh,
  });
  const setStatus = useMutation({
    mutationFn: async (input: { threadId: string; status: 'open' | 'closed' }) =>
      send(`/api/admin/support/threads/${encodeURIComponent(input.threadId)}`, { method: 'PATCH', body: JSON.stringify({ status: input.status }) }, await token()),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: async (input: { email: string; body: string }) =>
      send<{ threadId: string }>('/api/admin/support/threads', { method: 'POST', body: JSON.stringify(input) }, await token()),
    onSuccess: refresh,
  });
  return { reply, setStatus, start };
}
