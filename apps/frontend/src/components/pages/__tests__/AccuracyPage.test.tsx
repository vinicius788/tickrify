import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => p }));
vi.mock('@/components/layout/SiteLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

import AccuracyPage from '@/components/pages/AccuracyPage';

// Regra do candle do fill (20/10/2026, opcao c): os numeros principais seguem a
// regra original; a regra nova aparece numa serie a parte, nunca somada.
const interval = (wins: number, losses: number, rate: number | null) => ({
  n: wins + losses, wins, losses, rate, low: rate === null ? null : rate - 10, high: rate === null ? null : rate + 10,
  publishable: rate !== null,
});
const base = {
  updatedAt: '2026-10-21T10:00:00.000Z',
  groundingLiveSince: '2026-07-17T00:00:00.000Z',
  overall: interval(30, 45, 40),
  byConfidence: [],
  byGrounding: { before: interval(0, 0, null), after: interval(30, 45, 40) },
  abstention: { wait: 10, total: 100, rate: 10 },
  breakdown: { WIN: 30, LOSS: 45 },
};

function renderWith(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccuracyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccuracyPage e a regra do candle do fill', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('API sem stopOnly (antiga): numeros principais pela regra original e sem a serie nova', async () => {
    renderWith(base);
    await screen.findByText('Hit rate, original scoring rule');
    expect(screen.queryByText('Updated scoring rule, separate series')).toBeNull();
    expect(screen.queryByText('Hit rate, all resolved analyses')).toBeNull();
    expect(screen.getByText(/Fill candle: the headline figures use the original rule/)).toBeTruthy();
  });

  it('com stopOnly: a serie nova aparece a parte e nao muda o numero principal', async () => {
    renderWith({ ...base, stopOnly: { overall: interval(1, 2, null), breakdown: { WIN: 1, LOSS: 2 } } });
    await screen.findByText('Updated scoring rule, separate series');
    // Abaixo do n minimo: so o n, nunca uma taxa.
    expect(screen.getByText('Reached target before stop, updated rule')).toBeTruthy();
    expect(screen.getAllByText('n = 3').length).toBeGreaterThan(0);
    expect(screen.getByText(/not evidence\s+of better or worse performance/)).toBeTruthy();
    // O numero principal continua o da regra original (30 W, 45 L).
    await waitFor(() => expect(screen.getAllByText('40%').length).toBeGreaterThan(0));
    expect(screen.getByText('30 wins, 45 losses')).toBeTruthy();
  });
});
