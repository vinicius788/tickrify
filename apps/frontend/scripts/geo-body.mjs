/**
 * Corpo pré-renderizado das rotas públicas (GEO/AEO) — 14/09/2026.
 *
 * O PROBLEMA
 * O `prerender.mjs` conserta o `<head>` de cada rota, e só o head. O corpo que
 * o HTML cru entrega é a casca do `index.html`: a barra do cabeçalho, sem uma
 * palavra de texto. Medido em 14/09: `/`, `/pricing`, `/accuracy` e `/try`
 * servem ZERO palavra para quem não executa JavaScript.
 *
 * Isso importa mais do que SEO clássico aqui. O maior canal de aquisição do
 * produto é o ChatGPT (368 de 1017 pageviews em 30 dias, orgânico), e nenhum
 * crawler de IA executa JavaScript: OAI-SearchBot, PerplexityBot e ClaudeBot
 * leem o HTML cru e vão embora. O Googlebot executa JS e por isso nunca viu
 * este problema, o que explica ele ter passado batido em duas auditorias.
 *
 * POR QUE DENTRO DE <noscript> E NÃO DENTRO DO #root
 * Texto dentro do `<div id="root">` é pintado antes do React montar e some
 * quando ele monta. Este projeto já pagou por isso: o `index.html` trazia o
 * hero embutido, abrir `/terms` piscava "Stop trading in the dark", e em
 * 25/08/2026 a casca foi esvaziada de propósito por causa disso. Repetir
 * aquilo para agradar crawler seria trocar um bug por outro.
 *
 * `<noscript>` não tem esse custo: o navegador com JS ligado nunca renderiza
 * o bloco (zero flash, zero regressão visual), e todo crawler que lê HTML cru
 * lê o conteúdo normalmente. Não é conteúdo escondido no sentido que o Google
 * pune: é o mesmo texto da página, entregue a quem não roda o script.
 *
 * FONTE ÚNICA, QUE É O PONTO INTEIRO
 * Nada aqui é copy escrita à mão. O texto sai de `src/lib/i18n/en.ts`, o MESMO
 * arquivo que a tela renderiza, carregado de verdade (esbuild, já instalado
 * como dependência do Vite). Os números da /accuracy saem da MESMA API que a
 * página consome, buscada no momento do build e carimbada com a data.
 *
 * Isto não é preciosismo: divergência entre uma segunda cópia de texto e a
 * tela já aconteceu três vezes neste projeto (o número de abstenção em
 * es/de/ja, as 84 strings mortas dos 3 tiers, o hero da casca). Copy escrita
 * aqui à mão seria a quarta.
 *
 * FAIL-SAFE
 * Qualquer falha devolve `null` e o `prerender.mjs` publica a rota só com o
 * `<head>`, exatamente como antes desta mudança. Nada de SEO derruba deploy.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SITE = 'https://tickrify.com';

/* A URL da API no build. Mesma env que o app usa; o fallback é o host de
 * produção do Render, porque uma env ausente no Vercel não pode significar
 * "publique a página de acurácia sem os números". */
const API_BASE = (process.env.VITE_API_URL || 'https://tickrify.onrender.com').replace(/\/+$/, '');

export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Carrega o `en.ts` de verdade, em vez de garimpar o arquivo com regex.
 *
 * O `en.ts` é um objeto literal e nada mais: `export default { ... } as const`.
 * Sem anotação de tipo, sem import, sem genérico. Tirar o `as const` deixa um
 * módulo ES válido, que o Node importa direto por data URL. É o caminho
 * principal porque não depende de binário nenhum e por isso pode ser
 * verificado em qualquer máquina, inclusive nas que não rodam o esbuild
 * nativo instalado aqui (o binário do node_modules é o do macOS).
 *
 * O esbuild fica como segunda tentativa, para o dia em que alguém puser
 * TypeScript de verdade no arquivo. Ele não está no package.json do frontend
 * e não precisa estar: é dependência direta do Vite, que está. Os dois
 * caminhos de resolução cobrem as duas formas de instalar que este projeto
 * usa (pnpm na máquina do dono, npm install no Vercel).
 *
 * Falhando as duas, devolve null e a rota sai com corpo reduzido.
 */
export async function loadEnglishCopy(root) {
  const file = join(root, 'src/lib/i18n/en.ts');
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const asModule = async (code) => {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    return mod.default ?? null;
  };

  // 1) objeto literal puro, sem transpilador.
  try {
    const plain = source.replace(/\s+as\s+const\s*;/g, ';');
    const copy = await asModule(plain);
    if (copy?.landing?.hero?.title1) return copy;
  } catch {
    /* cai para o esbuild */
  }

  // 2) esbuild, se o arquivo virar TypeScript de verdade um dia.
  try {
    const req = createRequire(join(root, 'noop.cjs'));
    let esbuildPath;
    try {
      esbuildPath = req.resolve('esbuild');
    } catch {
      esbuildPath = createRequire(req.resolve('vite')).resolve('esbuild');
    }
    const esbuild = await import(pathToFileURL(esbuildPath).href);
    const { code } = await esbuild.transform(source, { loader: 'ts', format: 'esm' });
    return await asModule(code);
  } catch {
    return null;
  }
}

/**
 * Busca os números reais da /accuracy no momento do build.
 *
 * Timeout curto de propósito: o Render hiberna no plano free e um deploy não
 * pode ficar pendurado esperando cold start. Falhou, a página sai sem a tabela
 * de números, nunca com número inventado. É a regra nº 3 da própria
 * AccuracyPage, aplicada ao HTML estático.
 */
