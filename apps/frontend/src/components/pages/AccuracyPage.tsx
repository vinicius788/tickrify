import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SiteLayout from '@/components/layout/SiteLayout';
import { buildApiUrl } from '@/lib/api';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';

/**
 * Página pública de acurácia, Fase 5 da auditoria de 24/07/2026.
 *
 * Regras que não mudam:
 *  1. Nenhum número sem n e sem intervalo de confiança.
 *  2. Recorte com n abaixo do mínimo mostra o n e diz que ainda não dá pra concluir.
 *  3. Se a API não responder, a página diz isso, nunca inventa número.
 *
 * 04/11/2026: dois registros que nunca se somam. O motor atual (v11) é medido
 * pelo rastreador pelo que entrega; o motor anterior fica arquivado com todos os
 * números de antes. Datas, mínimo de publicação e toda frase que depende do dado
 * (resultado médio abaixo, acima ou em torno de zero) vêm da API.
 *
 * Os textos abaixo (até `trackingRows`) são gerados da MESMA fonte que o
 * scripts/geo-body.mjs usa no HTML pré-renderizado; o teste AccuracyPage.test.tsx
 * confere que página e HTML cru dizem o mesmo.
 */

/** Data da última revisão do TEXTO da página (os números têm o updatedAt da API). */
const LAST_UPDATED = 'November 4, 2026';

interface Interval {
  n: number;
  wins: number;
  losses: number;
  rate: number | null;
  low: number | null;
  high: number | null;
  publishable: boolean;
}
/** Recorte do motor atual: abaixo do mínimo a API manda só o n. */
type Gated = Interval | { n: number; publishable: false };
type AverageResult =
  | { n: number; decided: number; excluded: number; publishable: false }
  | { n: number; decided: number; excluded: number; publishable: true; mean: number; low: number; high: number; verdict: 'below' | 'above' | 'inconclusive' };
interface Tracking {
  open: number;
  awaiting: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  tracked: number;
}

interface Previous {
  firstRecordAt: string | null;
  groundingLiveSince: string;
  overall: Interval;
  byConfidence: Array<Interval & { band: 'below60' | 'band60to69' | 'band70plus' | 'unknown' }>;
  byGrounding: { before: Interval; after: Interval };
  abstention: { wait: number; total: number; rate: number | null };
  breakdown: Record<string, number>;
  stopOnly: { overall: Interval; breakdown: Record<string, number> };
  averageResult: AverageResult;
}

interface Current {
  since: string;
  analyses: number;
  byState: Record<string, number>;
  dataMode: Record<string, number>;
  tracking: { ENTER_NOW: Tracking; WATCH: Tracking };
  watch: {
    emitted: number;
    outcomes: { reached: number; invalidated: number; expired: number; unavailable: number };
    reachRate: Gated;
    calibrationAvailable: boolean;
    calibration: Array<{ band: string; n: number; publishable: boolean; predicted?: number | null; observed?: Interval }>;
  };
  enterNow: {
    emitted: number;
    resolved: number;
    outcomes: { tp1: number; stop: number; timeout: number };
    hitRate: Gated;
    averageResult: AverageResult;
  };
  eurUsdBlock: { until: string; analyses: number; closedWatch: number; enterNow: number };
}

interface AccuracyPayload {
  updatedAt: string;
  filters: { minResolvedToPublish: number };
  currentEngine: { major: number; since: string };
  previous: Previous;
  current: Current | null;
}

const BAND_LABEL: Record<string, string> = {
  below60: 'Below 60',
  band60to69: '60 to 69',
  band70plus: '70 and above',
  unknown: 'Not recorded',
};

const BAND_NOTE: Record<string, string> = {
  below60: 'Low conviction',
  band60to69: 'Was labelled "Read" until 30 Sep 2026',
  band70plus: 'Was labelled "Signal" until 30 Sep 2026',
  unknown: '',
};

const REACH_BAND_LABEL: Record<string, string> = {
  '0-25': 'Below 25%',
  '25-50': '25% to 49%',
  '50-75': '50% to 74%',
  '75-100': '75% and above',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 3, 2026" em UTC; null sem data valida. */
const fmtDate = (iso: string | null | undefined): string | null => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : null;
};
/** "01:24" em UTC; null sem data valida. */
const fmtTime = (iso: string | null | undefined): string | null => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(11, 16) : null;
};
const isRate = (g: Gated | undefined | null): g is Interval =>
  Boolean(g && g.publishable && 'rate' in g && g.rate !== null && g.rate !== undefined && g.low !== null && g.low !== undefined && g.high !== null && g.high !== undefined);
const minOf = (data: AccuracyPayload | undefined | null): number | undefined => data?.filters?.minResolvedToPublish;
const signedR = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
const countOf = (rec: Record<string, number> | undefined, key: string) => rec?.[key] ?? 0;

