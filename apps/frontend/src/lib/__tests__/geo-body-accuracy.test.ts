import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo .mjs do build, sem tipos
import { accuracyAnswer, accuracyBlock, accuracyFaqItems, accuracySummary, buildBody, buildJsonLd, edgeAnswer, eurUsdNote } from '../../../scripts/geo-body.mjs';

// HTML pre-renderizado da /accuracy: motor atual x motor anterior (04/11/2026) e a
// regra do candle do fill do motor anterior (20/10/2026, opcao c).
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
  stopOnly: { overall: interval(0, 0, null), breakdown: {} },
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
  eurUsdBlock: { until: '2026-11-03T17:28:26.000Z', analyses: 0, closedWatch: 0, enterNow: 0 },
};
const base = {
  updatedAt: '2026-11-04T10:00:00.000Z',
  filters: { isDemo: false, strategyHash: null, minResolvedToPublish: 20 },
  currentEngine: { major: 4, since: '2026-11-03T01:24:00.000Z' },
  previous,
  current,
};

describe('geo-body: /accuracy com dois motores', () => {
  it('motor atual com menos de 20: so o n, "Collecting data", e o anterior com a taxa', () => {
    const answer: string = accuracyAnswer();
    expect(answer.startsWith('Tickrify does not claim an edge. Since November 3, 2026, a new engine decides between three states: Enter now, Watch and No trade.')).toBe(true);
    expect(answer).not.toMatch(/\d+%/);
    const summary: string = accuracySummary(base);
    expect(summary.startsWith('As of 2026-11-04, the current engine has made 40 analyses: 6 Enter now, 14 Watch and 20 No trade, 30 of them read with live candle data.')).toBe(true);
    expect(summary).toContain('Enter now results: collecting data, 3 of 20 resolved at target or stop.');
    expect(summary).toContain('Watch results: collecting data, 4 of 20 resolved.');
    expect(summary).toMatch(/The previous engine, archived, recorded 40% across 75 resolved trades.*never added together\.$/);
    expect(accuracyFaqItems(base)[0].a).toBe(`${answer} ${summary}`);
    const html: string = accuracyBlock(base);
    expect(html).toContain('Collecting data: 3 of 20');
    expect(html).toContain('Collecting data: 4 of 20');
    expect(html).not.toMatch(/Enter now reached target before stop<\/td><td>\d/);
    expect(html).not.toMatch(/ENTER_NOW|NO_TRADE|WATCH/);
  });

  it('o anterior mantem os rotulos e a serie da regra nova a parte', () => {
    const html: string = accuracyBlock(base);
    expect(html).toContain('Previous engine (archived, until November 3, 2026)');
    expect(html).toContain('Hit rate, original scoring rule');
    expect(html).toContain('Hit rate, updated scoring rule (separate series)');
    expect(html).toContain('40% (95% CI 30% to 50%)');
  });

  it('a frase do edge segue o veredito da API', () => {
    expect(edgeAnswer(base)).toContain('Break-even sits inside that interval');
    expect(edgeAnswer({ ...base, previous: { ...previous, edge: 'below' } })).toContain('stayed below the break-even rate');
    expect(edgeAnswer({ ...base, previous: { ...previous, edge: 'above' } })).toContain('was above the break-even rate');
    expect(edgeAnswer(base)).toContain('Current engine: still collecting data, 3 of 20');
  });

  it('com o motor atual publicavel: taxa, R liquido assinado e break-even', () => {
    const data = {
      ...base,
      current: {
        ...current,
        enterNow: { ...current.enterNow, resolved: 25, hitRate: interval(10, 14, 41.7), avgNetR: -0.123, avgRewardTp1: 1.4, breakEvenRate: 41.7, edge: 'inconclusive' },
      },
    };
    expect(accuracySummary(data)).toContain('24 Enter now plans resolved at target or stop: 41.7% reached the first target');
    expect(edgeAnswer(data)).toContain('-0.12R');
    expect(accuracyBlock(data)).toContain('-0.12R');
  });

  it('sem API ou com API antiga (sem previous): nada de numero', () => {
    expect(accuracyBlock(null)).toBe('');
    expect(accuracyBlock({ updatedAt: 'x', overall: interval(1, 1, 50) })).toBe('');
    expect(accuracySummary(null)).toBeNull();
    expect(accuracyFaqItems(null).every((i: { a: string }) => !/As of|\d+ (current-engine|so far)|recorded \d/.test(i.a))).toBe(true);
  });

  it('nota do EUR/USD pela contagem: com e sem analises na janela', () => {
    expect(eurUsdNote(base)).toContain('No gold or forex analysis in the published sample was made in that window.');
    const flagged = { ...base, current: { ...current, eurUsdBlock: { ...current.eurUsdBlock, analyses: 3, enterNow: 1, closedWatch: 2 } } };
    expect(eurUsdNote(flagged)).toContain('3 gold and forex analyses in the published sample were made in that window (1 Enter now, 2 Watch');
    expect(eurUsdNote({ ...base, current: null })).toBeNull();
  });

  it('corpo e JSON-LD da rota: H1 novo, FAQPage das mesmas strings, valores so com n publicavel', () => {
    const body: string = buildBody({ path: '/accuracy', meta: { title: 't', description: 'd' }, copy: null, accuracy: base, pricingFaq: [] });
    expect(body).toContain('<h1>How accurate is Tickrify? Here is how we measure it</h1>');
    expect(body).toContain('What changed on November 3, 2026');
    expect(body).toContain('Who is counted, current engine: analyses from free, trial and paid accounts all count');
    expect(body).toContain('Who is counted, previous engine: only analyses made with paid access');
    const ld = buildJsonLd({ path: '/accuracy', copy: null, accuracy: base, offer: null, pricingFaq: [] });
    const [dataset, faq] = ld.data['@graph'];
    expect(faq.mainEntity.map((q: { acceptedAnswer: { text: string } }) => q.acceptedAnswer.text)).toEqual(
      accuracyFaqItems(base).map((i: { a: string }) => i.a),
    );
    const byName = Object.fromEntries(dataset.variableMeasured.map((v: { name: string }) => [v.name, v]));
    expect(byName['Current engine Enter now hit rate'].value).toBeUndefined();
    expect(byName['Previous engine hit rate'].value).toBe(40);
  });
});