export async function fetchAccuracy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${API_BASE}/api/ai/accuracy`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    // API de antes do motor de 23/11 (sem a serie v11): a data do motor atual estaria errada.
    // Sai o texto sem numeros, como com a API fora do ar.
    return data && 'v11' in data ? data : null;
  } catch {
    return null;
  }
}

/** Uma linha de métrica que obedece as regras da AccuracyPage: sem n suficiente, mostra o n. */
function metricRow(label, interval, collectingMin) {
  if (!interval || typeof interval.n !== 'number') return '';
  const value = isRate(interval)
    ? `${interval.rate}% (95% CI ${interval.low}% to ${interval.high}%)`
    : collectingMin
      ? `Collecting data: ${interval.n} of ${collectingMin}`
      : 'Not published yet, too few resolved trades';
  return `<tr><td>${esc(label)}</td><td>${esc(value)}</td><td>n = ${esc(interval.n)}</td></tr>`;
}

const countRow = (label, value) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;

const BAND_LABEL = {
  below60: 'Confidence below 60',
  band60to69: 'Confidence 60 to 69 (score no longer shown in the product)',
  band70plus: 'Confidence 70 and above (score no longer shown in the product)',
  unknown: 'Confidence not recorded',
};

/*
 * 04/11/2026: a /accuracy separa o motor atual (medido pelo rastreador) do
 * motor anterior (arquivado, todos os numeros de antes). 23/11/2026: o motor
 * pelas velas com varios leitores (marcador `engine.vote`) vira o atual e o v11
 * passa a serie propria; os tres registros nunca se somam. Os textos ate
 * `trackingRows` sao gerados da MESMA fonte que a AccuracyPage.tsx usa (o teste
 * da pagina compara os dois lados); data, minimo e toda frase que depende do dado
 * vem da API.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 3, 2026" em UTC; null sem data valida. */
const fmtDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : null;
};
/** "01:24" em UTC; null sem data valida. */
const fmtTime = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(11, 16) : null;
};
const isRate = (g) =>
  Boolean(g && g.publishable && 'rate' in g && g.rate !== null && g.rate !== undefined && g.low !== null && g.low !== undefined && g.high !== null && g.high !== undefined);
const minOf = (data) => data?.filters?.minResolvedToPublish;
const signedR = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
const countOf = (rec, key) => rec?.[key] ?? 0;

const PREVIOUS_METHOD =
  'An automated sweeper runs hourly and attempts to evaluate completed analyses after 48 hours. BUY and SELL plans with available candles are scored: the entry must fill first, then the first target races the stop on 30-minute candles. A candle touching both is recorded as a loss. WAIT, incomplete plans and cases without reliable candles are reported separately rather than counted as wins or losses. The headline figures use the original rule, which also counts a target touched in the same candle where the entry fills as a win; analyses scored under a later, stricter rule, where only the stop counts in that candle, are reported as a separate series and never added to the headline figures.';

const CURRENT_METHOD =
  'The current engine and the v11 engine are measured by the same tracker. Trade plans and Watch levels are checked against real candles once their window closes (the validity of the plan plus 48 hours, longer for markets that close at weekends), when a price source is available; reads that cannot be checked are counted separately, by reason. A closed window waits for the next tracker run, every 30 minutes. Prices come from 1-minute candles when the window is short enough, otherwise 5-minute candles. An Enter now (a Buy now or Sell now in the current engine) fills at the market price right after the analysis; then the first target races the stop for 48 hours, and inside the fill candle only the stop counts. A trade that reaches neither is a timeout: it is left out of the hit rate and counts as zero, minus spread, in the average result. A Watch (a pullback or breakout entry, or a level to wait for) is not a trade and has no win or loss: it is checked for one thing, whether price reached its level before the window closed or before price went beyond its invalidation.';

const ENGINE_STATES =
  "Every chart is read by more than one independent AI read, and the reads vote on the direction; a majority decides. When the reads disagree, the read says Wait, unless the candle trend is strong (swing structure and the trend of the higher timeframe pointing the same way), in which case the candles break the tie. The higher timeframe follows the chart timeframe: a 5m chart is checked against the 1h trend, a 1h chart against the daily trend. Buy now or Sell now needs two reads in the same direction, or one read and a strong candle trend, and when the higher timeframe trends and price sits on the same side of its EMA50 there is no entry against it, only a breakout entry that waits for a candle close, or Wait. With market candles, the entry, stop and target are set or checked by code: the stop sits beyond a real swing near the invalidation plus a margin measured per market, risk stays between 0.5 and 2 ATR, and the first target is 1R to 1.5R away. The outcome is Buy now or Sell now (enter at the current price), Buy or Sell on pullback (wait for price to come back to a level), Buy or Sell on breakout (enter only after a candle closes beyond the level), or Wait. A Wait always states its reason and, with market candles, the price that would turn it into a buy or a sell. In this record Buy now and Sell now are tracked as Enter now, pullback and breakout entries as Watch, and Wait as No trade. Without market candles, the levels are the AI's own estimates read from the screenshot, the screen says so, and the outcomes are Enter now, Watch and No trade.";

const WHAT_CHANGED_OUTRO =
  "These outcomes do different jobs, so they are measured differently, and none of their results are mixed with the earlier engines'.";

const EDGE_INTRO =
  'A hit rate only means something next to the size of the wins: if the average win is R times the risk, a plan breaks even at a hit rate of 1 / (1 + R), before costs. That is why the verdict here uses the average result per trade in R, not the hit rate.';

const WHO_CURRENT =
  "Who is counted, current and v11 engines: analyses from free, trial and paid accounts all count, because the engine is the same for everyone. The founder's own account and analyses run with a personal strategy profile are left out.";

const WHO_PREVIOUS =
  "Who is counted, previous engine: only analyses made with paid access, as before, which includes the founder's own account. Analyses from the free allowance and the free trial, and analyses run with a personal strategy profile, are left out.";

const WHO_DEMO = 'The anonymous demo at /try is never stored as an analysis, so it is in neither record.';

const TRACK_REASON = {
  no_plan: 'no plan to track',
  no_timeframe: 'timeframe not readable',
  no_source: 'no price source for this instrument',
  no_candles: 'no candles for the period',
  unknown: 'other reason',
};

export function whatChangedTitle(data) {
  const since = fmtDate(data?.currentEngine?.since);
  return since ? `What changed on ${since}` : 'What changed with the current engine';
}

/** O motor anterior (BUY, SELL, WAIT) termina quando o v11 entra. */
export function previousTitle(data) {
  const until = fmtDate(data?.currentEngine?.v11Since);
  return until ? `Previous engine (archived, until ${until})` : 'Previous engine (archived)';
}

/** O v11 (Enter now, Watch, No trade) vai da entrada dele ate a do motor atual. */
export function v11Title(data) {
  const from = fmtDate(data?.currentEngine?.v11Since);
  const to = fmtDate(data?.currentEngine?.since);
  return from && to ? `v11 engine (archived, ${from} to ${to})` : 'v11 engine (archived)';
}

export function whatChangedIntro(data) {
  const since = fmtDate(data?.currentEngine?.since);
  const time = fmtTime(data?.currentEngine?.since);
  const v11 = fmtDate(data?.currentEngine?.v11Since);
  const when = since && time ? `On ${since}, at ${time} UTC, Tickrify` : 'Tickrify';
  const middle = v11 ? `From ${v11} until then, the v11 engine returned Enter now, Watch or No trade.` : 'Before that, the v11 engine returned Enter now, Watch or No trade.';
  return `${when} changed its analysis engine again: more than one independent AI read now votes on the direction, when the reads disagree the result is Wait unless the candle trend on the higher timeframe is strong, and the result is Buy now, Sell now, a pullback or breakout entry, or Wait. ${middle} Before the v11 engine, the previous engine returned BUY, SELL or WAIT, and it was scored by one rule: did the first target print before the stop within 48 hours.`;
}

/** A resposta de abertura (pagina, geo-body e FAQPage). Data e minimo vem da API. */
export function accuracyAnswer(data) {
  const since = fmtDate(data?.currentEngine?.since);
  const min = minOf(data);
  const opening = since ? `Since ${since}, the current engine` : 'The current engine';
  const publish = min
    ? `A result is published once a cut has at least ${min} resolved cases.`
    : 'A result is published only once a cut has enough resolved cases.';
  return `Tickrify does not claim an edge. ${opening} decides between Buy now or Sell now, a Buy or Sell on pullback or on breakout, and Wait. It gives an entry at the current price only when fixed checks pass, so it is measured on what it actually outputs: how its pullback and breakout levels resolved, how its Buy now and Sell now plans resolved in R, and how much of each read used market candle data. ${publish} The earlier engines' records stay public in full, archived, with their own rules.`;
}

