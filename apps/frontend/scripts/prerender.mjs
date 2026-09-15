#!/usr/bin/env node
/**
 * Pré-renderização das rotas públicas — auditoria de SEO de 10/08/2026.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * O site é uma SPA: o servidor devolve o mesmo `index.html` para toda rota. O
 * `useSeo` conserta o `<head>` DEPOIS que o React hidrata, o que basta para o
 * Googlebot (que executa JS) e não basta para mais ninguém — Bing, crawlers de
 * IA e a prévia de link do WhatsApp/Slack/X leem o HTML cru e vão embora. Para
 * eles, `/pricing` continuava sendo o home.
 *
 * COMO FUNCIONA
 * Depois do `vite build`, este script clona o `dist/index.html` para
 * `dist/<rota>/index.html` trocando title, description, canonical e og/twitter.
 * Nenhum bundle novo, nenhuma dependência: é o MESMO app, servido de um caminho
 * com o `<head>` já certo. O React monta normalmente e assume a partir daí.
 *
 * POR QUE NÃO PRECISA MEXER NO vercel.json
 * O `rewrites` do Vercel roda DEPOIS da checagem de filesystem. Se
 * `dist/pricing/index.html` existe, o Vercel serve esse arquivo e o rewrite
 * para `/index.html` nunca dispara. É exatamente o mecanismo pelo qual as
 * páginas estáticas de `public/blog` já funcionam hoje em produção — ou seja,
 * não é teoria, é o comportamento observado neste mesmo projeto.
 *
 * SEGURANÇA
 * Se qualquer coisa aqui falhar, o script AVISA E SAI COM CÓDIGO 0. O build não
 * quebra por causa de SEO: sem os arquivos gerados, o Vercel volta a servir o
 * `index.html` pelo rewrite e o site se comporta exatamente como antes.
 *
 * O CORPO TAMBÉM É PRÉ-RENDERIZADO desde 14/09/2026, dentro de `<noscript>`,
 * pelo `geo-body.mjs` deste mesmo diretório. A nota anterior aqui dizia que
 * renderizar o corpo exigia navegador headless no build: isso vale para
 * renderizar o APP, e não para servir o texto da página. O texto sai do
 * `en.ts` e da API de acurácia, sem navegador e sem dependência nova. Ver o
 * cabeçalho do `geo-body.mjs` para o porquê de `<noscript>` e não `#root`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBody,
  buildJsonLd,
  fetchAccuracy,
  jsonLdTag,
  loadEnglishCopy,
  readOffer,
  readPricingFaq,
} from './geo-body.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://tickrify.com';

/** Falha suave: nada de SEO justifica derrubar um deploy. */
function bail(message) {
  console.warn(`[prerender] PULADO: ${message}`);
  console.warn('[prerender] O build segue válido — o Vercel volta ao fallback da SPA.');
  process.exit(0);
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Troca o `content` de uma meta já existente. Se a tag não existir, não inventa:
 * o `index.html` é a fonte, e uma tag ausente ali é decisão de quem editou.
 */
function replaceMetaContent(html, attr, key, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
  // Substituição por FUNÇÃO, nunca por string. Numa string de replacement o
  // cifrão é sintaxe: o preço "$29" vira grupo 2 seguido de "9" e a meta da
  // /pricing sai anunciando "9/mo". Aconteceu de verdade ao testar isto.
  return re.test(html) ? html.replace(re, (_m, open, close) => open + escapeAttr(value) + close) : html;
}

function replaceTitle(html, value) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(value)}</title>`);
}

/**
 * Injeta <meta name="robots" content="noindex,nofollow"> numa rota interna.
 *
 * Por que isto precisa existir no PRÉ-RENDER e não só no useSeo: o useSeo roda
 * depois do JavaScript. Um rastreador que não executa JS vê só o shell — e o
 * shell não diz nada sobre indexação. O /sign-in já foi parar no índice do
 * Google exatamente assim.
 *
 * E por que noindex em vez de Disallow no robots.txt: `Disallow` impede
 * RASTREAR, não INDEXAR. A URL entra no índice por link mesmo bloqueada, e
 * bloqueada o Google nunca chega a LER o noindex. Para tirar do índice é
 * preciso deixar rastrear e mandar noindex — os dois juntos se anulam.
 */
function applyNoindex(html) {
  const re = /(<meta\s+name="robots"\s+content=")[^"]*(")/i;
  if (re.test(html)) {
    return html.replace(re, (_m, open, close) => open + 'noindex,nofollow' + close);
  }
  return html.replace(/<\/head>/i, () => '  <meta name="robots" content="noindex,nofollow" />\n  </head>');
}

function replaceCanonical(html, url) {
  const re = /(<link\s+rel="canonical"\s+href=")[^"]*(")/i;
  return re.test(html)
    ? html.replace(re, (_m, open, close) => open + escapeAttr(url) + close)
    : html.replace(/<\/head>/i, () => `  <link rel="canonical" href="${escapeAttr(url)}" />\n  </head>`);
}

/* A pintura pré-hidratação NÃO é mais reescrita aqui.
 *
 * Existia uma `replacePrehydrate` que trocava o hero embutido pelo title e a
 * description de cada rota, porque o index.html trazia o hero da landing e
 * /pricing pintava "Stop trading in the dark" antes de montar. Em 25/08/2026 o
 * bloco do index.html virou só a barra do cabeçalho, sem texto nenhum: já é
 * correto em qualquer rota, e reescrever deixou de ter função. Ver o comentário
 * no <style> do index.html.
 */

/**
 * Injeta o JSON-LD da rota no `<head>`.
 *
 * Marcado com o mesmo id que o `useJsonLd` usa, e o hook passou a remover o
 * elemento de mesmo id antes de inserir o dele: o React substitui este bloco
 * em vez de empilhar um segundo. Sem isso, a página teria dois elementos com
 * o mesmo id e schema duplicado.
 */
function injectJsonLd(html, tag) {
  if (!tag) return html;
  const cleaned = html.replace(/<script type="application\/ld\+json" id="ld-[^"]*">[\s\S]*?<\/script>\s*/i, () => '');
  if (!/<\/head>/i.test(cleaned)) return cleaned;
  return cleaned.replace(/<\/head>/i, () => `  ${tag}\n  </head>`);
}

/** Marcador do bloco gerado aqui. Só remove o que este script escreveu: um
 *  `<noscript>` que alguém ponha à mão no index.html não é tocado. */
const BODY_OPEN = '<noscript data-prerender="body">';
const BODY_CLOSE = '</noscript>';

/**
 * Tira um corpo pré-renderizado que já esteja no HTML.
 *
 * Isto existe por um bug real, pego ao testar: o `base` é lido uma vez e
 * reusado em todas as rotas. Rodando o script duas vezes sobre o mesmo `dist`,
 * o `dist/index.html` já voltava com o corpo da HOME dentro, e como a injeção
 * era idempotente por presença, TODA rota filha herdava o texto da home e não
 * recebia o seu. A /pricing passava a servir "Stop trading in the dark" como
 * h1. O Vercel builda do zero e nunca cairia nisso; um build repetido na mão,
 * sim. Limpar antes de escrever torna o resultado o mesmo em qualquer ordem.
 */
function stripBody(html) {
  const start = html.indexOf(BODY_OPEN);
  if (start === -1) return html;
  const end = html.indexOf(BODY_CLOSE, start);
  if (end === -1) return html;
  return (html.slice(0, start) + html.slice(end + BODY_CLOSE.length)).replace(/\n\s*\n(\s*<\/body>)/i, (_m, tail) => `\n${tail}`);
}

/**
 * Injeta o corpo pré-renderizado antes de `</body>`.
 *
 * Substituição por FUNÇÃO, como todas as outras deste arquivo: o bloco contém
 * `$29` e, numa string de replacement, `$2` é sintaxe de grupo. Foi assim que
 * a meta da /pricing chegou a sair anunciando "9/mo".
 */
function injectBody(html, body) {
  if (!body) return html;
  if (!/<\/body>/i.test(html)) return html;
  return stripBody(html).replace(/<\/body>/i, () => `${body}\n  </body>`);
}

async function main() {
  if (!existsSync(DIST)) bail('dist/ não existe — o vite build rodou?');

  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath)) bail('dist/index.html não existe');

  let routes;
  try {
    routes = JSON.parse(readFileSync(join(ROOT, 'src/lib/seo-routes.json'), 'utf8'));
  } catch (error) {
    bail(`não consegui ler src/lib/seo-routes.json (${error.message})`);
  }

  const base = stripBody(readFileSync(indexPath, 'utf8'));
  const written = [];

  /* As duas fontes do corpo. Qualquer uma pode falhar sem derrubar nada: sem
   * `copy` as rotas caem no bloco genérico (h1 + description), sem `accuracy`
   * a tabela de números simplesmente não é emitida. */
  let copy = null;
  try {
    copy = await loadEnglishCopy(ROOT);
  } catch (error) {
    console.warn(`[prerender] en.ts não carregou (${error.message}); corpo sai reduzido.`);
  }
  if (!copy) console.warn('[prerender] AVISO: sem en.ts, o corpo pré-renderizado sai reduzido.');

  const offer = readOffer(ROOT);
  if (!offer) console.warn('[prerender] AVISO: preço não lido do PricingPage; /pricing sai sem Offer no schema.');

  const pricingFaq = readPricingFaq(ROOT);
  if (!pricingFaq) console.warn('[prerender] AVISO: FAQ não lido do PricingPage; /pricing sai sem FAQ no corpo e no schema.');

  const accuracy = await fetchAccuracy();
  if (!accuracy) console.warn('[prerender] AVISO: /api/ai/accuracy não respondeu; páginas saem sem a tabela de números.');

  for (const [path, meta] of Object.entries(routes)) {
    /* O '/' não precisa de <head> novo (o index.html já nasce correto), mas
     * precisa de corpo: ele era a única rota servindo zero palavra em HTML
     * cru justamente por ser pulada aqui. */
    if (path === '/') {
      const homeBody = buildBody({ path, meta, copy, accuracy, pricingFaq });
      const homeLd = jsonLdTag(buildJsonLd({ path, copy, accuracy, offer, pricingFaq }));
      if (homeBody || homeLd) {
        writeFileSync(indexPath, injectJsonLd(injectBody(base, homeBody), homeLd), 'utf8');
        written.push('/ (corpo)');
      }
      continue;
    }

    const canonical = `${SITE}${meta.canonicalPath ?? path}`;
    let html = base;

    html = replaceTitle(html, meta.title);
    html = replaceMetaContent(html, 'name', 'description', meta.description);
    html = replaceMetaContent(html, 'property', 'og:title', meta.title);
    html = replaceMetaContent(html, 'property', 'og:description', meta.description);
    html = replaceMetaContent(html, 'property', 'og:url', canonical);
    html = replaceMetaContent(html, 'name', 'twitter:title', meta.title);
    html = replaceMetaContent(html, 'name', 'twitter:description', meta.description);
    html = replaceCanonical(html, canonical);
    if (meta.noindex) html = applyNoindex(html);

    html = injectBody(html, buildBody({ path, meta, copy, accuracy, pricingFaq }));
    html = injectJsonLd(html, jsonLdTag(buildJsonLd({ path, copy, accuracy, offer, pricingFaq })));

    const outDir = join(DIST, path.replace(/^\//, ''));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), html, 'utf8');
    written.push(path);
  }

  console.log(`[prerender] ${written.length} rota(s) publicadas: ${written.join(', ')}`);
  console.log(`[prerender] corpo em <noscript>: ${copy ? 'completo (en.ts)' : 'reduzido'} · acurácia: ${accuracy ? 'com números do build' : 'sem números'}`);
}

main().catch((error) => bail(error?.stack ?? String(error)));
