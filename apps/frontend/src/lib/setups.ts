import { useEffect, useReducer } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError, buildApiUrl, type SignalState, type WatchSummary } from './api';

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
  /** Data da analise que comecou o setup (`createdAt` e quando passou a seguir). */
  firstAnalysisAt: string;
  versions: number;
  latest: {
    analysisId: string;
    createdAt: string;
    recommendation: SetupVerdict;
    signalState?: SignalState;
    entryCondition: string | null;
    watch?: WatchSummary | null;
  } | null;
}

export interface SetupVersion {
  analysisId: string;
  version: number;
  createdAt: string;
  recommendation: SetupVerdict;
  signalState?: SignalState;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  entryCondition: string | null;
  watch?: WatchSummary | null;
}

/**
 * Alertas de nivel (27/10/2026): o servidor vigia o nivel em candles reais
 * (1m em cripto, 5m em forex e ouro) e marca o alerta quando o preco chega la (e-mail atras da chave
 * EMAIL_SETUP_ALERTS). Criar um alerta segue o setup no mesmo clique.
 */
export type AlertLabel = 'entry' | 'stop' | 'tp1' | 'invalidation' | 'custom';

export interface SetupAlert {
  id: string;
  setupId: string;
  analysisId: string;
  symbol: string;
  timeframe: string | null;
  level: number;
  label: AlertLabel;
  side: 'above' | 'below';
  status: 'active' | 'triggered' | 'cancelled';
  createdAt: string;
  triggeredAt: string | null;
  triggerPrice: number | null;
  seenAt: string | null;
  lastPrice: number | null;
  checkedAt: string | null;
  /** Intervalo em vigor no servidor; null = ainda nao checado ou mercado fechado. */
  checkIntervalMs?: number | null;
  marketClosed?: boolean;
}

export interface WatchingItem {
  analysisId: string;
  symbol: string | null;
  timeframe: string | null;
  createdAt: string;
  watch: WatchSummary;
  lastPrice: number | null;
  checkedAt: string | null;
  checkIntervalMs: number | null;
  marketClosed: boolean;
  alert: { id: string; setupId: string; status: SetupAlert['status']; triggeredAt: string | null; seenAt: string | null } | null;
}

export interface SetupAlertList {
  /** Conta travada (gratis esgotado): alertas pausados, nenhum devolvido. */
  paused: boolean;
  pausedSymbol: string | null;
  items: SetupAlert[];
  unseen: number;
  emailEnabled: boolean;
}