const PREVIOUS_METHOD =
  'An automated sweeper runs hourly and attempts to evaluate completed analyses after 48 hours. BUY and SELL plans with available candles are scored: the entry must fill first, then the first target races the stop on 30-minute candles. A candle touching both is recorded as a loss. WAIT, incomplete plans and cases without reliable candles are reported separately rather than counted as wins or losses. The headline figures use the original rule, which also counts a target touched in the same candle where the entry fills as a win; analyses scored under a later, stricter rule, where only the stop counts in that candle, are reported as a separate series and never added to the headline figures.';

const CURRENT_METHOD =
  'Trade plans and Watch levels are checked against real candles once their window closes (the validity of the plan plus 48 hours, longer for markets that close at weekends), when a price source is available; reads that cannot be checked are counted separately, by reason. A closed window waits for the next tracker run, every 30 minutes. Prices come from 1-minute candles when the window is short enough, otherwise 5-minute candles. An Enter now fills at the market price right after the analysis; then the first target races the stop for 48 hours, and inside the fill candle only the stop counts. A trade that reaches neither is a timeout: it is left out of the hit rate and counts as zero, minus spread, in the average result. A Watch is not a trade and has no win or loss: it is checked for one thing, whether price reached its level before the window closed or before price went beyond its invalidation.';

const ENGINE_STATES =
  "Enter now is a complete plan to act on at market. With live candles, code checks the plan: the stop sits beyond a real swing near the invalidation plus a margin measured per market, risk stays between 0.5 and 2 ATR, and the first target is 1R to 1.5R away. Without live candles, the entry, stop and targets are the AI's own estimates read from the screenshot; Enter now then still needs the screenshot price inside the plan's zone and the required checks, and the screen says the levels are estimated. Watch is a level worth waiting for, not an order: the price where the setup would become valid, how long it stays valid and what would cancel it. No trade means there is nothing to do on that chart.";

const WHAT_CHANGED_OUTRO =
  "These states do different jobs, so they are measured differently, and none of their results are mixed with the previous engine's.";

const EDGE_INTRO =
  'A hit rate only means something next to the size of the wins: if the average win is R times the risk, a plan breaks even at a hit rate of 1 / (1 + R), before costs. That is why the verdict here uses the average result per trade in R, not the hit rate.';

const WHO_CURRENT =
  "Who is counted, current engine: analyses from free, trial and paid accounts all count, because the engine is the same for everyone. The founder's own account and analyses run with a personal strategy profile are left out.";

const WHO_PREVIOUS =
  "Who is counted, previous engine: only analyses made with paid access, as before, which includes the founder's own account. Analyses from the free allowance and the free trial, and analyses run with a personal strategy profile, are left out.";

const WHO_DEMO = 'The anonymous demo at /try is never stored as an analysis, so it is in neither record.';

const TRACK_REASON: Record<string, string> = {
  no_plan: 'no plan to track',
  no_timeframe: 'timeframe not readable',
  no_source: 'no price source for this instrument',
  no_candles: 'no candles for the period',
  unknown: 'other reason',
};

function whatChangedTitle(data: AccuracyPayload | undefined | null): string {
  const since = fmtDate(data?.currentEngine?.since);
  return since ? `What changed on ${since}` : 'What changed with the current engine';
}

function previousTitle(data: AccuracyPayload | undefined | null): string {
  const since = fmtDate(data?.currentEngine?.since);
  return since ? `Previous engine (archived, until ${since})` : 'Previous engine (archived)';
}

function whatChangedIntro(data: AccuracyPayload | undefined | null): string {
  const since = fmtDate(data?.currentEngine?.since);
  const time = fmtTime(data?.currentEngine?.since);
  const when = since && time ? `On ${since}, at ${time} UTC, Tickrify` : 'Tickrify';
  return `${when} switched to a new analysis engine. The previous engine returned BUY, SELL or WAIT, and it was scored by one rule: did the first target print before the stop within 48 hours.`;
}

/** A resposta de abertura (pagina, geo-body e FAQPage). Data e minimo vem da API. */
function accuracyAnswer(data: AccuracyPayload | undefined | null): string {
  const since = fmtDate(data?.currentEngine?.since);
  const min = minOf(data);
  const opening = since ? `Since ${since}, a new engine` : 'A new engine';
  const publish = min
    ? `A result is published once a cut has at least ${min} resolved cases.`
    : 'A result is published only once a cut has enough resolved cases.';
  return `Tickrify does not claim an edge. ${opening} decides between three states: Enter now, Watch and No trade. It gives an Enter now plan only when fixed checks pass, so it is measured on what it actually outputs: how its Watch levels resolved, how its Enter now plans resolved in R, and how much of each read used live candle data. ${publish} The previous engine's record stays public in full, archived, with its own rules.`;
}

/**
 * O resumo com numeros, depois da abertura: motor atual primeiro (estados com
 * o n mesmo abaixo do minimo, porque contagem nao e taxa), motor anterior no fim.
 */
