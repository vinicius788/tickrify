import { useAuth } from '@clerk/clerk-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError, buildApiUrl } from './api';

/**
 * Setups acompanhados (12/10/2026). Seguir e diferente de favoritar (estrela da
 * analise) e de entrar (veredito OPEN): e "quero reavaliar este setup depois".
 * Atualizar e o fluxo normal de nova analise com o `setupId` junto.
 */
export type SetupStatus = 'tracking' | 'untracked' | 'archived';
export type SetupVerdict = 'BUY' | 'SELL' | 'WAIT';

export interface SetupSummary {
  id: string;
  status: SetupStatus;
  symbol: string | null;
  timeframe: string | null;
  rootAnalysisId: string;
  createdAt: string;
  lastAnalysisAt: string;
}

export interface FollowedSetup extends SetupSummary {
  versions: number;
  latest: {
    analysisId: string;
    createdAt: string;
    recommendation: SetupVerdict;
    entryCondition: string | null;
  } | null;
}

export interface SetupVersion {
  analysisId: string;
  version: number;
  createdAt: string;
  recommendation: SetupVerdict;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  entryCondition: string | null;
}

/** Mesmo formato que o backend aceita (uuid do setup). */
export const SETUP_ID_PATTERN = /^[a-z0-9-]{10,40}$/i;

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
    throw new APIError(typeof body.message === 'string' ? body.message : `setups_${response.status}`, response.status, body.code);
  }
  return (await response.json()) as T;
}

function useToken() {
  const { getToken } = useAuth();
  return () => getToken();
}

export function useFollowedSetups(enabled: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: ['setups', 'list'],
    queryFn: async () => send<{ items: FollowedSetup[]; nextCursor: string | null }>('/api/setups?limit=20', { method: 'GET' }, await token()),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSetupForAnalysis(analysisId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['setups', 'by-analysis', analysisId],
    queryFn: async () =>
      send<{ setup: SetupSummary | null }>(`/api/setups/by-analysis/${encodeURIComponent(String(analysisId))}`, { method: 'GET' }, await token()),
    enabled: Boolean(analysisId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSetupVersions(setupId: string | null, pageSize = 20) {
  const token = useToken();
  return useInfiniteQuery({
    queryKey: ['setups', 'detail', setupId, pageSize],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (pageParam) params.set('cursor', String(pageParam));
      return send<{ setup: SetupSummary; versions: SetupVersion[]; nextCursor: string | null }>(
        `/api/setups/${encodeURIComponent(String(setupId))}?${params}`,
        { method: 'GET' },
        await token(),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(setupId),
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSetupActions() {
  const token = useToken();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['setups'] });
  const follow = useMutation({
    mutationFn: async (analysisId: string) =>
      send<{ setup: SetupSummary }>('/api/setups', { method: 'POST', body: JSON.stringify({ analysisId }) }, await token()),
    onSuccess: refresh,
  });
  const setStatus = useMutation({
    mutationFn: async (input: { setupId: string; status: 'untracked' | 'archived' }) =>
      send<{ setup: SetupSummary }>(
        `/api/setups/${encodeURIComponent(input.setupId)}`,
        { method: 'PATCH', body: JSON.stringify({ status: input.status }) },
        await token(),
      ),
    onSuccess: refresh,
  });
  return { follow, setStatus };
}

/** "Oct 10" no idioma da tela (com o ano quando nao e o ano corrente). */
export function formatSetupDay(iso: string, locale: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Data e hora da versao: o rotulo honesto e sempre "Analysis from <isto>". */
export function formatSetupMoment(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "2 days ago", "today" etc., no idioma da tela. */
export function formatSetupRelative(iso: string, locale: string, now = Date.now()): string {
  const days = Math.round((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(days) >= 1) return rtf.format(days, 'day');
  const hours = Math.round((new Date(iso).getTime() - now) / (60 * 60 * 1000));
  return Math.abs(hours) >= 1 ? rtf.format(hours, 'hour') : rtf.format(0, 'day');
}