export interface SetupAlertOptions {
  available: boolean;
  symbol: string | null;
  symbolClass: 'crypto' | 'forex' | 'metal' | null;
  referencePrice: number | null;
  suggestions: Array<{ label: Exclude<AlertLabel, 'custom'>; level: number }>;
  setupId: string | null;
  alerts: SetupAlert[];
  /** WATCH com alerta valendo no nivel do plano. */
  watchAlert?: SetupAlert | null;
  /** WATCH recem-concluido: o servidor ainda vai gravar o alerta automatico. */
  autoAlertPending?: boolean;
  limits: { perSetup: number; maxSetups: number; setupsUsed: number };
  emailEnabled: boolean;
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

export function useSetupAlerts(enabled: boolean, setupId: string | null = null, options: { background?: boolean } = {}) {
  const token = useToken();
  return useQuery({
    queryKey: ['setups', 'alerts', setupId],
    queryFn: async () =>
      send<SetupAlertList>(
        `/api/setups/alerts${setupId ? `?setupId=${encodeURIComponent(setupId)}` : ''}`,
        { method: 'GET' },
        await token(),
      ),
    enabled,
    staleTime: 60_000,
    // O monitor roda a cada minuto: so vale reler rapido com nivel sendo vigiado.
    refetchInterval: (query) => (query.state.data?.items?.some((a) => a.status === 'active') ? 60_000 : 5 * 60_000),
    // So o painel pede: o "(N)" do titulo existe para chamar quem esta em outra aba.
    refetchIntervalInBackground: options.background ?? false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * "(1) Dashboard | Tickrify": alerta disparado e ainda nao aberto. `routeKey`
 * muda sempre que o `useSeo` regrava o titulo (area ou endereco), senao o
 * numero some ao passar de uma analise para outra.
 */
export function useAlertTabTitle(unseen: number, routeKey: string) {
  useEffect(() => {
    if (unseen <= 0) return;
    document.title = `(${unseen}) ${document.title.replace(/^\(\d+\) /, '')}`;
    return () => {
      document.title = document.title.replace(/^\(\d+\) /, '');
    };
  }, [unseen, routeKey]);
}

/** WATCH valendo e encerrados ha ate 7 dias: secao "Watching" do My Trades e do Diario. */
export function useWatching(enabled: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: ['setups', 'watching'],
    queryFn: async () => send<{ items: WatchingItem[] }>('/api/setups/watching', { method: 'GET' }, await token()),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useAlertOptions(analysisId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['setups', 'alert-options', analysisId],
    queryFn: async () =>
      send<SetupAlertOptions>(`/api/setups/alerts/options/${encodeURIComponent(String(analysisId))}`, { method: 'GET' }, await token()),
    enabled: Boolean(analysisId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) => (query.state.data?.autoAlertPending ? 2_000 : false),
  });
}

export function useAlertActions() {
  const token = useToken();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['setups'] });
  const create = useMutation({
    mutationFn: async (input: { analysisId: string; label: AlertLabel; level: number }) =>
      send<{ alert: SetupAlert; setupId: string }>('/api/setups/alerts', { method: 'POST', body: JSON.stringify(input) }, await token()),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: async (alertId: string) =>
      send<{ alert: SetupAlert }>(`/api/setups/alerts/${encodeURIComponent(alertId)}/cancel`, { method: 'POST' }, await token()),
    onSuccess: refresh,
  });
  const seen = useMutation({
    mutationFn: async (alertId: string) =>
      send<{ alert: SetupAlert }>(`/api/setups/alerts/${encodeURIComponent(alertId)}/seen`, { method: 'POST' }, await token()),
    onSuccess: refresh,
  });
  return { create, cancel, seen };
}

/** Nivel no formato da tela (sem perder as casas do forex). */
export function formatAlertLevel(level: number, locale: string): string {
  return level.toLocaleString(locale, { maximumFractionDigits: level >= 1000 ? 2 : level >= 1 ? 5 : 8 });
}

/** "13:42 UTC": a hora do monitor e do e-mail e sempre em UTC. */
export function formatUtcTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

/** Distancia do ultimo preco checado ate o nivel, em %, com sinal. null sem preco. */
export function alertDistancePct(alert: Pick<SetupAlert, 'level' | 'lastPrice'>): number | null {
  if (!alert.lastPrice || alert.lastPrice <= 0) return null;
  return ((alert.level - alert.lastPrice) / alert.lastPrice) * 100;
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

/** "Checked every 5 minutes": o intervalo real do servidor. null = nao ha o que afirmar. */
export function checkFrequencyText(
  a: { everyMinute: string; everyMinutes: string; marketClosed: string },
  check: { checkIntervalMs?: number | null; marketClosed?: boolean } | undefined,
): string | null {
  if (check?.marketClosed) return a.marketClosed;
  if (!check?.checkIntervalMs) return null;
  const minutes = Math.round(check.checkIntervalMs / 60_000);
  return minutes <= 1 ? a.everyMinute : a.everyMinutes.replace('{n}', String(minutes));
}

/** "2 days ago", "today" etc., no idioma da tela. */
export function formatSetupRelative(iso: string, locale: string, now = Date.now()): string {
  const days = Math.round((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(days) >= 1) return rtf.format(days, 'day');
  const hours = Math.round((new Date(iso).getTime() - now) / (60 * 60 * 1000));
  return Math.abs(hours) >= 1 ? rtf.format(hours, 'hour') : rtf.format(0, 'day');
}

/**
 * Le o preco que a pessoa digitou: "4180.5", "4,180.5", "4.180,5", "1,0952".
 * Com os dois separadores, o ultimo e o decimal; so virgula, ela e decimal se
 * nao separar milhar (3 digitos depois). null = nao e um preco.
 */
export function parseAlertLevel(raw: string): number | null {
  let text = raw.replace(/[\s'_]/g, '');
  if (!text) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const MINUTE = 60_000;

/** "2 d 4 h", "3 h 20 min", "12 min" no idioma da tela. */
export function formatTimeLeft(ms: number, locale: string): string {
  const unit = (value: number, u: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(value);
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours > 0) return mins > 0 ? `${unit(hours, 'hour')} ${unit(mins, 'minute')}` : unit(hours, 'hour');
  return unit(mins, 'minute');
}

/** WATCH ainda valendo: sem desfecho e antes do fim da validade. */
export function isWatchOpen(watch: WatchSummary | null | undefined, now = Date.now()): boolean {
  return Boolean(watch && watch.outcome === 'pending' && watch.expiresAt && Date.parse(watch.expiresAt) > now);
}

export type WatchTone = 'watching' | 'target' | 'stopped' | 'neutral' | 'checking';

/** O que o mercado fez com o WATCH. Fora de P&L, acerto do usuario e /accuracy. */
export function watchTone(watch: WatchSummary, now = Date.now()): WatchTone {
  if (watch.outcome === 'pending') return watch.expiresAt === null || Date.parse(watch.expiresAt) > now ? 'watching' : 'checking';
  if (watch.outcome === 'reached' && watch.afterReach === 'target') return 'target';
  if (watch.outcome === 'reached' && watch.afterReach === 'invalidation') return 'stopped';
  return 'neutral';
}

const GRAY_CHIP = 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]';
export const WATCH_TONE_CLASSES: Record<WatchTone, string> = {
  watching: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] text-[var(--signal-hold)]',
  target: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]',
  stopped: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] text-[var(--signal-sell)]',
  neutral: GRAY_CHIP,
  checking: GRAY_CHIP,
};

export const WATCH_TONE_DOT: Record<WatchTone, string> = {
  watching: 'bg-[var(--signal-hold)]',
  target: 'bg-[var(--signal-buy)]',
  stopped: 'bg-[var(--signal-sell)]',
  neutral: 'bg-[var(--text-muted)]',
  checking: 'bg-[var(--text-muted)]',
};

/** Fundo do dia no Diario sem P&L: o desfecho ganha do laranja; alvo e stop no mesmo dia, neutro. */
export function watchDayTint(tones: readonly WatchTone[]): string | null {
  const target = tones.includes('target');
  const stopped = tones.includes('stopped');
  if (target !== stopped) return target ? 'var(--signal-buy-bg)' : 'var(--signal-sell-bg)';
  if (target || tones.includes('neutral') || tones.includes('checking')) return null;
  return tones.includes('watching') ? 'var(--signal-hold-bg)' : null;
}

/** Acorda na proxima validade. Janelas semanais podem exceder o limite de setTimeout. */
export function useExpiryClock(expires: number, fixedNow?: number): number {
  const now = fixedNow ?? Date.now();
  const future = expires > now;
  const [tick, wake] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (fixedNow !== undefined || !future || !Number.isFinite(expires)) return;
    const delay = expires - Date.now();
    const timer = setTimeout(wake, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [expires, fixedNow, future, tick]);
  return now;
}

export function hasActiveLevel(items: SetupAlert[], setupId: string | null | undefined, analysisId: string, level: number): boolean {
  // A lista pode anteceder o primeiro clique, que acabou de vincular a analise ao setup.
  const id = setupId ?? items.find((item) => item.analysisId === analysisId)?.setupId;
  return Boolean(id && items.some((item) => item.setupId === id && item.status === 'active' && item.level === level));
}
