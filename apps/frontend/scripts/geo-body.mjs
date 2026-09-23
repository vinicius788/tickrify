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
    return await res.json();
  } catch {
    return null;
  }
}

/** Uma linha de métrica que obedece as regras da AccuracyPage: sem n suficiente, mostra o n. */
function metricRow(label, interval) {
  if (!interval || typeof interval.n !== 'number') return '';
  const value =
    interval.publishable && interval.rate !== null && interval.rate !== undefined
      ? `${interval.rate}% (95% CI ${interval.low}% to ${interval.high}%)`
      : 'Not published yet, too few resolved trades';
  return `<tr><td>${esc(label)}</td><td>${esc(value)}</td><td>n = ${esc(interval.n)}</td></tr>`;
}

const BAND_LABEL = {
  below60: 'Confidence below 60',
  band60to69: 'Confidence 60 to 69, shown as "Read"',
  band70plus: 'Confidence 70 and above, shown as "Signal"',
  unknown: 'Confidence not recorded',
};

/**
 * A tabela de acurácia. Formato de tabela é deliberado: é a forma que um
 * modelo de linguagem extrai e cita com menos deformação, e é o único ativo
 * do site que nenhum concorrente do nicho publica.
 */
export function accuracyBlock(data) {
  if (!data || !data.overall) return '';
  const asOf = typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : null;

  const rows = [
    metricRow('Hit rate, all resolved analyses', data.overall),
    ...(Array.isArray(data.byConfidence)
      ? data.byConfidence.map((b) => metricRow(BAND_LABEL[b.band] ?? b.band, b))
      : []),
  ]
    .filter(Boolean)
    .join('');

  const abst =
    data.abstention && data.abstention.rate !== null && data.abstention.rate !== undefined
      ? `<p>Abstention rate: ${esc(data.abstention.rate)}% of analyses return a WAIT action rather than BUY or SELL (${esc(data.abstention.wait)} of ${esc(data.abstention.total)} analyses). A WAIT can still describe a bullish or bearish market scenario. Waiting is a designed outcome, not a failure to answer.</p>`
      : '';

  return [
    `<h2>Measured accuracy${asOf ? `, as of ${esc(asOf)}` : ''}</h2>`,
    '<p>Every completed analysis that carries a trade plan is scored automatically 48 hours later against real market candles: did the first target print before the stop? No human in the loop, no cherry-picking, losses included. Rates with fewer than 20 resolved trades are withheld and only the sample size is shown.</p>',
    rows ? `<table><thead><tr><th>Metric</th><th>Value</th><th>Sample</th></tr></thead><tbody>${rows}</tbody></table>` : '',
    abst,
    '<p>A hit rate is not profitability. These figures exclude spread, commission, slippage and funding, and past results do not guarantee future results. The full methodology and the numbers that look bad are published at <a href="https://tickrify.com/accuracy">tickrify.com/accuracy</a>.</p>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A resposta direta, em uma frase, a partir do recorte geral.
 *
 * Passo 4 do GEO: a pergunta no H1 e a resposta no primeiro parágrafo. Um
 * modelo que lê HTML cru não rola a página até a tabela, ele extrai o começo.
 * Sem número publicável, devolve a frase de método, nunca um número guardado
 * aqui como reserva, que é como se publica um número velho sem perceber.
 */
export function accuracyAnswer(data) {
  const o = data?.overall;
  const asOf = typeof data?.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : null;
  if (!o || !o.publishable || o.rate === null || o.rate === undefined || !asOf) {
    return 'Tickrify publishes its measured hit rate on tickrify.com/accuracy, recalculated hourly from live production data, always with the sample size and a 95% confidence interval. No rate is published for any cut with fewer than 20 resolved trades.';
  }
  return `As of ${asOf}, ${o.rate}% of resolved Tickrify analyses reached their first target before their stop: ${o.wins} wins against ${o.losses} losses across ${o.n} resolved trades, with a 95% confidence interval of ${o.low}% to ${o.high}%. The figure is recalculated hourly from live production data.`;
}

/**
 * As mesmas perguntas e respostas que a AccuracyPage mostra na tela.
 *
 * Estão escritas duas vezes, aqui e no .tsx, porque um script de build em
 * Node não importa componente React. A regra que mantém as duas honestas é a
 * mesma dos dois lados: nenhuma resposta traz número que a API não devolveu
 * neste build. Se divergirem em redação, o schema continua verdadeiro; o que
 * nunca pode divergir é o número.
 */
export function accuracyFaqItems(data) {
  const asOf = typeof data?.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : null;
  const o = data?.overall;
  const pub = o && o.publishable && o.rate !== null && o.rate !== undefined;
  const abst = data?.abstention;

  return [
    { q: 'How accurate is Tickrify?', a: accuracyAnswer(data) },
    {
      q: 'How is that accuracy measured?',
      a: 'An automated sweeper runs hourly and scores every analysis that was completed at least 48 hours earlier against real market candles. The proposed entry must fill first, then the first target races the stop on 30-minute candles. If one candle contains both the target and the stop, it is recorded as a loss. There is no human in the loop and no selection of which trades get scored.',
    },
    {
      q: 'Does the AI suggest a trade on every chart?',
      a:
        abst && abst.rate !== null && abst.rate !== undefined
          ? `No. ${abst.rate}% of analyses (${abst.wait} of ${abst.total}) return a WAIT action rather than BUY or SELL. A WAIT can still describe a bullish or bearish market scenario. Waiting is a designed outcome, not a failure to answer, and those analyses count as neither a win nor a loss.`
          : 'No. A share of analyses return a WAIT action rather than BUY or SELL. A WAIT can still describe a bullish or bearish market scenario. Waiting is a designed outcome, not a failure to answer, and those analyses count as neither a win nor a loss.',
    },
    {
      q: 'Is that hit rate good or bad?',
      a: 'On its own it is neither, and Tickrify does not claim it is good. A hit rate says nothing about profitability without reward-to-risk, and these figures exclude spread, slippage, commission and funding, so a real account would do worse. The reason the number is published with its confidence interval is so you can judge it instead of taking a marketing figure on trust.',
    },
    {
      q: 'Are losing trades included?',
      a: pub
        ? `Yes. ${o.losses} losses are counted in the published rate, alongside ${o.wins} wins. Unfilled entries, abstentions and untrackable symbols are reported separately and excluded from the rate rather than quietly dropped.`
        : 'Yes. Every loss the sweeper records is counted in the published rate. Unfilled entries, abstentions and untrackable symbols are reported separately and excluded from the rate rather than quietly dropped.',
    },
    {
      q: 'How often is this page updated?',
      a: asOf
        ? `The scoreboard is recalculated hourly and was last updated on ${asOf}. It moves on its own, including when it moves against us.`
        : 'The scoreboard is recalculated hourly. It moves on its own, including when it moves against us.',
    },
  ];
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

function pricingBlock(l) {
  const items = ['fS1', 'fS2', 'fS3', 'fS4']
    .map((k) => `<li>${esc(l.pricing[k])}</li>`)
    .join('');
  return [
    `<h2>${esc(`${l.pricing.title} ${l.pricing.highlight}`)}</h2>`,
    `<p>${esc(l.pricing.subtitle)}</p>`,
    `<ul>${items}<li>${esc(l.pricing.monthlyReset)}</li></ul>`,
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
      accuracyBlock(accuracy),
      pricingBlock(l),
      faqBlock(l)
    );
  } else if (path === '/pricing' && l) {
    parts.push(
      `<h1>${esc(headingFromTitle(meta.title))}</h1>`,
      `<p>${esc(meta.description)}</p>`,
      `<p>${esc(l.pricing.subtitle)}</p>`,
      `<ul>${['fS1', 'fS2', 'fS3', 'fS4'].map((k) => `<li>${esc(l.pricing[k])}</li>`).join('')}<li>${esc(l.pricing.monthlyReset)}</li></ul>`,
      `<h2>${esc(l.faq.q6)}</h2><p>${esc(l.faq.a6)}</p>`,
      accuracyBlock(accuracy),
      /* As MESMAS perguntas que a tela mostra. Sem isto o crawler que não
       * executa JS via uma pergunta só nesta rota. */
      pricingFaqBlock(pricingFaq)
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
    /* Pergunta no H1, resposta no primeiro parágrafo, tabela em seguida,
     * perguntas frequentes no fim. É a ordem que um assistente de IA
     * consegue citar sem ler a página inteira. */
    parts.push(
      `<h1>How accurate is Tickrify’s AI chart analysis?</h1>`,
      `<p>${esc(accuracyAnswer(accuracy))}</p>`,
      '<p>That number is measured, not claimed. Every analysis Tickrify produces is re-checked against real market candles 48 hours later, automatically, with no human in the loop. This page is that raw scoreboard. It moves on its own and it includes the results that look bad.</p>',
      accuracyBlock(accuracy),
      `<h2>Why this page exists</h2>`,
      '<p>Tools in this category advertise accuracy figures without a sample size, a confidence interval or a method. Tickrify publishes the raw scoreboard instead, and keeps publishing it when it looks bad. The measurement runs automatically against real candles, so it cannot be curated after the fact.</p>',
      accuracyFaqBlock(accuracy)
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
 * em `PRICING_COPY` dentro do `PricingPage.tsx`, e um script de build em Node
 * não importa componente React. Copiar as perguntas para cá criaria duas
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
    const src = readFileSync(join(root, 'src/components/pages/PricingPage.tsx'), 'utf8');
    const enStart = src.indexOf('en: {');
    const ptStart = src.indexOf('pt: {', enStart);
    if (enStart < 0 || ptStart < 0) return null;

    const bloco = src.slice(enStart, ptStart);
    const faqStart = bloco.indexOf('faq: [');
    if (faqStart < 0) return null;

    const lista = bloco.slice(faqStart);
    const pares = [...lista.matchAll(/\{\s*q:\s*'((?:[^'\\]|\\.)*)',\s*a:\s*'((?:[^'\\]|\\.)*)',?\s*\}/g)].map((m) => ({
      q: m[1].replace(/\\'/g, "'"),
      a: m[2].replace(/\\'/g, "'"),
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
        'AI chart analysis for traders: upload a chart screenshot and get entry, stop, targets, risk and confidence, a second opinion before you enter.',
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
    const o = accuracy?.overall;
    const pubOverall = Boolean(o && o.publishable && o.rate !== null && o.rate !== undefined);
    const dataset = {
      '@type': 'Dataset',
      name: 'Tickrify AI accuracy: measured hit rate',
      description:
        'The measured hit rate of Tickrify AI chart analysis, published with sample size and 95% Wilson confidence intervals, including the results that look bad. Every analysis is re-checked against real market candles 48 hours after it was produced.',
      url: `${SITE}/accuracy`,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'Tickrify', url: SITE },
      measurementTechnique:
        'Each published analysis is scored automatically against real candles 48 hours later, with no human in the loop. Rates below n = 20 are shown as sample size only.',
      /* Os mesmos valores que o .tsx declara. Sem eles o Dataset descreve as
       * variáveis mas não publica nenhuma medida, e é justamente a medida que
       * um assistente de IA cita. Entram só quando a API respondeu e o recorte
       * passou da regra de n mínimo: mesma regra da página. */
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Hit rate',
          description: 'Share of resolved analyses that reached target before stop, with a 95% Wilson confidence interval.',
          ...(pubOverall ? { value: accuracy.overall.rate, unitText: 'PERCENT' } : {}),
        },
        {
          '@type': 'PropertyValue',
          name: 'Abstention rate',
          description: 'Share of analyses with a WAIT action rather than BUY or SELL; the market scenario may still be directional.',
          ...(accuracy?.abstention && accuracy.abstention.rate !== null && accuracy.abstention.rate !== undefined
            ? { value: accuracy.abstention.rate, unitText: 'PERCENT' }
            : {}),
        },
        {
          '@type': 'PropertyValue',
          name: 'Sample size (n)',
          description: 'Number of resolved analyses behind each published rate.',
          ...(pubOverall ? { value: accuracy.overall.n } : {}),
        },
      ],
    };
    /* dateModified só entra quando a API respondeu. A página nunca declara o
     * que não pôde verificar, e o markup segue a mesma regra. */
    if (accuracy?.updatedAt) dataset.dateModified = accuracy.updatedAt;
    if (accuracy?.groundingLiveSince) dataset.temporalCoverage = `${accuracy.groundingLiveSince.slice(0, 10)}/..`;

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
