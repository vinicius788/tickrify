import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo .mjs do build, sem tipos
import { accuracyAnswer, accuracyBlock, accuracyFaqItems, accuracySummary, buildBody, buildJsonLd, edgeAnswer, edgeSentence, eurUsdNote } from '../../../scripts/geo-body.mjs';

// HTML pre-renderizado da /accuracy: motor atual x motor anterior (04/11/2026),
// resultado medio por trade em R, rastreador e datas/minimo vindos da API.
const interval = (wins: number, losses: number, rate: number | null) => ({
  n: wins + losses, wins, losses, rate, low: rate === null ? null : rate - 10, high: rate === null ? null : rate + 10,
  publishable: rate !== null,
});
const tracking = (o: Partial<{ open: number; awaiting: number; skipped: number; skippedReasons: Record<string, number>; tracked: number }> = {}) => ({
  open: 0, awaiting: 0, skipped: 0, skippedReasons: {}, tracked: 0, ...o,
});
const previous = {
  firstRecordAt: '2026-07-01T09:00:00.000Z',
  groundingLiveSince: '2026-07-17T00:00:00.000Z',
  overall: interval(30, 45, 40),
  byConfidence: [],
  byGrounding: { before: interval(0, 0, null), after: interval(30, 45, 40) },
  abstention: { wait: 10, total: 100, rate: 10 },
  breakdown: { WIN: 30, LOSS: 45 },
  stopOnly: { overall: interval(0, 0, null), breakdown: {} },
  averageResult: { n: 75, decided: 75, excluded: 2, publishable: true, mean: -0.05, low: -0.3, high: 0.2, verdict: 'inconclusive' },
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
  eurUsdBlock: { until: '2026-11-03T17:28:26.000Z', analyses: 0, closedWatch: 0, enterNow: 0 },
};
const base = {
  updatedAt: '2026-11-04T10:00:00.000Z',
  filters: { minResolvedToPublish: 20 },
  currentEngine: { major: 4, since: '2026-11-03T01:24:00.000Z' },
  previous,
  current,
};