function accuracySummary(data: AccuracyPayload | undefined | null): string | null {
  if (!data?.previous) return null;
  const asOf = data.updatedAt.slice(0, 10);
  const min = minOf(data);
  const c = data.current;
  const parts: string[] = [];
  if (c) {
    parts.push(
      `As of ${asOf}, the current engine has made ${c.analyses} analyses: ${countOf(c.byState, 'ENTER_NOW')} Enter now, ${countOf(c.byState, 'WATCH')} Watch and ${countOf(c.byState, 'NO_TRADE')} No trade, ${countOf(c.dataMode, 'real_data')} of them read with live candle data.`,
    );
    const hit = c.enterNow.hitRate;
    parts.push(
      isRate(hit)
        ? `${hit.n} Enter now plans resolved at target or stop: ${hit.rate}% reached the first target before the stop (95% CI ${hit.low}% to ${hit.high}%).`
        : `Enter now results: collecting data, ${hit.n} of ${min} resolved at target or stop.`,
    );
    const reach = c.watch.reachRate;
    parts.push(
      isRate(reach)
        ? `${reach.n} Watch levels resolved: ${reach.rate}% were reached in time (95% CI ${reach.low}% to ${reach.high}%).`
        : `Watch results: collecting data, ${reach.n} of ${min} resolved.`,
    );
  } else {
    parts.push(`As of ${asOf}, the current engine's results are not loading.`);
  }
  const o = data.previous.overall;
  parts.push(
    isRate(o)
      ? `The previous engine, archived, recorded ${o.rate}% across ${o.n} resolved trades (${o.wins} wins, ${o.losses} losses, 95% CI ${o.low}% to ${o.high}%). The two records are never added together.`
      : `The previous engine, archived, has ${data.previous.overall.n} resolved trades, below the minimum to publish a rate. The two records are never added together.`,
  );
  return parts.join(' ');
}

/** A frase do resultado medio, escolhida pelo veredito da API (below, above, inconclusive). */
function edgeSentence(name: string, ar: AverageResult | undefined | null, costs: string, min: number | undefined): string {
  if (!ar) return `${name}: results are not loading right now.`;
  if (!ar.publishable) {
    return `${name}: still collecting data, ${ar.decided} of ${min} trades resolved at target or stop, so no average result is published yet.`;
  }
  const ci = `95% CI ${signedR(ar.low)} to ${signedR(ar.high)}`;
  const left = ar.excluded > 0 ? ` ${ar.excluded} more trades had no valid R and are left out.` : '';
  if (ar.verdict === 'above') {
    return `${name}: the average result per trade was above zero ${costs}, over ${ar.n} trades: ${signedR(ar.mean)} (${ci}).${left}`;
  }
  const head = `${name}: the average result was ${signedR(ar.mean)} per trade (${ci}), ${costs}, over ${ar.n} trades.`;
  if (ar.verdict === 'below') return `${head} The whole interval is below zero.${left}`;
  return `${head} Zero sits inside that interval, so the data cannot tell a positive average from a negative one.${left}`;
}

/** As duas frases do resultado medio, motor atual primeiro. */
function edgeAnswer(data: AccuracyPayload | undefined | null): string {
  if (!data?.previous) {
    return "Tickrify does not claim an edge. On the live page, each engine's average result per trade in R is published with a 95% interval, and only once enough trades have resolved.";
  }
  const min = minOf(data);
  const cur = data.current
    ? edgeSentence('Current engine', data.current.enterNow.averageResult, 'after an estimated spread, before other costs', min)
    : 'Current engine: results are not loading right now.';
  const prev = edgeSentence('Previous engine', data.previous.averageResult, 'before costs', min);
  return `${cur} ${prev} Tickrify does not claim an edge; this comparison is published so you can check.`;
}

function averageMethod(data: AccuracyPayload | undefined | null): string {
  const min = minOf(data);
  return `Average result per trade: a trade that reaches the first target is worth its own reward in R, a stop is -1R and a timeout 0R. For the previous engine the reward is the plan's recorded first-target ratio, before costs; for the current engine it is the distance from the fill to the target divided by the risk, minus a typical retail spread for the instrument. Trades without a valid R are left out and counted. The 95% interval of the mean uses Student's t, and the verdict compares that interval with zero. It is published only once ${min ? `at least ${min}` : 'enough'} of its trades reached target or stop.`;
}

function intervalsMethod(data: AccuracyPayload | undefined | null): string {
  const min = minOf(data);
  return `Confidence intervals for rates are Wilson score intervals at 95%, the same function our internal backtest uses. ${min ? `Any cut with fewer than ${min} resolved cases` : 'A cut without enough resolved cases'} shows its sample size instead of a figure.`;
}

function measurementTechnique(data: AccuracyPayload | undefined | null): string {
  const min = minOf(data);
  return `Current engine: trade plans and Watch levels are tracked against real candles after the validity window plus 48 hours, when a price source is available; reads that cannot be checked are counted separately. Previous engine: eligible trade plans scored automatically against real candles after 48 hours. No human in the loop.${min ? ` Cuts below n = ${min} are shown as sample size only.` : ''}`;
}

function datasetDescription(data: AccuracyPayload | undefined | null): string {
  const since = fmtDate(data?.currentEngine?.since);
  return `Measured results of Tickrify's AI chart analysis in two separate records: the current engine${since ? ` since ${since}` : ''}, tracked by what it delivers (Enter now trades and Watch levels), and the archived previous engine. Published with sample sizes, 95% confidence intervals and the average result per trade in R.`;
}