/** As frases do rastreador de uma serie (motor atual ou v11); `tagged` explica o nome novo de cada estado. */
function trackedSentences(who, c, min, asOf, tagged) {
  const e = tagged ? ' (Buy now or Sell now)' : '';
  const w = tagged ? ' (pullback or breakout entry)' : '';
  const n = tagged ? ' (Wait)' : '';
  const parts = [
    `As of ${asOf}, the ${who} has made ${c.analyses} analyses: ${countOf(c.byState, 'ENTER_NOW')} Enter now${e}, ${countOf(c.byState, 'WATCH')} Watch${w} and ${countOf(c.byState, 'NO_TRADE')} No trade${n}, ${countOf(c.dataMode, 'real_data')} of them read with market candle data.`,
  ];
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
  return parts;
}

/**
 * O resumo com numeros, depois da abertura: motor atual primeiro (estados com
 * o n mesmo abaixo do minimo, porque contagem nao e taxa), o v11 e o motor anterior no fim.
 */
export function accuracySummary(data) {
  if (!data?.previous) return null;
  const asOf = data.updatedAt.slice(0, 10);
  const min = minOf(data);
  const c = data.current;
  const v = data.v11;
  const parts = [];
  if (c) parts.push(...trackedSentences('current engine', c, min, asOf, true));
  else parts.push(`As of ${asOf}, the current engine's results are not loading.`);
  if (v && v.analyses > 0) parts.push(...trackedSentences('v11 engine, kept apart,', v, min, asOf, false));
  const o = data.previous.overall;
  parts.push(
    isRate(o)
      ? `The previous engine, archived, recorded ${o.rate}% across ${o.n} resolved trades (${o.wins} wins, ${o.losses} losses, 95% CI ${o.low}% to ${o.high}%). The records are never added together.`
      : `The previous engine, archived, has ${data.previous.overall.n} resolved trades, below the minimum to publish a rate. The records are never added together.`,
  );
  return parts.join(' ');
}

