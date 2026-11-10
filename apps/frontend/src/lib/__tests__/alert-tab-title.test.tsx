import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeo } from '@/hooks/useSeo';
import { useAlertTabTitle, useSetupAlerts } from '@/lib/setups';

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: async () => 'token' }) }));

function usePage(unseen: number, label: string, path: string) {
  useSeo({ title: `${label} | Tickrify`, description: 'x', path, noindex: true });
  useAlertTabTitle(unseen, `${label}|${path}`);
}

describe('(N) no titulo da aba', () => {
  afterEach(cleanup);

  it('mantem o numero ao passar de uma analise para outra', () => {
    const { rerender } = renderHook(({ path }) => usePage(2, 'Analysis', path), { initialProps: { path: '/dashboard/analysis/a' } });
    expect(document.title).toBe('(2) Analysis | Tickrify');
    rerender({ path: '/dashboard/analysis/b' });
    expect(document.title).toBe('(2) Analysis | Tickrify');
  });

  it('tira o numero quando nao ha alerta sem ver', () => {
    const { rerender } = renderHook(({ unseen }) => usePage(unseen, 'Dashboard', '/dashboard'), { initialProps: { unseen: 1 } });
    expect(document.title).toBe('(1) Dashboard | Tickrify');
    rerender({ unseen: 0 });
    expect(document.title).toBe('Dashboard | Tickrify');
  });
});

describe('leitura de alertas com a aba em segundo plano', () => {
  const body = { items: [{ status: 'active' }], unseen: 0 };
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new QueryClient();
    fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    focusManager.setFocused(false);
  });
  afterEach(() => {
    cleanup();
    client.clear();
    focusManager.setFocused(undefined);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function callsAfterOneMinute(options?: { background?: boolean }) {
    renderHook(() => useSetupAlerts(true, null, options), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    return fetchSpy.mock.calls.length;
  }

  it('o painel continua lendo escondido', async () => {
    expect(await callsAfterOneMinute({ background: true })).toBe(2);
  });

  it('as outras telas param escondidas', async () => {
    expect(await callsAfterOneMinute()).toBe(1);
  });
});