/** Comparacao das faixas de confianca do motor anterior: so com as duas faixas publicaveis, frase pelo dado. */
function confidenceSentence(data: AccuracyPayload | undefined | null): string | null {
  const bands = data?.previous?.byConfidence ?? [];
  const a = bands.find((b) => b.band === 'band60to69');
  const b = bands.find((x) => x.band === 'band70plus');
  if (!isRate(a) || !isRate(b)) return null;
  const overlap = !(Number(a.high) < Number(b.low) || Number(b.high) < Number(a.low));
  return overlap
    ? `In production, the 95% intervals of the 60 to 69 band (${a.low}% to ${a.high}%) and the 70 and above band (${b.low}% to ${b.high}%) overlap, so the score has not shown that it separates outcomes.`
    : `In production, the 95% intervals of the 60 to 69 band (${a.low}% to ${a.high}%) and the 70 and above band (${b.low}% to ${b.high}%) do not overlap.`;
}

/** As MESMAS perguntas e respostas da pagina, do HTML pre-renderizado e do FAQPage. */
function accuracyFaqItems(data: AccuracyPayload | undefined | null): Array<{ q: string; a: string }> {
  const c = data?.current;
  const p = data?.previous;
  const since = fmtDate(data?.currentEngine?.since);
  const asOf = data?.updatedAt ? data.updatedAt.slice(0, 10) : null;
  return [
    { q: 'How accurate is Tickrify?', a: [accuracyAnswer(data), accuracySummary(data)].filter(Boolean).join(' ') },
    {
      q: 'Why are there two sets of results?',
      a: `Tickrify changed its analysis engine${since ? ` on ${since}` : ''}. The previous engine returned BUY, SELL or WAIT; the current one returns Enter now, Watch or No trade. The two are measured with different rules, so their results are published separately and never added together. The previous engine's record stays public, archived, with its own methodology.`,
    },
    { q: 'How is the current engine measured?', a: CURRENT_METHOD },
    { q: 'How was the previous engine measured?', a: PREVIOUS_METHOD },
    { q: 'Does Tickrify have an edge?', a: edgeAnswer(data) },
    {
      q: 'Does the AI suggest a trade on every chart?',
      a: c
        ? `No. Of ${c.analyses} current-engine analyses, ${countOf(c.byState, 'ENTER_NOW')} were Enter now, ${countOf(c.byState, 'WATCH')} were Watch and ${countOf(c.byState, 'NO_TRADE')} were No trade. Watch and No trade are designed outcomes, not failures to answer, and neither counts as a win or a loss.`
        : 'No. Many analyses return Watch, a level worth waiting for, or No trade. Those are designed outcomes, not failures to answer, and neither counts as a win or a loss.',
    },
    {
      q: 'Are losing trades included?',
      a:
        c && p
          ? `Yes. Every stop is counted: ${c.enterNow.outcomes.stop} so far for the current engine and ${p.overall.losses} in the previous engine's headline figures. Unfilled entries, timeouts and cases without reliable candles are reported separately rather than quietly dropped.`
          : 'Yes. Every stop is counted. Unfilled entries, timeouts and cases without reliable candles are reported separately rather than quietly dropped.',
    },
    {
      q: 'How often is this page updated?',
      a: asOf
        ? `The figures are recalculated hourly and were last updated on ${asOf}. They move on their own, including when they move against us.`
        : 'The figures are recalculated hourly. They move on their own, including when they move against us.',
    },
  ];
}

/** Nota do bloco EUR/USD invertido: horarios e data vem da API. */
function eurUsdNote(data: AccuracyPayload | undefined | null): string | null {
  const c = data?.current;
  const b = c?.eurUsdBlock;
  if (!c || !b) return null;
  const head = `Note on gold and forex: from ${fmtTime(c.since)} to ${fmtTime(b.until)} UTC on ${fmtDate(b.until)}, the market context sent to the current engine for gold and forex described EUR/USD rising as the dollar strengthening, the opposite of what it means. It was corrected at ${fmtTime(b.until)} UTC.`;
  return b.analyses > 0
    ? `${head} ${b.analyses} gold and forex analyses in the published sample were made in that window (${b.enterNow} Enter now, ${b.closedWatch} Watch with a closed window). They are included in the figures above and flagged for the monthly review.`
    : `${head} No gold or forex analysis in the published sample was made in that window.`;
}

/** Linhas da tabela do rastreador: [rotulo, Enter now, Watch]. */
function trackingRows(c: Current): Array<[string, number, number]> {
  const e = c.tracking.ENTER_NOW;
  const w = c.tracking.WATCH;
  const reasons = [...new Set([...Object.keys(e.skippedReasons), ...Object.keys(w.skippedReasons)])].sort();
  return [
    ['Given', countOf(c.byState, 'ENTER_NOW'), countOf(c.byState, 'WATCH')],
    ['Window still open', e.open, w.open],
    ['Window closed, waiting for the next tracker run', e.awaiting, w.awaiting],
    ...reasons.map((r): [string, number, number] => [`Not checked: ${TRACK_REASON[r] ?? TRACK_REASON.unknown}`, e.skippedReasons[r] ?? 0, w.skippedReasons[r] ?? 0]),
    ['Checked against real candles', e.tracked, w.tracked],
  ];
}

