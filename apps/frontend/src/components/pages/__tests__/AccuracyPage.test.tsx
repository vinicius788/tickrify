import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
// @ts-expect-error modulo .mjs do build, sem tipos
import { accuracyAnswer, accuracyFaqItems, accuracySummary, edgeAnswer, eurUsdNote } from '../../../../scripts/geo-body.mjs';

vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => p }));
vi.mock('@/components/layout/SiteLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

import AccuracyPage from '@/components/pages/AccuracyPage';

// /accuracy com dois motores (04/11/2026): o motor atual medido pelo rastreador e o
// anterior arquivado com os numeros de antes (regra do candle do fill, 20/10/2026).
const interval = (wins: number, losses: number, rate: number | null) => ({
  n: wins + losses, wins, losses, rate, low: rate === null ? null : rate - 10, high: rate === null ? null : rate + 10,
  publishable: rate !== null,
});
const previous = {
  groundingLiveSince: '2026-07-17T00:00:00.000Z',
  overall: interval(30, 45, 40),
  byConfidence: [],
  byGrounding: { before: interval(0, 0, null), after: interval(30, 45, 40) },
  abstention: { wait: 10, total: 100, rate: 10 },
  breakdown: { WIN: 30, LOSS: 45 },
  stopOnly: { overall: interval(1, 2, null), breakdown: { WIN: 1, LOSS: 2 } },
  avgRewardTp1: 1.2,
  breakEvenRate: 45.5,
  edge: 'inconclusive',
};
const current = {
  since: '2026-11-03T01:24:00.000Z',
  analyses: 40,
  byState: { ENTER_NOW: 6, WATCH: 14, NO_TRADE: 20 },
  dataMode: { real_data: 30, print: 10 },
  watch: {
    emitted: 14, open: 9, closed: 5, outcomes: { reached: 2, invalidated: 1, expired: 1, unavailable: 1 },
    reachRate: { n: 4, publishable: false }, calibrationAvailable: false, calibration: [],
  },
  enterNow: {
    emitted: 6, open: 3, notScored: 0, resolved: 3, outcomes: { tp1: 1, stop: 2, timeout: 0 },
    hitRate: { n: 3, publishable: false }, avgNetR: null, avgRewardTp1: null, breakEvenRate: null, edge: null,
  },
  eurUsdBlock: { until: '2026-11-03T17:28:26.000Z', analyses: 2, closedWatch: 1, enterNow: 1 },
};
const base = {
  updatedAt: '2026-11-04T10:00:00.000Z',
  filters: { isDemo: false, strategyHash: null, minResolvedToPublish: 20 },
  currentEngine: { major: 4, since: '2026-11-03T01:24:00.000Z' },
  previous,
  current,
};
const publishable = {
  ...base,
  previous: { ...previous, edge: 'below' },
  current: {
    ...current,
    enterNow: { ...current.enterNow, resolved: 25, hitRate: interval(10, 14, 41.7), avgNetR: 0.051, avgRewardTp1: 1.4, breakEvenRate: 41.7, edge: 'above' },
  },
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

describe('AccuracyPage com motor atual e anterior', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('motor atual com menos de 20: "Collecting data", sem taxa', async () => {
    renderWith(base);
    await screen.findByText('Current engine: results so far');
    expect(screen.getAllByText('Collecting data: 3 of 20').length).toBeGreaterThan(0);
    expect(screen.getByText('Collecting data: 4 of 20')).toBeTruthy();
    expect(screen.getByText('Enter now reached target before stop')).toBeTruthy();
    expect(screen.queryByText(/ENTER_NOW|NO_TRADE|\bWATCH\b/)).toBeNull();
  });

  it('anterior arquivado com os numeros intactos e a serie da regra nova a parte', async () => {
    renderWith(base);
    await screen.findByText('Previous engine (archived, until November 3, 2026)');
    expect(screen.getByText('Hit rate, original scoring rule')).toBeTruthy();
    expect(screen.getByText('30 wins, 45 losses')).toBeTruthy();
    expect(screen.getByText('95% CI 30% to 50%, n = 75')).toBeTruthy();
    expect(screen.getByText('Updated scoring rule, separate series')).toBeTruthy();
    expect(screen.getByText('Reached target before stop, updated rule')).toBeTruthy();
    expect(screen.getByText(/not evidence of better or worse performance/)).toBeTruthy();
  });

  it('a frase do edge segue o dado: dentro, abaixo e acima do empate', async () => {
    renderWith(base);
    await screen.findByText('Does Tickrify have an edge?', { selector: 'h2' });
    expect(screen.getAllByText(/Break-even sits inside that interval/).length).toBeGreaterThan(0);
    cleanup();
    renderWith(publishable);
    await screen.findByText('Does Tickrify have an edge?', { selector: 'h2' });
    expect(screen.getAllByText(/Previous engine: .*stayed below the break-even rate/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Current engine: .*was above the break-even rate/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+0\.05R/).length).toBeGreaterThan(0);
  });

  it.each([
    ['menos de 20', base],
    ['publicavel', publishable],
    ['rastreador fora', { ...base, current: null }],
  ])('pagina e HTML pre-renderizado dizem o mesmo (%s)', async (_name, payload) => {
    renderWith(payload);
    await screen.findByText('Questions people ask about Tickrify accuracy');
    const p = (text: string) => screen.getAllByText((_c, el) => el?.tagName === 'P' && el.textContent === text).length;
    expect(p(accuracyAnswer())).toBeGreaterThan(0);
    const summary = accuracySummary(payload);
    if (summary) expect(p(summary)).toBeGreaterThan(0);
    expect(p(edgeAnswer(payload))).toBeGreaterThan(0);
    for (const item of accuracyFaqItems(payload) as Array<{ q: string; a: string }>) {
      expect(screen.getByText(item.q, { selector: 'h3' })).toBeTruthy();
      expect(p(item.a)).toBeGreaterThan(0);
    }
    const note = eurUsdNote(payload);
    if (note) expect(p(note)).toBe(1);
    else expect(screen.queryByText(/Note on gold and forex/)).toBeNull();
  });

  it('API antiga (sem previous): so a resposta sem numero, nada de tabela', async () => {
    renderWith({ updatedAt: '2026-11-04T10:00:00.000Z', overall: interval(30, 45, 40) });
    await screen.findByText('How accurate is Tickrify? Here is how we measure it');
    expect(screen.queryByText('Previous engine (archived, until November 3, 2026)')).toBeNull();
    expect(screen.queryByText(/40%/)).toBeNull();
  });
});
