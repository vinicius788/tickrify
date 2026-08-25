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
 * ⚠️ Só o `<head>` é pré-renderizado, não o conteúdo. Renderizar o corpo exige
 * navegador headless no build (dependência nova, proibida aqui — ver CLAUDE.md).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Substitui a pintura pré-hidratação.
 *
 * Isto conserta um bug de verdade, não só SEO: o `index.html` traz o hero da
 * landing embutido, então abrir /pricing pintava "Stop trading in the dark" por
 * uma fração de segundo antes do React montar a página de preço.
 *
 * O bloco novo usa SÓ o title e a description da própria rota — que já vivem no
 * seo-routes.json. Nada de copy nova: uma segunda cópia de texto de vitrine
 * divergiria da primeira e viraria claim desencontrado (a auditoria de 27/07
 * existiu por causa disso).
 *
 * Ancoragem: casa do `<div id="root">` até o último `</div>` antes de `</body>`.
 * Conferido contra a saída real do Vite 6 — que, atenção, move o
 * `<script type="module">` para o `<head>`, então ancorar no script não serve.
 */
function replacePrehydrate(html, { title, description }) {
  const re = /<div id="root">[\s\S]*<\/div>(?=\s*<\/body>)/i;
  if (!re.test(html)) {
    console.warn('[prerender] aviso: bloco #root não reconhecido; mantendo o do index.html');
    return html;
  }
  const block =
    '<div id="root"><div class="prehydrate-hero">' +
    `<span class="ph-badge">TICKRIFY</span>` +
    `<h1 style="font-size:clamp(2rem,4.5vw,3.25rem);line-height:1.1">${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(description)}</p>` +
    '</div></div>';
  return html.replace(re, () => block);
}

function main() {
  if (!existsSync(DIST)) bail('dist/ não existe — o vite build rodou?');

  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath)) bail('dist/index.html não existe');

  let routes;
  try {
    routes = JSON.parse(readFileSync(join(ROOT, 'src/lib/seo-routes.json'), 'utf8'));
  } catch (error) {
    bail(`não consegui ler src/lib/seo-routes.json (${error.message})`);
  }

  const base = readFileSync(indexPath, 'utf8');
  const written = [];

  for (const [path, meta] of Object.entries(routes)) {
    // '/' já é o próprio dist/index.html, que o Vite acabou de gerar.
    if (path === '/') continue;

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
    html = replacePrehydrate(html, meta);
    if (meta.noindex) html = applyNoindex(html);

    const outDir = join(DIST, path.replace(/^\//, ''));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), html, 'utf8');
    written.push(path);
  }

  console.log(`[prerender] ${written.length} rota(s) com <head> próprio: ${written.join(', ')}`);
}

try {
  main();
} catch (error) {
  bail(error?.stack ?? String(error));
}