/** Um número medido. Sem n suficiente, mostra o n, nunca uma taxa. */
const Kpi = ({ interval, label, min }: { interval: Gated; label: string; min?: number }) =>
  isRate(interval) ? (
    <div className="site-kpi">
      <b>{interval.rate}%</b>
      <div className="site-kpi-label">{label}</div>
      <div className="site-kpi-note">
        95% CI {interval.low}% to {interval.high}% · n = {interval.n}
      </div>
    </div>
  ) : (
    <div className="site-kpi">
      <b>n = {interval.n}</b>
      <div className="site-kpi-label">{label}</div>
      <div className="site-kpi-note">
        {min ? `Collecting data: ${interval.n} of ${min}` : 'Too few resolved trades to publish a rate yet'}
      </div>
    </div>
  );

/** Resultado médio em R numa célula: com o mínimo, a média e o intervalo; sem ele, só o n. */
const averageCell = (ar: AverageResult, min: number | undefined) =>
  ar.publishable
    ? `${signedR(ar.mean)} (95% CI ${signedR(ar.low)} to ${signedR(ar.high)}), n = ${ar.n}`
    : `Collecting data: ${ar.decided} of ${min} resolved at target or stop`;

const AccuracyPage = () => {
  useSeo(seoFor('/accuracy'));

  const { data, isLoading, isError } = useQuery<AccuracyPayload>({
    queryKey: ['accuracy'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/ai/accuracy'));
      if (!res.ok) throw new Error(`accuracy: ${res.status}`);
      return res.json();
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const asOf = typeof data?.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : null;
  const min = minOf(data);
  const prev = data?.previous;
  const answer = prev && isRate(prev.overall) ? prev.overall : null;
  const faq = useMemo(() => accuracyFaqItems(data), [data]);
  const eurNote = eurUsdNote(data);
  const summary = accuracySummary(data);
  const confidence = confidenceSentence(data);
  const groundingSince = fmtDate(prev?.groundingLiveSince);

  /**
   * Schema em @graph: Dataset e FAQPage no mesmo bloco, um id só (o pré-render
   * entrega o mesmo id e o `useJsonLd` substitui). Nada declarado que a página
   * não mostre: valores só quando a API respondeu e o recorte passou do mínimo.
   */
  const jsonLd = useMemo<Record<string, unknown>>(() => {
    const hit = data?.current?.enterNow.hitRate;
    const dataset: Record<string, unknown> = {
      '@type': 'Dataset',
      name: 'Tickrify AI accuracy: current engine and archived previous engine',
      description: datasetDescription(data),
      url: 'https://tickrify.com/accuracy',
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'Tickrify', url: 'https://tickrify.com' },
      measurementTechnique: measurementTechnique(data),
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Current engine Enter now hit rate',
          description: 'Share of current-engine Enter now trades resolved at target or stop that reached the first target first, with a 95% Wilson confidence interval.',
          ...(isRate(hit) ? { value: hit.rate, unitText: 'PERCENT' } : {}),
        },
        {
          '@type': 'PropertyValue',
          name: 'Previous engine hit rate',
          description: 'Share of the previous engine’s resolved analyses, scored under the original rule, that reached target before stop, with a 95% Wilson confidence interval.',
          ...(answer ? { value: answer.rate, unitText: 'PERCENT' } : {}),
        },
        {
          '@type': 'PropertyValue',
          name: 'Previous engine sample size (n)',
          description: 'Number of resolved analyses behind the previous engine’s hit rate.',
          ...(answer ? { value: answer.n } : {}),
        },
      ],
    };
    if (data?.updatedAt) dataset.dateModified = data.updatedAt;
    if (prev?.firstRecordAt) dataset.temporalCoverage = `${prev.firstRecordAt.slice(0, 10)}/..`;

    return {
      '@context': 'https://schema.org',
      '@graph': [
        dataset,
        {
          '@type': 'FAQPage',
          mainEntity: faq.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
      ],
    };
  }, [data, prev, answer, faq]);

  useJsonLd('accuracy', jsonLd);

  const cur = data?.current ?? null;

  return (
    <SiteLayout active="accuracy">
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">Measured, not claimed</span>
          <h1>How accurate is Tickrify? Here is how we measure it</h1>
          <p>
            <strong>{accuracyAnswer(data)}</strong>
          </p>
          {summary ? <p>{summary}</p> : null}
          <p>Every number on this page comes from live production data and is recalculated hourly. Results that look bad stay on the page.</p>
          {data ? (
            <span className="site-updated">
              Updated {new Date(data.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · recalculated hourly
              · text revised {LAST_UPDATED}
            </span>
          ) : null}
        </div>
      </section>

      {isLoading ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <p className="site-note">Loading the scoreboard.</p>
          </div>
        </section>
      ) : null}

      {isError ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <div className="site-callout">
              <h3>The numbers are not loading right now.</h3>
              <p>
                Refresh in a moment. We would rather show you nothing than show you a number we did not measure.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {data && prev ? (
        <section className="site-dark">
          <div className="site-wrap site-prose">
            <h2 id="what-changed">{whatChangedTitle(data)}</h2>
            <p>{whatChangedIntro(data)}</p>
            <p>{ENGINE_STATES}</p>
            <p>{WHAT_CHANGED_OUTRO}</p>

            <h2 id="current">Current engine: results so far</h2>
            {cur ? (
              <div>
                <div className="site-kpis">
                  <Kpi interval={cur.enterNow.hitRate} label="Enter now reached target before stop" min={min} />
                  <Kpi interval={cur.watch.reachRate} label="Watch levels reached in time" min={min} />
                  <div className="site-kpi">
                    <b>{cur.analyses}</b>
                    <div className="site-kpi-label">Analyses by the current engine</div>
                    <div className="site-kpi-note">
                      {countOf(cur.byState, 'ENTER_NOW')} Enter now, {countOf(cur.byState, 'WATCH')} Watch,{' '}
                      {countOf(cur.byState, 'NO_TRADE')} No trade
                    </div>
                  </div>
                  <div className="site-kpi">
                    <b>{countOf(cur.dataMode, 'real_data')}</b>
                    <div className="site-kpi-label">Read with live candles</div>
                    <div className="site-kpi-note">{countOf(cur.dataMode, 'print')} from the screenshot alone</div>
                  </div>
                </div>

                <h3>Where each read is in the tracker</h3>
                <div className="site-tablewrap">
                  <table className="site-table">
                    <thead>
                      <tr>
                        <th>Tracker</th>
                        <th>Enter now</th>
                        <th>Watch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trackingRows(cur).map(([label, enter, watch]) => (
                        <tr key={label}>
                          <td className="site-sym-cell">{label}</td>
                          <td>{enter}</td>
                          <td>{watch}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3>Enter now: how the checked trades resolved</h3>
                <div className="site-tablewrap">
                  <table className="site-table">
                    <thead>
                      <tr>
                        <th>Enter now</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="site-sym-cell">Reached the first target</td>
                        <td>{cur.enterNow.outcomes.tp1}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Hit the stop</td>
                        <td>{cur.enterNow.outcomes.stop}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Timeout, neither in 48 hours</td>
                        <td>{cur.enterNow.outcomes.timeout}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Average result per trade, estimated spread deducted</td>
                        <td>{averageCell(cur.enterNow.averageResult, min)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3>Watch: did price reach the level?</h3>
                <p>
                  A Watch is not a trade, so it has no win or loss. Once its window closes, it is checked for one
                  thing: whether price reached the level in time.
                </p>
                <div className="site-tablewrap">
                  <table className="site-table">
                    <thead>
                      <tr>
                        <th>Watch</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="site-sym-cell">Reached the level in time</td>
                        <td>{cur.watch.outcomes.reached}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Went beyond the invalidation first</td>
                        <td>{cur.watch.outcomes.invalidated}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Window closed without reaching the level</td>
                        <td>{cur.watch.outcomes.expired}</td>
                      </tr>
                      <tr>
                        <td className="site-sym-cell">Could not be checked</td>
                        <td>{cur.watch.outcomes.unavailable}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3>Is the chance shown on a Watch calibrated?</h3>
                {cur.watch.calibrationAvailable ? (
                  <div>
                    <p>
                      When calibration exists for the instrument, a Watch shows the chance of price reaching the level.
                      Here is what was shown against what happened, by band.
                    </p>
                    <div className="site-tablewrap">
                      <table className="site-table">
                        <thead>
                          <tr>
                            <th>Chance shown</th>
                            <th>Checked Watch</th>
                            <th>Average shown</th>
                            <th>Reached (95% CI)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cur.watch.calibration
                            .filter((b) => b.n > 0)
                            .map((b) => (
                              <tr key={b.band}>
                                <td className="site-sym-cell">{REACH_BAND_LABEL[b.band] ?? b.band}</td>
                                <td>{b.n}</td>
                                <td>{b.publishable && b.predicted != null ? `${b.predicted}%` : 'n/a'}</td>
                                <td>
                                  {b.publishable && b.observed && isRate(b.observed)
                                    ? `${b.observed.rate}% (${b.observed.low}% to ${b.observed.high}%)`
                                    : `Collecting data: ${b.n} of ${min}`}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p>No Watch that showed a chance has been checked yet.</p>
                )}
              </div>
            ) : (
              <div className="site-callout">
                <h3>The current engine&rsquo;s results are not loading right now.</h3>
                <p>The archived record below is unaffected. Refresh in a moment.</p>
              </div>
            )}

            <h2 id="edge">Does Tickrify have an edge?</h2>
            <p>{EDGE_INTRO}</p>
            <p>{edgeAnswer(data)}</p>

            <h2 id="not-profit">Why a hit rate is not profit</h2>
            <ul>
              <li>A hit rate ignores how far the target was. A low rate can pay and a high one can lose.</li>
              <li>
                Trading costs are not in the hit rates: spread, slippage, commission and funding all come out of a
                real account. The current engine&rsquo;s average result deducts an estimated spread only.
              </li>
              <li>Timeouts are left out of the hit rate, and a real position still has to be closed somewhere.</li>
              <li>
                Tickrify does not know whether you took the trade, at what size, or when you exited. Your result can
                be very different from this page.
              </li>
            </ul>

            <h2 id="previous">{previousTitle(data)}</h2>
            <p>
              Everything below is the record of the previous engine, kept as it was and scored by its own rules. No
              current-engine analysis is counted here.
            </p>

            <div className="site-kpis">
              <Kpi interval={prev.overall} label="Reached target before stop" />
              <div className="site-kpi">
                <b>{prev.abstention.rate === null ? 'n/a' : `${prev.abstention.rate}%`}</b>
                <div className="site-kpi-label">Charts the AI refused to call</div>
                <div className="site-kpi-note">
                  {prev.abstention.wait} of {prev.abstention.total} analyses returned WAIT
                </div>
              </div>
              <div className="site-kpi">
                <b>{prev.overall.wins}</b>
                <div className="site-kpi-label">Wins counted</div>
                <div className="site-kpi-note">Entry filled, then target before stop</div>
              </div>
              <div className="site-kpi">
                <b>{prev.overall.losses}</b>
                <div className="site-kpi-label">Losses counted</div>
                <div className="site-kpi-note">Nothing quietly dropped to flatter the rate</div>
              </div>
            </div>

            <h3 id="summary">Previous engine at a glance{asOf ? `, ${asOf}` : ''}</h3>
            <div className="site-tablewrap">
              <table className="site-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                    <th>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="site-sym-cell">Hit rate, original scoring rule</td>
                    <td>{answer ? `${answer.rate}%` : 'Not published yet'}</td>
                    <td>
                      {answer
                        ? `95% CI ${answer.low}% to ${answer.high}%, n = ${answer.n}`
                        : `n = ${prev.overall.n}, below the minimum to publish a rate`}
                    </td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Wins and losses counted</td>
                    <td>
                      {prev.overall.wins} wins, {prev.overall.losses} losses
                    </td>
                    <td>Scored automatically, none excluded after the fact</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Average result per trade</td>
                    <td>{averageCell(prev.averageResult, min)}</td>
                    <td>Before costs; first target = its recorded R, stop = -1R, timeout = 0R</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Abstention rate</td>
                    <td>{prev.abstention.rate === null ? 'n/a' : `${prev.abstention.rate}%`}</td>
                    <td>
                      {prev.abstention.wait} of {prev.abstention.total} analyses returned WAIT
                    </td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Measurement window</td>
                    <td>48 hours</td>
                    <td>Entry must fill, then first target races the stop on 30-minute candles</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Trading costs</td>
                    <td>Not deducted</td>
                    <td>Spread, slippage, commission and funding are excluded</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 id="hit-rate">What counted as a hit?</h3>
            <p>
              A hit is an analysis whose entry actually filled and then reached the first target before the stop.
              Losses, unfilled entries and abstentions are counted separately. Nothing is quietly dropped to make the
              number look better.
            </p>

            <h3 id="confidence">Did the confidence score mean anything?</h3>
            <p>
              If the number next to a call carries no information, the whole product is theatre. Here is the hit rate
              split by the confidence the AI assigned at the time:
            </p>
            <div className="site-tablewrap">
              <table className="site-table">
                <thead>
                  <tr>
                    <th>Confidence</th>
                    <th>Resolved</th>
                    <th>Hit rate</th>
                    <th>95% CI</th>
                  </tr>
                </thead>
                <tbody>
                  {prev.byConfidence
                    .filter((band) => band.n > 0)
                    .map((band) => (
                      <tr key={band.band}>
                        <td className="site-sym-cell">
                          {BAND_LABEL[band.band]}
                          {BAND_NOTE[band.band] ? <span className="site-cell-note">{BAND_NOTE[band.band]}</span> : null}
                        </td>
                        <td>{band.n}</td>
                        <td>{band.publishable && band.rate !== null ? `${band.rate}%` : 'n/a'}</td>
                        <td>{band.publishable && band.low !== null ? `${band.low}% to ${band.high}%` : 'n too small'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p>
              The product used 70 as its threshold: below it a call was labelled "Read", a market reading; at or above
              it, "Signal". That split came out of a blind backtest in July 2026, and a backtest is not evidence about
              production.
            </p>
            {confidence ? <p>{confidence}</p> : null}
            <p>
              On 30 September 2026 we removed the score and the Read/Signal labels from the product. The engine still
              records it, and this table keeps showing it, so you can check that decision.
            </p>

            <h3 id="compare">How should you read an AI accuracy claim?</h3>
            <p>
              Accuracy figures in this category are usually a single percentage with no sample size, no interval and
              no method, which makes them impossible to check and impossible to compare. These are the six things
              worth looking for, and what this page does about each of them.
            </p>
            <div className="site-tablewrap">
              <table className="site-table">
                <thead>
                  <tr>
                    <th>What to check</th>
                    <th>A bare accuracy claim</th>
                    <th>This page</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="site-sym-cell">Sample size</td>
                    <td>Not stated</td>
                    <td>n published on every cut{answer ? `, currently ${answer.n} resolved` : ''}</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Uncertainty</td>
                    <td>Not stated</td>
                    <td>95% confidence interval on every rate and average</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Losing trades</td>
                    <td>Rarely shown</td>
                    <td>Counted and published{prev.overall.losses > 0 ? `, ${prev.overall.losses} so far` : ''}</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Who does the scoring</td>
                    <td>The vendor, after the fact</td>
                    <td>An automated process against real candles, no human in the loop</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">Trading costs</td>
                    <td>Usually unstated</td>
                    <td>Stated on the page, every time</td>
                  </tr>
                  <tr>
                    <td className="site-sym-cell">How current it is</td>
                    <td>A static marketing figure</td>
                    <td>Recalculated hourly{asOf ? `, last updated ${asOf}` : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 id="grounding">Did live candle grounding change the numbers?</h3>
            <p>
              {groundingSince ? `On ${groundingSince}` : 'At one point'} we started feeding the AI real candles, price,
              RSI(14), range position and momentum pulled from live exchange feeds, before it reads your screenshot. We
              split the record on that date so you can judge the change instead of taking our word for it.
            </p>
            {prev.byGrounding.before.n > 0 && prev.byGrounding.after.n > 0 ? (
              <div className="site-kpis site-kpis-inline">
                <Kpi interval={prev.byGrounding.before} label="Before grounding" />
                <Kpi interval={prev.byGrounding.after} label="After grounding" />
              </div>
            ) : (
              <div className="site-callout">
                <h3>Comparison not available</h3>
                <p>
                  {prev.byGrounding.before.n} resolved before the change, {prev.byGrounding.after.n} after. We would
                  rather leave a gap here than compute a comparison out of a handful of trades.
                </p>
              </div>
            )}

            <h3 id="updated-rule">Updated scoring rule, separate series</h3>
            <p>
              Analyses scored under the updated rule do not count a target touched in the same 30-minute candle where
              the entry fills: inside that candle only the stop counts, because the order of the two is not visible on
              30-minute candles. They are kept out of every figure above so the historical series stays comparable.
              This is a change in how outcomes are measured, not in the analyses, and it is not evidence of better or
              worse performance.
            </p>
            <div className="site-kpis">
              <Kpi interval={prev.stopOnly.overall} label="Reached target before stop, updated rule" />
            </div>

            <h3 id="outcomes">How did every outcome resolve?</h3>
            <div className="site-chips">
              {Object.entries(prev.breakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([key, value]) => (
                  <span key={key}>
                    {key} · {value}
                  </span>
                ))}
            </div>
            <p>
              <strong>NO_FILL</strong> means price never reached the proposed entry. <strong>ABSTAIN</strong> means
              the AI declined to call the chart. <strong>UNTRACKABLE</strong> means we could not source reliable
              candles for that symbol. None of these count as a win or a loss.
            </p>

            <h2 id="method">Method</h2>
            <ul>
              <li>{WHO_CURRENT}</li>
              <li>{WHO_PREVIOUS}</li>
              <li>{WHO_DEMO}</li>
              <li>
                <strong>Current engine.</strong> {CURRENT_METHOD}
              </li>
              <li>
                <strong>Previous engine.</strong> {PREVIOUS_METHOD}
              </li>
              <li>{averageMethod(data)}</li>
              <li>{intervalsMethod(data)}</li>
              <li>
                Only outcomes measured automatically are counted. Verdicts users tag by hand in their own trade
                journal are excluded. Self-reporting is not measurement.
              </li>
            </ul>

            <h2 id="excluded">Exclusions</h2>
            <ul>
              <li>
                <strong>Who is counted</strong> differs by engine; both rules are stated under Method above.
              </li>
              <li>
                <strong>No trading costs</strong> in the hit rates. Your real result will be worse than this page.
              </li>
              <li>
                The sample is small and skewed toward the instruments our users happen to chart. It is not a
                representative sample of all markets.
              </li>
              <li>Reads without a price source or without candles are counted separately, never as a win or a loss.</li>
            </ul>

            <h2 id="faq">Questions people ask about Tickrify accuracy</h2>
            {faq.map((item) => (
              <div key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}

            {eurNote ? <p className="site-note">{eurNote}</p> : null}

            <div className="site-callout">
              <h3>Read this next</h3>
              <p>
                Past results do not guarantee future results. Nothing on this page is investment advice. Tickrify is a
                second opinion on a chart you are already reading: the decision, the size and the risk are yours. The
                full <Link to="/risk">risk disclosure</Link> spells out what can go wrong.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </SiteLayout>
  );
};

export default AccuracyPage;