/** A frase do resultado medio, escolhida pelo veredito da API (below, above, inconclusive). */
export function edgeSentence(name, ar, costs, min) {
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

/** As frases do resultado medio: motor atual, v11 e motor anterior, nunca somados. */
export function edgeAnswer(data) {
  if (!data?.previous) {
    return "Tickrify does not claim an edge. On the live page, each engine's average result per trade in R is published with a 95% interval, and only once enough trades have resolved.";
  }
  const min = minOf(data);
  const spread = 'after an estimated spread, before other costs';
  const cur = data.current
    ? edgeSentence('Current engine', data.current.enterNow.averageResult, spread, min)
    : 'Current engine: results are not loading right now.';
  const v11 = data.v11 && data.v11.analyses > 0 ? `${edgeSentence('v11 engine', data.v11.enterNow.averageResult, spread, min)} ` : '';
  const prev = edgeSentence('Previous engine', data.previous.averageResult, 'before costs', min);
  return `${cur} ${v11}${prev} Tickrify does not claim an edge; this comparison is published so you can check.`;
}

export function averageMethod(data) {
  const min = minOf(data);
  return `Average result per trade: a trade that reaches the first target is worth its own reward in R, a stop is -1R and a timeout 0R. For the previous engine the reward is the plan's recorded first-target ratio, before costs; for the current and v11 engines it is the distance from the fill to the target divided by the risk, minus a typical retail spread for the instrument. Trades without a valid R are left out and counted. The 95% interval of the mean uses Student's t, and the verdict compares that interval with zero. It is published only once ${min ? `at least ${min}` : 'enough'} of its trades reached target or stop.`;
}

export function intervalsMethod(data) {
  const min = minOf(data);
  return `Confidence intervals for rates are Wilson score intervals at 95%, the same function our internal backtest uses. ${min ? `Any cut with fewer than ${min} resolved cases` : 'A cut without enough resolved cases'} shows its sample size instead of a figure.`;
}

export function measurementTechnique(data) {
  const min = minOf(data);
  return `Current and v11 engines: trade plans and Watch levels are tracked against real candles after the validity window plus 48 hours, when a price source is available; reads that cannot be checked are counted separately. Previous engine: eligible trade plans scored automatically against real candles after 48 hours. No human in the loop.${min ? ` Cuts below n = ${min} are shown as sample size only.` : ''}`;
}

export function datasetDescription(data) {
  const since = fmtDate(data?.currentEngine?.since);
  return `Measured results of Tickrify's AI chart analysis in three separate records: the current engine${since ? ` since ${since}` : ''}, tracked by what it delivers (Buy now and Sell now trades, and pullback and breakout levels), the archived v11 engine, and the archived previous engine. Published with sample sizes, 95% confidence intervals and the average result per trade in R.`;
}

/** Comparacao das faixas de confianca do motor anterior: so com as duas faixas publicaveis, frase pelo dado. */
export function confidenceSentence(data) {
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
export function accuracyFaqItems(data) {
  const c = data?.current;
  const v = data?.v11;
  const p = data?.previous;
  const since = fmtDate(data?.currentEngine?.since);
  const v11Since = fmtDate(data?.currentEngine?.v11Since);
  const asOf = data?.updatedAt ? data.updatedAt.slice(0, 10) : null;
  const stops = c && p
    ? `${c.enterNow.outcomes.stop} so far for the current engine${v && v.analyses > 0 ? `, ${v.enterNow.outcomes.stop} for the v11 engine` : ''} and ${p.overall.losses} in the previous engine's headline figures`
    : '';
  return [
    { q: 'How accurate is Tickrify?', a: [accuracyAnswer(data), accuracySummary(data)].filter(Boolean).join(' ') },
    {
      q: 'Why are there three sets of results?',
      a: `Tickrify changed its analysis engine twice${since ? `, most recently on ${since}` : ''}. The first engine returned BUY, SELL or WAIT; the v11 engine${v11Since ? `, from ${v11Since},` : ''} returned Enter now, Watch or No trade; the current one returns Buy now or Sell now, a pullback or breakout entry, or Wait. They are measured with different rules, so their results are published separately and never added together. The earlier records stay public, archived, with their own methodology.`,
    },
    { q: 'How are the current and v11 engines measured?', a: CURRENT_METHOD },
    { q: 'How was the previous engine measured?', a: PREVIOUS_METHOD },
    { q: 'Does Tickrify have an edge?', a: edgeAnswer(data) },
    {
      q: 'Does the AI suggest a trade on every chart?',
      a: c
        ? `No. Of ${c.analyses} current-engine analyses, ${countOf(c.byState, 'ENTER_NOW')} were Enter now (Buy now or Sell now), ${countOf(c.byState, 'WATCH')} were Watch (a pullback or breakout entry) and ${countOf(c.byState, 'NO_TRADE')} were No trade (Wait). Watch and No trade are designed outcomes, not failures to answer, and neither counts as a win or a loss.`
        : 'No. Many analyses return a pullback or breakout entry to wait for, or Wait. Those are designed outcomes, not failures to answer, and neither counts as a win or a loss.',
    },
    {
      q: 'Are losing trades included?',
      a: stops
        ? `Yes. Every stop is counted: ${stops}. Unfilled entries, timeouts and cases without reliable candles are reported separately rather than quietly dropped.`
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

/** Nota do bloco EUR/USD invertido (so o v11 a recebeu): horarios e data vem da API. */
export function eurUsdNote(data) {
  const c = data?.v11;
  const b = c?.eurUsdBlock;
  if (!c || !b) return null;
  const head = `Note on gold and forex: from ${fmtTime(c.since)} to ${fmtTime(b.until)} UTC on ${fmtDate(b.until)}, the market context sent to the v11 engine for gold and forex described EUR/USD rising as the dollar strengthening, the opposite of what it means. It was corrected at ${fmtTime(b.until)} UTC.`;
  return b.analyses > 0
    ? `${head} ${b.analyses} gold and forex analyses in the published sample were made in that window (${b.enterNow} Enter now, ${b.closedWatch} Watch with a closed window). They are included in the v11 figures and flagged for the monthly review.`
    : `${head} No gold or forex analysis in the published sample was made in that window.`;
}

/** Linhas da tabela do rastreador: [rotulo, Enter now, Watch]. */
export function trackingRows(c) {
  const e = c.tracking.ENTER_NOW;
  const w = c.tracking.WATCH;
  const reasons = [...new Set([...Object.keys(e.skippedReasons), ...Object.keys(w.skippedReasons)])].sort();
  return [
    ['Given', countOf(c.byState, 'ENTER_NOW'), countOf(c.byState, 'WATCH')],
    ['Window still open', e.open, w.open],
    ['Window closed, waiting for the next tracker run', e.awaiting, w.awaiting],
    ...reasons.map((r) => [`Not checked: ${TRACK_REASON[r] ?? TRACK_REASON.unknown}`, e.skippedReasons[r] ?? 0, w.skippedReasons[r] ?? 0]),
    ['Checked against real candles', e.tracked, w.tracked],
  ];
}

/**
 * A tabela de acurácia: motor atual primeiro, motor anterior arquivado depois.
 * Formato de tabela é deliberado: é a forma que um modelo de linguagem extrai
 * e cita com menos deformação.
 */
export function accuracyBlock(data) {
  if (!data || !data.previous) return '';
  const asOf = typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : null;
  const min = minOf(data);
  const c = data.current;
  const p = data.previous;
  const avgCell = (ar) =>
    ar.publishable
      ? `${signedR(ar.mean)} (95% CI ${signedR(ar.low)} to ${signedR(ar.high)}), n = ${ar.n}`
      : `Collecting data: ${ar.decided} of ${min} resolved at target or stop`;

  /** As tabelas de uma serie do rastreador (motor atual ou v11). */
  const engineTables = (title, name, ser, unavailable) =>
    ser
      ? [
          `<h2>${esc(title)}${asOf ? `, as of ${esc(asOf)}` : ''}</h2>`,
          `<table><thead><tr><th>Metric</th><th>Value</th><th>Sample</th></tr></thead><tbody>${[
            metricRow('Enter now reached target before stop', ser.enterNow.hitRate, min),
            metricRow('Watch levels reached in time', ser.watch.reachRate, min),
          ].join('')}</tbody></table>`,
          `<table><thead><tr><th>${esc(name)}</th><th>Count</th></tr></thead><tbody>${[
            countRow(`Analyses by the ${name.toLowerCase()}`, ser.analyses),
            countRow('Enter now given', countOf(ser.byState, 'ENTER_NOW')),
            countRow('Watch given', countOf(ser.byState, 'WATCH')),
            countRow('No trade given', countOf(ser.byState, 'NO_TRADE')),
            countRow('Read with market candles', countOf(ser.dataMode, 'real_data')),
            countRow('Read from the screenshot alone', countOf(ser.dataMode, 'print')),
          ].join('')}</tbody></table>`,
          `<table><thead><tr><th>Tracker</th><th>Enter now</th><th>Watch</th></tr></thead><tbody>${trackingRows(ser)
            .map(([label, e, w]) => `<tr><td>${esc(label)}</td><td>${esc(e)}</td><td>${esc(w)}</td></tr>`)
            .join('')}</tbody></table>`,
          `<table><thead><tr><th>Checked Enter now and Watch</th><th>Count</th></tr></thead><tbody>${[
            countRow('Enter now reached the first target', ser.enterNow.outcomes.tp1),
            countRow('Enter now hit the stop', ser.enterNow.outcomes.stop),
            countRow('Enter now timeout, neither in 48 hours', ser.enterNow.outcomes.timeout),
            countRow('Enter now average result per trade, estimated spread deducted', avgCell(ser.enterNow.averageResult)),
            countRow('Watch reached the level in time', ser.watch.outcomes.reached),
            countRow('Watch went beyond the invalidation first', ser.watch.outcomes.invalidated),
            countRow('Watch window closed without reaching the level', ser.watch.outcomes.expired),
            countRow('Watch could not be checked', ser.watch.outcomes.unavailable),
          ].join('')}</tbody></table>`,
        ].join('\n')
      : unavailable;

  const current = engineTables(
    'Current engine: results so far',
    'Current engine',
    c,
    '<h2>Current engine: results so far</h2>\n<p>The current engine’s results were not available when this page was built. The live page loads them from the same API.</p>',
  );
  const v11 = data.v11 && data.v11.analyses > 0 ? engineTables(v11Title(data), 'v11 engine', data.v11, '') : '';

  const rows = [
    metricRow('Hit rate, original scoring rule', p.overall),
    ...(Array.isArray(p.byConfidence) ? p.byConfidence.map((b) => metricRow(BAND_LABEL[b.band] ?? b.band, b)) : []),
    // Regra nova do candle do fill (20/10/2026): serie a parte, nunca somada ao overall.
    metricRow('Hit rate, updated scoring rule (separate series)', p.stopOnly?.overall),
  ]
    .filter(Boolean)
    .join('');

  const abst =
    p.abstention && p.abstention.rate !== null && p.abstention.rate !== undefined
      ? `<p>Abstention rate: ${esc(p.abstention.rate)}% of the previous engine’s analyses returned a WAIT action rather than BUY or SELL (${esc(p.abstention.wait)} of ${esc(p.abstention.total)} analyses). A WAIT can still describe a bullish or bearish market scenario. Waiting is a designed outcome, not a failure to answer.</p>`
      : '';
  const conf = confidenceSentence(data);

  return [
    current,
    v11,
    '<h2>Does Tickrify have an edge?</h2>',
    `<p>${esc(EDGE_INTRO)}</p>`,
    `<p>${esc(edgeAnswer(data))}</p>`,
    `<h2>${esc(previousTitle(data))}</h2>`,
    '<p>The record of the previous engine, kept as it was and scored by its own rules. No analysis of the current or v11 engine is counted here.</p>',
    rows ? `<table><thead><tr><th>Metric</th><th>Value</th><th>Sample</th></tr></thead><tbody>${rows}</tbody></table>` : '',
    `<p>Average result per trade, before costs: ${esc(avgCell(p.averageResult))}.</p>`,
    conf ? `<p>${esc(conf)}</p>` : '',
    abst,
    '<p>A hit rate is not profitability. These figures exclude spread, commission, slippage and funding, and past results do not guarantee future results. The full methodology and the numbers that look bad are published at <a href="https://tickrify.com/accuracy">tickrify.com/accuracy</a>.</p>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** O bloco de perguntas em HTML cru, das mesmas strings que viram FAQPage. */
function accuracyFaqBlock(data) {
  const items = accuracyFaqItems(data);
  return [
    '<h2>Questions people ask about Tickrify accuracy</h2>',
    ...items.map((i) => `<h3>${esc(i.q)}</h3><p>${esc(i.a)}</p>`),
  ].join('\n');
}

/** O FAQ da /pricing em HTML cru, das mesmas strings que viram FAQPage. */
function pricingFaqBlock(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return [
    '<h2>Before you pay</h2>',
    `<dl>${items.map((i) => `<dt>${esc(i.q)}</dt><dd>${esc(i.a)}</dd>`).join('')}</dl>`,
  ].join('\n');
}

/** Links internos em HTML cru. Resolve, de passagem, um problema já diagnosticado:
 *  até hoje o único link para /blog/ vinha do Footer em React, ou seja, não
 *  existia para crawler nenhum, e o Search Console registrava "Nenhuma página
 *  foi detectada" como página de referência do índice do blog. */
function navBlock(current) {
  const links = [
    ['/', 'AI chart analysis'],
    ['/about', 'About Tickrify'],
    ['/pricing', 'Pricing'],
    ['/accuracy', 'Accuracy scoreboard'],
    ['/try', 'Try it free, no signup'],
    ['/blog/', 'Blog'],
    ['/tools/', 'Free trading calculators'],
    ['/for/', 'Platform and market coverage'],
    ['/risk', 'Risk disclosure'],
    ['/terms', 'Terms of Service'],
    ['/privacy', 'Privacy Policy'],
  ].filter(([href]) => href !== current);

  return `<nav><h2>More from Tickrify</h2><ul>${links
    .map(([href, label]) => `<li><a href="${SITE}${href}">${esc(label)}</a></li>`)
    .join('')}</ul></nav>`;
}

const li = (term, detail) => `<li><strong>${esc(term)}</strong>: ${esc(detail)}</li>`;

function howBlock(l) {
  return [
    `<h2>${esc(`${l.how.title} ${l.how.highlight}`)}</h2>`,
    `<p>${esc(l.how.subtitle)}</p>`,
    `<ol>${li(l.how.s1t, l.how.s1d)}${li(l.how.s2t, l.how.s2d)}${li(l.how.s3t, l.how.s3d)}</ol>`,
  ].join('\n');
}

function featuresBlock(l) {
  const items = [1, 2, 3, 4, 5, 6]
    .map((i) => li(l.features[`f${i}t`], l.features[`f${i}d`]))
    .join('');
  return `<h2>${esc(`${l.features.title} ${l.features.highlight}`)}</h2>\n<ul>${items}</ul>`;
}

// Precos da vitrine em i18n trazem {weekly}/{monthly}/{yearly}/{perAnalysis}:
// no navegador vira a moeda local; no HTML cru (indexavel, ingles) vale o USD.
const USD_PRICE_PARAMS = { weekly: '$7.99', monthly: '$29', yearly: '$290', perAnalysis: '$0.145' };
function usd(text) {
  return String(text ?? '').replace(/\{(weekly|monthly|yearly|perAnalysis)\}/g, (_, k) => USD_PRICE_PARAMS[k]);
}

function pricingBlock(l) {
  const items = ['fS1', 'fS2', 'fS3', 'fS4']
    .map((k) => `<li>${esc(usd(l.pricing[k]))}</li>`)
    .join('');
  return [
    `<h2>${esc(`${l.pricing.title} ${l.pricing.highlight}`)}</h2>`,
    `<p>${esc(l.pricing.subtitle)}</p>`,
    `<ul>${items}<li>${esc(l.pricing.monthlyReset)}</li><li>${esc(usd(l.pricing.weeklyLine))}</li></ul>`,
  ].join('\n');
}

function faqBlock(l) {
  const pairs = [1, 2, 3, 4, 5, 6]
    .map((i) => `<dt>${esc(l.faq[`q${i}`])}</dt><dd>${esc(l.faq[`a${i}`])}</dd>`)
    .join('');
  return `<h2>${esc(`${l.faq.title} ${l.faq.highlight}`)}</h2>\n<dl>${pairs}</dl>`;
}

/** `Pricing: $29/mo ... | Tickrify` vira `Pricing: $29/mo ...`. O sufixo da marca
 *  é ruído num H1; no <title> ele existe para o resultado de busca. */
function headingFromTitle(title) {
  return title.replace(/\s*[|·]\s*Tickrify\s*$/i, '').trim();
}

/**
 * Monta o corpo de uma rota. Devolve '' quando não há conteúdo a servir, e o
 * chamador então publica a rota só com o <head>.
 */
/**
 * Home e /pricing citam o METODO e apontam para a /accuracy, sem a taxa de
 * acerto (05/10/2026): numero de desempenho so na /accuracy, com n, intervalo
 * e metodologia, ate a amostra sustentar. Mesma regra da faixa da home.
 */
const ACCURACY_POINTER =
  '<p>Trade plans and Watch levels are checked against real market candles once their window closes, when a price source is available; reads that cannot be checked are counted separately. Results are published in three separate records, the current engine and two archived earlier engines, with sample sizes, 95% confidence intervals, the average result per trade and the results that look bad, at <a href="https://tickrify.com/accuracy">tickrify.com/accuracy</a>.</p>';

export function buildBody({ path, meta, copy, accuracy, pricingFaq }) {
  if (meta.noindex) return '';

  const l = copy?.landing ?? null;
  const parts = [];

  if (path === '/' && l) {
    parts.push(
      `<h1>${esc(`${l.hero.title1} ${l.hero.title2}`)}</h1>`,
      `<p>${esc(l.hero.seoLine)}</p>`,
      `<p>${esc(l.hero.subtitle)}</p>`,
      `<p>${esc(l.hero.valueNow)}</p>`,
      howBlock(l),
      featuresBlock(l),
      ACCURACY_POINTER,
      pricingBlock(l),
      faqBlock(l)
    );
  } else if (path === '/pricing' && l) {
    parts.push(
      `<h1>${esc(headingFromTitle(meta.title))}</h1>`,
      `<p>${esc(meta.description)}</p>`,
      `<p>${esc(l.pricing.subtitle)}</p>`,
      `<ul>${['fS1', 'fS2', 'fS3', 'fS4'].map((k) => `<li>${esc(usd(l.pricing[k]))}</li>`).join('')}<li>${esc(l.pricing.monthlyReset)}</li><li>${esc(usd(l.pricing.weeklyLine))}</li></ul>`,
      `<h2>${esc(l.faq.q6)}</h2><p>${esc(l.faq.a6)}</p>`,
      ACCURACY_POINTER,
      /* As MESMAS perguntas que a tela mostra. Sem isto o crawler que não
       * executa JS via uma pergunta só nesta rota. */
      pricingFaqBlock(pricingFaq)
    );
  } else if (path === '/about') {
    parts.push(
      '<h1>About Tickrify</h1>',
      '<p>Tickrify is an independent, bootstrapped SaaS platform for AI-powered technical chart analysis. It is built by founder Vinicius Marques de Oliveira in Belo Horizonte, Brazil.</p>',
      '<h2>What the product does</h2>',
      '<p>Tickrify analyzes trading charts, identifies market structures and lays out potential entries, stop-loss levels and targets. When conditions do not support a trade setup, it can describe scenarios to wait for instead.</p>',
      '<h2>Where we are going</h2>',
      '<p>Our future goal is to develop specialized agents using Claude to improve analytical precision, technical reasoning and the engineering behind each analysis. These agents are a development objective, not a current product feature.</p>',
      '<h2>Company status</h2>',
      '<p>Tickrify is an independent startup and has not been formally incorporated.</p>',
      '<p>Visit <a href="https://tickrify.com">tickrify.com</a>.</p>'
    );
  } else if (path === '/try' && l) {
    parts.push(
      `<h1>${esc(headingFromTitle(meta.title))}</h1>`,
      `<p>${esc(meta.description)}</p>`,
      `<p>${esc(l.hero.valueNow)}</p>`,
      howBlock(l),
      `<h2>${esc(l.faq.q4)}</h2><p>${esc(l.faq.a4)}</p>`
    );
  } else if (path === '/accuracy') {
    /* Pergunta no H1, resposta no primeiro parágrafo, tabelas em seguida,
     * perguntas frequentes no fim. Mesmos textos da AccuracyPage.tsx. */
    const note = eurUsdNote(accuracy);
    const summary = accuracySummary(accuracy);
    parts.push(
      '<h1>How accurate is Tickrify? Here is how we measure it</h1>',
      `<p>${esc(accuracyAnswer(accuracy))}</p>`,
      summary ? `<p>${esc(summary)}</p>` : '',
      '<p>Every number on this page comes from live production data and is recalculated hourly. Results that look bad stay on the page.</p>',
      `<h2>${esc(whatChangedTitle(accuracy))}</h2>`,
      `<p>${esc(whatChangedIntro(accuracy))}</p>`,
      `<p>${esc(ENGINE_STATES)}</p>`,
      `<p>${esc(WHAT_CHANGED_OUTRO)}</p>`,
      accuracyBlock(accuracy),
      '<h2>Why a hit rate is not profit</h2>',
      '<p>A hit rate ignores how far the target was: a low rate can pay and a high one can lose. Spread, slippage, commission and funding are not in the hit rates; the current and v11 engines’ average result deducts an estimated spread only. Timeouts are left out of the hit rate. Tickrify does not know whether you took the trade, at what size, or when you exited.</p>',
      '<h2>Method</h2>',
      `<p>${esc(WHO_CURRENT)}</p>`,
      `<p>${esc(WHO_PREVIOUS)}</p>`,
      `<p>${esc(WHO_DEMO)}</p>`,
      `<p>Current and v11 engines. ${esc(CURRENT_METHOD)}</p>`,
      `<p>Previous engine. ${esc(PREVIOUS_METHOD)}</p>`,
      `<p>${esc(averageMethod(accuracy))}</p>`,
      `<p>${esc(intervalsMethod(accuracy))}</p>`,
      '<h2>Exclusions</h2>',
      '<p>Who is counted differs by engine; both rules are stated under Method above. Verdicts users tag by hand are excluded. Reads without a price source or without candles are counted separately, never as a win or a loss.</p>',
      accuracyFaqBlock(accuracy),
      note ? `<p>${esc(note)}</p>` : ''
    );
  } else {
    parts.push(`<h1>${esc(headingFromTitle(meta.title))}</h1>`, `<p>${esc(meta.description)}</p>`);
  }

  if (l?.footer?.disclaimer) parts.push(`<p>${esc(l.footer.disclaimer)}</p>`);
  parts.push(navBlock(meta.canonicalPath ?? path));

  const html = parts.filter(Boolean).join('\n');
  return `<noscript data-prerender="body">\n<main>\n${html}\n</main>\n</noscript>`;
}

/**
 * O preço, lido do MESMO lugar que emite o schema da tela.
 *
 * Não é copiado para cá: é extraído do `PricingPage.tsx`, do bloco `offers`
 * que o React já publica. Se o preço mudar lá e não aqui, aqui simplesmente
 * para de emitir o Offer, em vez de anunciar um preço velho. Um número errado
 * numa oferta é pior que oferta nenhuma, e o valor já passou por três edições
 * ($12, $19, $29) neste projeto.
 */
export function readOffer(root) {
  try {
    const src = readFileSync(join(root, 'src/components/pages/PricingPage.tsx'), 'utf8');
    const price = src.match(/price:\s*'([\d.]+)'/);
    const currency = src.match(/priceCurrency:\s*'([A-Z]{3})'/);
    if (!price || !currency) return null;
    return { price: price[1], currency: currency[1] };
  } catch {
    return null;
  }
}

/**
 * As perguntas frequentes da /pricing, lidas do MESMO lugar que a tela usa.
 *
 * Mesma técnica do `readOffer` logo acima, e pelo mesmo motivo: a copy mora
 * em `pricingPage` no dicionario `en.ts`, compartilhado com a tela. Copiar as perguntas para cá criaria duas
 * versões que divergem na primeira vez que ele editar uma resposta, e o
 * schema passaria a declarar texto que a página não mostra.
 *
 * Falhou a extração, devolve null e o pré-render simplesmente não emite FAQ,
 * em vez de emitir uma resposta velha.
 *
 * Por que isso importa: o React já monta FAQPage nesta rota, mas só DEPOIS do
 * JavaScript. Para o crawler que não executa JS, a /pricing tinha uma única
 * pergunta no corpo e nenhum FAQPage. Isto não inventa conteúdo novo, iguala
 * o HTML cru ao que o visitante lê.
 */
export function readPricingFaq(root) {
  try {
    const src = readFileSync(join(root, 'src/lib/i18n/en.ts'), 'utf8');
    const pricingStart = src.indexOf('pricingPage: {');
    const faqStart = src.indexOf('faq: [', pricingStart);
    if (pricingStart < 0 || faqStart < 0) return null;
    const faqEnd = src.indexOf(']', faqStart);
    if (faqEnd < 0) return null;
    const lista = src.slice(faqStart, faqEnd);
    const pares = [...lista.matchAll(/\{\s*q:\s*("(?:[^"\\]|\\.)*"),\s*a:\s*("(?:[^"\\]|\\.)*"),?\s*\}/g)].map((m) => ({
      q: JSON.parse(m[1]),
      a: JSON.parse(m[2]),
    }));

    return pares.length ? pares : null;
  } catch {
    return null;
  }
}

/**
 * JSON-LD no HTML cru.
 *
 * Até hoje o structured data das páginas React só existia DEPOIS do JavaScript
 * (`useJsonLd`), o que significa que nenhum crawler de IA jamais viu um bloco
 * sequer. O `useJsonLd` foi ajustado para remover o bloco de mesmo id ao
 * montar, então o React substitui isto em vez de duplicar.
 *
 * Os ids batem com os das páginas de propósito: 'pricing' e 'accuracy'.
 * A home ganha um FAQPage que ela não tinha em lugar nenhum, montado das
 * MESMAS perguntas que o corpo pré-renderizado mostra logo abaixo.
 */
export function buildJsonLd({ path, copy, accuracy, offer, pricingFaq }) {
  const l = copy?.landing ?? null;
  let data = null;

  if (path === '/about') {
    data = {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      '@id': `${SITE}/about#webpage`,
      name: 'About Tickrify',
      url: `${SITE}/about`,
      about: {
        '@type': 'Organization',
        '@id': `${SITE}/#organization`,
        name: 'Tickrify',
        founder: { '@type': 'Person', name: 'Vinicius Marques de Oliveira' },
        address: { '@type': 'PostalAddress', addressLocality: 'Belo Horizonte', addressCountry: 'BR' },
      },
    };
    return { id: 'about', data };
  }

  if (path === '/' && l) {
    data = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [1, 2, 3, 4, 5, 6].map((i) => ({
        '@type': 'Question',
        name: l.faq[`q${i}`],
        acceptedAnswer: { '@type': 'Answer', text: l.faq[`a${i}`] },
      })),
    };
    return { id: 'home', data };
  }

  if (path === '/pricing' && offer) {
    const app = {
      '@type': 'SoftwareApplication',
      name: 'Tickrify',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      url: `${SITE}`,
      description:
        'AI chart analysis for traders: upload a chart screenshot and get a buy or sell plan with entry, stop and target, an entry to wait for at a level, or Wait with the reason, as a second opinion before you enter.',
      offers: {
        '@type': 'Offer',
        price: offer.price,
        priceCurrency: offer.currency,
        url: `${SITE}/pricing`,
        availability: 'https://schema.org/InStock',
      },
    };

    /* Mesmo formato que o React publica nesta rota: @graph com o app e o
     * FAQPage, id 'pricing'. O FAQ só entra se foi possível ler do
     * PricingPage.tsx; não lido, sai só o app. */
    const perguntas = Array.isArray(pricingFaq) && pricingFaq.length
      ? [
          {
            '@type': 'FAQPage',
            mainEntity: pricingFaq.map((i) => ({
              '@type': 'Question',
              name: i.q,
              acceptedAnswer: { '@type': 'Answer', text: i.a },
            })),
          },
        ]
      : [];

    data = { '@context': 'https://schema.org', '@graph': [app, ...perguntas] };
    return { id: 'pricing', data };
  }

  if (path === '/accuracy') {
    const o = accuracy?.previous?.overall;
    const pubOverall = isRate(o);
    const hit = accuracy?.current?.enterNow?.hitRate;
    const dataset = {
      '@type': 'Dataset',
      name: 'Tickrify AI accuracy: current engine, v11 engine and archived previous engine',
      description: datasetDescription(accuracy),
      url: `${SITE}/accuracy`,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'Tickrify', url: SITE },
      measurementTechnique: measurementTechnique(accuracy),
      /* Os mesmos valores que o .tsx declara, só quando a API respondeu e o
       * recorte passou da regra de n mínimo. */
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
          ...(pubOverall ? { value: o.rate, unitText: 'PERCENT' } : {}),
        },
        {
          '@type': 'PropertyValue',
          name: 'Previous engine sample size (n)',
          description: 'Number of resolved analyses behind the previous engine’s hit rate.',
          ...(pubOverall ? { value: o.n } : {}),
        },
      ],
    };
    /* dateModified só entra quando a API respondeu. A página nunca declara o
     * que não pôde verificar, e o markup segue a mesma regra. */
    if (accuracy?.updatedAt) dataset.dateModified = accuracy.updatedAt;
    if (accuracy?.previous?.firstRecordAt) dataset.temporalCoverage = `${accuracy.previous.firstRecordAt.slice(0, 10)}/..`;

    /* Dataset e FAQPage no mesmo @graph, um id só. O `useJsonLd` do React
     * substitui o elemento por id ao montar; dois elementos aqui virariam um
     * substituído e um duplicado. O FAQPage sai das MESMAS strings que o
     * corpo pré-renderizado mostra. */
    data = {
      '@context': 'https://schema.org',
      '@graph': [
        dataset,
        {
          '@type': 'FAQPage',
          mainEntity: accuracyFaqItems(accuracy).map((i) => ({
            '@type': 'Question',
            name: i.q,
            acceptedAnswer: { '@type': 'Answer', text: i.a },
          })),
        },
      ],
    };
    return { id: 'accuracy', data };
  }

  return null;
}

/** O `<script>` pronto para o `<head>`. `</` escapado: uma barra dentro do
 *  JSON fecharia a tag cedo e quebraria o documento. */
export function jsonLdTag(block) {
  if (!block) return '';
  const json = JSON.stringify(block.data).replace(/<\//g, '<\\/');
  return `<script type="application/ld+json" id="ld-${block.id}">${json}</script>`;
}