describe('geo-body: /accuracy com dois motores', () => {
  it('abertura do dono com data e minimo da API; numeros so no resumo, motor atual primeiro', () => {
    const answer: string = accuracyAnswer(base);
    expect(answer.startsWith('Tickrify does not claim an edge. Since November 3, 2026, a new engine decides between three states: Enter now, Watch and No trade.')).toBe(true);
    expect(answer).toContain('A result is published once a cut has at least 20 resolved cases.');
    const other: string = accuracyAnswer({ ...base, filters: { minResolvedToPublish: 30 }, currentEngine: { major: 4, since: '2026-12-01T05:00:00Z' } });
    expect(other).toContain('Since December 1, 2026');
    expect(other).toContain('at least 30 resolved cases');
    expect(accuracyAnswer(null)).not.toMatch(/\d/);
    const summary: string = accuracySummary(base);
    expect(summary.startsWith('As of 2026-11-04, the current engine has made 40 analyses: 6 Enter now, 14 Watch and 20 No trade, 30 of them read with live candle data.')).toBe(true);
    expect(summary).toContain('Enter now results: collecting data, 3 of 20 resolved at target or stop.');
    expect(summary).toMatch(/The previous engine, archived, recorded 40% across 75 resolved trades.*never added together\.$/);
    expect(accuracyFaqItems(base)[0].a).toBe(`${answer} ${summary}`);
  });

  it('frase do resultado medio pelo veredito; "above" nunca fala em edge ou lucro', () => {
    const ar = (verdict: string) => ({ n: 30, decided: 30, excluded: 0, publishable: true, mean: 0.2, low: 0.05, high: 0.35, verdict });
    const above: string = edgeSentence('Previous engine', ar('above'), 'before costs', 20);
    expect(above).toBe('Previous engine: the average result per trade was above zero before costs, over 30 trades: +0.20R (95% CI +0.05R to +0.35R).');
    expect(above).not.toMatch(/edge|profit/i);
    expect(edgeSentence('X', ar('below'), 'before costs', 20)).toContain('The whole interval is below zero.');
    expect(edgeSentence('X', ar('inconclusive'), 'before costs', 20)).toContain('Zero sits inside that interval');
    expect(edgeSentence('X', { n: 20, decided: 1, excluded: 0, publishable: false }, 'before costs', 20)).toBe(
      'X: still collecting data, 1 of 20 trades resolved at target or stop, so no average result is published yet.',
    );
    expect(edgeAnswer(base)).toContain('Current engine: still collecting data, 3 of 20');
    expect(edgeAnswer(base)).toContain('Previous engine: the average result was -0.05R per trade (95% CI -0.30R to +0.20R), before costs, over 75 trades. Zero sits inside that interval');
    expect(edgeAnswer(base)).toContain('2 more trades had no valid R and are left out.');
    expect(edgeAnswer(base)).not.toMatch(/break-even/i);
  });

  it('bloco: rastreador por motivo, motor anterior com os rotulos e titulo com a data da API', () => {
    const html: string = accuracyBlock(base);
    expect(html).toContain('<tr><td>Window closed, waiting for the next tracker run</td><td>0</td><td>2</td></tr>');
    expect(html).toContain('<tr><td>Not checked: no price source for this instrument</td><td>0</td><td>3</td></tr>');
    expect(html).toContain('Previous engine (archived, until November 3, 2026)');
    expect(html).toContain('Hit rate, original scoring rule');
    expect(html).toContain('Hit rate, updated scoring rule (separate series)');
    expect(html).toContain('Collecting data: 3 of 20');
    expect(html).not.toMatch(/ENTER_NOW|NO_TRADE|WATCH/);
  });

  it('sem API ou com API antiga (sem previous): nada de numero', () => {
    expect(accuracyBlock(null)).toBe('');
    expect(accuracyBlock({ updatedAt: 'x', overall: interval(1, 1, 50) })).toBe('');
    expect(accuracySummary(null)).toBeNull();
    expect(accuracyFaqItems(null).every((i: { a: string }) => !/As of|\d+ (current-engine|so far)|recorded \d/.test(i.a))).toBe(true);
  });

  it('nota do EUR/USD: horarios e data da API, contagem com e sem analises na janela', () => {
    expect(eurUsdNote(base)).toContain('from 01:24 to 17:28 UTC on November 3, 2026');
    expect(eurUsdNote(base)).toContain('No gold or forex analysis in the published sample was made in that window.');
    const flagged = { ...base, current: { ...current, eurUsdBlock: { ...current.eurUsdBlock, analyses: 3, enterNow: 1, closedWatch: 2 } } };
    expect(eurUsdNote(flagged)).toContain('3 gold and forex analyses in the published sample were made in that window (1 Enter now, 2 Watch');
    expect(eurUsdNote({ ...base, current: null })).toBeNull();
  });

  it('corpo e JSON-LD: H1, regras de quem conta, FAQPage das mesmas strings, temporalCoverage do registro mais antigo', () => {
    const body: string = buildBody({ path: '/accuracy', meta: { title: 't', description: 'd' }, copy: null, accuracy: base, pricingFaq: [] });
    expect(body).toContain('<h1>How accurate is Tickrify? Here is how we measure it</h1>');
    expect(body).toContain('What changed on November 3, 2026');
    expect(body).toMatch(/Without live candles, the entry, stop and targets are the AI(&#39;|&#x27;|')s own estimates read from the screenshot/);
    expect(body).toContain('Who is counted, current engine: analyses from free, trial and paid accounts all count');
    expect(body).toContain('Who is counted, previous engine: only analyses made with paid access');
    const ld = buildJsonLd({ path: '/accuracy', copy: null, accuracy: base, offer: null, pricingFaq: [] });
    const [dataset, faq] = ld.data['@graph'];
    expect(dataset.temporalCoverage).toBe('2026-07-01/..');
    expect(dataset.measurementTechnique).toContain('Cuts below n = 20');
    expect(faq.mainEntity.map((q: { acceptedAnswer: { text: string } }) => q.acceptedAnswer.text)).toEqual(
      accuracyFaqItems(base).map((i: { a: string }) => i.a),
    );
    const byName = Object.fromEntries(dataset.variableMeasured.map((v: { name: string }) => [v.name, v]));
    expect(byName['Current engine Enter now hit rate'].value).toBeUndefined();
    expect(byName['Previous engine hit rate'].value).toBe(40);
  });
});
