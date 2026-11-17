#!/usr/bin/env node
/**
 * IndexNow: avisa Bing, Yandex, Naver, Seznam e Yep quando paginas publicas mudam.
 *
 * POR QUE (17/11/2026)
 * O ChatGPT consulta o Bing entre os provedores de busca dele, e em 17/11 o Bing
 * ainda mostrava a descricao do /try de antes de 12/11: nao tinha voltado ao site.
 * Com o IndexNow o Bing fica sabendo na hora. O Google NAO usa IndexNow (para ele
 * vale o sitemap e o Search Console); o Brave, que alimenta o Claude, tambem nao.
 *
 * DOIS MODOS
 *   node scripts/indexnow.mjs --write-key
 *     No build (package.json), depois do prerender: grava dist/<KEY>.txt, o arquivo
 *     que prova que o site e nosso. Gerado no build para nao deixar arquivo solto
 *     no repositorio.
 *   node scripts/indexnow.mjs [--all] [--dry-run]
 *     Depois do deploy (workflow .github/workflows/indexnow.yml): le o sitemap NO AR,
 *     confere que a chave esta publicada e envia as URLs com <lastmod> dos ultimos
 *     RECENT_DAYS dias. --all envia as 32 (primeira vez ou depois de muito tempo).
 *     --dry-run lista e nao envia.
 *
 * REGRA: pagina publica que mudou de conteudo = <lastmod> novo no
 * public/sitemap.xml no MESMO commit. E o lastmod que decide o que e enviado; reenviar
 * URL que nao mudou, deploy apos deploy, o protocolo pede para nao fazer.
 *
 * A chave e publica por desenho do protocolo (fica num arquivo no proprio site): nao
 * e segredo. Trocar a chave = trocar a constante; o arquivo novo sai no proximo build.
 *
 * Nunca derruba build nem workflow: qualquer falha vira aviso e sai com 0.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = '9ae64cf43104787d2cd87597280cedc4';
const HOST = 'tickrify.com';
const SITE = `https://${HOST}`;
const KEY_URL = `${SITE}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const RECENT_DAYS = 3;
const KEY_CHECKS = 6;
const KEY_CHECK_WAIT_MS = 10_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(resolve(HERE, '..'), 'dist');

function skip(message) {
  console.warn(`[indexnow] PULADO: ${message}`);
  process.exit(0);
}

function writeKeyFile() {
  if (!existsSync(DIST)) skip('dist/ nao existe; o vite build rodou?');
  writeFileSync(join(DIST, `${KEY}.txt`), KEY);
  console.log(`[indexnow] Chave gravada em dist/${KEY}.txt`);
}

/** URLs do sitemap com o lastmod de cada uma. Comentarios saem antes (citam a tag). */
export function parseSitemap(xml) {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const block of clean.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    const lastmod = block[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? null;
    if (loc) out.push({ loc, lastmod });
  }
  return out;
}

/** Fica com as URLs do nosso host e, sem --all, so as de lastmod recente. */
export function pickUrls(entries, { all, now = Date.now() }) {
  const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => {
      try {
        return new URL(e.loc).host === HOST;
      } catch {
        return false;
      }
    })
    .filter((e) => all || (e.lastmod !== null && Date.parse(e.lastmod) >= cutoff))
    .map((e) => e.loc);
}

async function keyIsLive() {
  for (let i = 1; i <= KEY_CHECKS; i += 1) {
    try {
      const res = await fetch(KEY_URL, { cache: 'no-store' });
      if (res.ok && (await res.text()).trim() === KEY) return true;
      console.warn(`[indexnow] Chave ainda nao publicada (tentativa ${i}, status ${res.status})`);
    } catch (err) {
      console.warn(`[indexnow] Falha ao ler a chave (tentativa ${i}): ${err.message}`);
    }
    if (i < KEY_CHECKS) await new Promise((r) => setTimeout(r, KEY_CHECK_WAIT_MS));
  }
  return false;
}

async function ping({ all, dryRun }) {
  let xml;
  try {
    const res = await fetch(`${SITE}/sitemap.xml`, { cache: 'no-store' });
    if (!res.ok) skip(`sitemap respondeu ${res.status}`);
    xml = await res.text();
  } catch (err) {
    skip(`sitemap inacessivel: ${err.message}`);
  }

  const entries = parseSitemap(xml);
  const urls = pickUrls(entries, { all });
  console.log(`[indexnow] Sitemap: ${entries.length} URLs; a enviar: ${urls.length}${all ? ' (--all)' : ` (lastmod nos ultimos ${RECENT_DAYS} dias)`}`);
  if (urls.length === 0) {
    console.log('[indexnow] Nada mudou no sitemap; nada a enviar.');
    return;
  }
  for (const url of urls) console.log(`  ${url}`);
  if (dryRun) {
    console.log('[indexnow] --dry-run: nada enviado.');
    return;
  }

  if (!(await keyIsLive())) skip(`a chave nao esta publicada em ${KEY_URL}`);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_URL, urlList: urls }),
    });
    // 200 = recebido; 202 = recebido, chave ainda em validacao. O resto e aviso.
    const level = res.status === 200 || res.status === 202 ? 'log' : 'warn';
    console[level](`[indexnow] Enviado: ${urls.length} URLs, resposta ${res.status}`);
  } catch (err) {
    skip(`envio falhou: ${err.message}`);
  }
}

const args = new Set(process.argv.slice(2));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (args.has('--write-key')) writeKeyFile();
  else await ping({ all: args.has('--all'), dryRun: args.has('--dry-run') });
}
