import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
// @ts-expect-error modulo .mjs do build, sem tipos
import { accuracyAnswer, accuracyFaqItems, accuracySummary, edgeAnswer, eurUsdNote, whatChangedIntro } from '../../../../scripts/geo-body.mjs';

vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => p }));
vi.mock('@/components/layout/SiteLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

import AccuracyPage from '@/components/pages/AccuracyPage';

// /accuracy com dois motores (04/11/2026): o motor atual medido pelo rastreador e o
// anterior arquivado com os numeros de antes (regra do candle do fill, 20/10/2026).
const interval = (wins: number, losses: number, rate: number | null) => ({
  n: wins + losses, wins, losses, rate, low: rate === null ? null : rate - 10, high: rate === null ? null : rate + 10,
  publishable: rate !== null,
});
const tracking = (o: Record<string, unknown> = {}) => ({ open: 0, awaiting: 0, skipped: 0, skippedReasons: {}, tracked: 0, ...o });
const previous = {
  firstRecordAt: '2026-07-01T09:00:00.000Z',
  groundingLiveSince: '2026-07-17T00:00:00.000Z',
  overall: interval(30, 45, 40),
  byConfidence: [
    { band: 'band60to69', ...interval(20, 30, 40) },
    { band: 'band70plus', ...interval(10, 15, 40) },
  ],
  byGrounding: { before: interval(0, 0, null), after: interval(30, 45, 40) },
  abstention: { wait: 10, total: 100, rate: 10 },
  breakdown: { WIN: 30, LOSS: 45 },
  stopOnly: { overall: interval(1, 2, null), breakdown: { WIN: 1, LOSS: 2 } },
  averageResult: { n: 75, decided: 75, excluded: 0, publishable: true, mean: -0.05, low: -0.3, high: 0.2, verdict: 'inconclusive' },
};
const current = {
  since: '2026-11-03T01:24:00.000Z',
  analyses: 40,
  byState: { ENTER_NOW: 6, WATCH: 14, NO_TRADE: 20 },
  dataMode: { real_data: 30, print: 10 },
  tracking: {
    ENTER_NOW: tracking({ open: 3, tracked: 3 }),
    WATCH: tracking({ open: 5, awaiting: 2, skipped: 3, skippedReasons: { no_source: 3 }, tracked: 4 }),
  },
  watch: {
    emitted: 14, outcomes: { reached: 2, invalidated: 1, expired: 1, unavailable: 3 },
    reachRate: { n: 4, publishable: false }, calibrationAvailable: false, calibration: [],
  },
  enterNow: {
    emitted: 6, resolved: 3, outcomes: { tp1: 1, stop: 2, timeout: 0 },
    hitRate: { n: 3, publishable: false }, averageResult: { n: 3, decided: 3, excluded: 0, publishable: false },
  },
  eurUsdBlock: { until: '2026-11-03T17:28:26.000Z', analyses: 2, closedWatch: 1, enterNow: 1 },
};
const base = {
  updatedAt: '2026-11-04T10:00:00.000Z',
  filters: { minResolvedToPublish: 20 },
  currentEngine: { major: 4, since: '2026-11-03T01:24:00.000Z' },
  previous,
  current,
};
const publishable = {
  ...base,
  previous: { ...previous, averageResult: { ...previous.averageResult, mean: -0.4, low: -0.6, high: -0.2, verdict: 'below' } },
  current: {
    ...current,
    enterNow: {
      ...current.enterNow, resolved: 25, hitRate: interval(10, 14, 41.7),
      averageResult: { n: 25, decided: 24, excluded: 0, publishable: true, mean: 0.3, low: 0.05, high: 0.55, verdict: 'above' },
    },
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

  it('motor atual abaixo do minimo: "Collecting data", rastreador por estado, sem enum na tela', async () => {
    renderWith(base);
    await screen.findByText('Current engine: results so far');
    expect(screen.getAllByText('Collecting data: 3 of 20').length).toBeGreaterThan(0);
    expect(screen.getByText('Collecting data: 4 of 20')).toBeTruthy();
    expect(screen.getByText('Enter now reached target before stop')).toBeTruthy();
    expect(screen.getByText('Window closed, waiting for the next tracker run')).toBeTruthy();
    expect(screen.getByText('Not checked: no price source for this instrument')).toBeTruthy();
    expect(screen.queryByText(/ENTER_NOW|NO_TRADE|\bWATCH\b/)).toBeNull();
  });

  it('anterior arquivado com os numeros intactos; titulo e datas vem da API; sem os numeros fixos do backtest', async () => {
    renderWith({ ...base, currentEngine: { major: 4, since: '2026-12-01T05:00:00Z' } });
    await screen.findByText('Previous engine (archived, until December 1, 2026)');
    expect(screen.getByText('What changed on December 1, 2026')).toBeTruthy();
    expect(screen.getByText('Hit rate, original scoring rule')).toBeTruthy();
    expect(screen.getByText('30 wins, 45 losses')).toBeTruthy();
    expect(screen.getByText('95% CI 30% to 50%, n = 75')).toBeTruthy();
    expect(screen.getByText('Updated scoring rule, separate series')).toBeTruthy();
    expect(screen.queryByText(/56%|never separated/)).toBeNull();
    expect(screen.getByText(/the 95% intervals of the 60 to 69 band \(30% to 50%\) and the 70 and above band \(30% to 50%\) overlap/)).toBeTruthy();
    expect(screen.getByText(/On July 17, 2026 we started feeding the AI real candles/)).toBeTruthy();
  });

  it('comparacao das faixas de confianca so com as duas publicaveis', async () => {
    renderWith({ ...base, previous: { ...previous, byConfidence: [{ band: 'band70plus', ...interval(10, 15, 40) }] } });
    await screen.findByText('Did the confidence score mean anything?');
    expect(screen.queryByText(/intervals of the 60 to 69 band/)).toBeNull();
  });

  it('a frase do resultado medio segue o veredito de cada motor', async () => {
    renderWith(base);
    await screen.findByText('Does Tickrify have an edge?', { selector: 'h2' });
    expect(screen.getAllByText(/Zero sits inside that interval/).length).toBeGreaterThan(0);
    cleanup();
    renderWith(publishable);
    await screen.findByText('Does Tickrify have an edge?', { selector: 'h2' });
    expect(screen.getAllByText(/Previous engine: .*The whole interval is below zero\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Current engine: the average result per trade was above zero after an estimated spread, before other costs, over 25 trades/).length).toBeGreaterThan(0);
  });

  it.each([
    ['abaixo do minimo', base],
    ['publicavel', publishable],
    ['rastreador fora', { ...base, current: null }],
  ])('pagina e HTML pre-renderizado dizem o mesmo (%s)', async (_name, payload) => {
    renderWith(payload);
    await screen.findByText('Questions people ask about Tickrify accuracy');
    const p = (text: string) => screen.getAllByText((_c, el) => (el?.tagName === 'P' || el?.tagName === 'STRONG') && el.textContent === text).length;
    expect(p(accuracyAnswer(payload))).toBeGreaterThan(0);
    const summary = accuracySummary(payload);
    if (summary) expect(p(summary)).toBeGreaterThan(0);
    expect(p(whatChangedIntro(payload))).toBe(1);
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
    expect(screen.queryByText(/Previous engine \(archived/)).toBeNull();
    expect(screen.queryByText(/40%/)).toBeNull();
  });
});
