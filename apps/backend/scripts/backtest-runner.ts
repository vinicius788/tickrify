#!/usr/bin/env ts-node
/**
 * BACKTEST — Etapa C (parte 2): chama o MOTOR REAL de análise para cada
 * gráfico renderizado em scripts/backtest/charts/.
 *
 * Usa exatamente o caminho de produção: PromptBuilderService (prompt oficial,
 * idioma EN) + AIAdapter.analyzeImage(dataUrl, prompt, 'quick') — incluindo os
 * guards determinísticos (caps de confiança, guard de R/R, teto de WAIT).
 * ÚNICA diferença deliberada: ENABLE_NEWS_GUARD=false, porque o news guard
 * consulta o calendário econômico DE HOJE — aplicá-lo a gráficos históricos
 * contaminaria o resultado (documentado no relatório).
 *
 * Como rodar (na pasta apps/backend):
 *   export OPENAI_API_KEY=...        # você cola a chave, nunca o Claude
 *   npx ts-node scripts/backtest-runner.ts --limit 10        # piloto
 *   npx ts-node scripts/backtest-runner.ts --yes             # rodada completa
 *
 * Flags:
 *   --limit N   processa no máximo N amostras pendentes (piloto = 10)
 *   --yes       pula a confirmação interativa de custo
 *
 * Incremental/retomável: cada resposta vira uma linha em
 * scripts/backtest/results/analyses.jsonl. Se o script cair, rode de novo —
 * ele pula o que já foi analisado.
 *
 * O prompt do sistema NUNCA é gravado em lugar nenhum — só a resposta.
 */
// Desliga o news guard ANTES de importar o motor (lido em tempo de chamada,
// mas garantimos aqui para qualquer refactor futuro).
process.env.ENABLE_NEWS_GUARD = 'false';

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { AIAdapter, AIAnalysisError, buildRealDataBlock } from '../src/modules/ai/ai.adapter';
import { PromptBuilderService } from '../src/modules/prompt/prompt-builder.service';

const BACKTEST_DIR = path.resolve(__dirname, '../../../scripts/backtest');
const MANIFEST = path.join(BACKTEST_DIR, 'manifest.json');
const RESULTS_DIR = path.join(BACKTEST_DIR, 'results');
// --out <arquivo.jsonl> permite rodadas paralelas (ex.: prompt v1 vs v2)
const outIdx = process.argv.indexOf('--out');
const RESULTS = path.join(
  RESULTS_DIR,
  outIdx >= 0 ? path.basename(process.argv[outIdx + 1]) : 'analyses.jsonl',
);

const COST_PER_ANALYSIS_USD = 0.01; // estimativa (gpt-4o-mini, imagem high detail)

interface ManifestEntry {
  id: string;
  symbol: string;
  interval: string;
  cutIndex: number;
  cutTime: number;
  cutTimeIso: string;
  file: string;
  lastClose: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const everyIdx = args.indexOf('--every');
  const promptFileIdx = args.indexOf('--prompt-file');
  return {
    limit: limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity,
    // --every N: processa 1 a cada N pendentes (subamostra estratificada barata)
    every: everyIdx >= 0 ? Math.max(1, Number(args[everyIdx + 1])) : 1,
    // --ground: injeta DADOS REAIS (candles do dataset local) no prompt —
    // espelha a melhoria proposta pro backend (ler número, não pixel)
    ground: args.includes('--ground'),
    // --prompt-file <caminho>: testa um prompt CANDIDATO sem tocar no oficial.
    // Entra como `override` no PromptBuilderService — o mesmo caminho que o
    // painel admin usa —, então o {{USER_CONTEXT}} e as instruções de
    // consistência/deep continuam sendo aplicados igual a produção.
    // Sem esta flag não dá pra rodar A/B: o runner só sabia resolver o prompt
    // ativo, e trocar o ativo para testar coloca o candidato em produção.
    promptFile: promptFileIdx >= 0 ? String(args[promptFileIdx + 1] || '') : null,
    yes: args.includes('--yes'),
  };
}

/**
 * Lê um prompt candidato de arquivo. Aceita .md/.txt (conteúdo cru) e .ts
 * (extrai o conteúdo do template literal, para apontar direto pro
 * trading-system-prompt-v9.ts sem precisar copiar e colar).
 */
function readPromptFile(file: string): string {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  if (!file.endsWith('.ts')) return raw.trim();
  const m = raw.match(/=\s*`([\s\S]*)`\s*;/);
  if (!m) {
    throw new Error(`Não achei um template literal em ${file} — aponte para um .md ou .txt.`);
  }
  return m[1].trim();
}

// ── Grounding: bloco de dados reais calculado dos candles já baixados ──────
const seriesCache = new Map<string, number[][]>();
function loadSeries(symbol: string, interval: string): number[][] {
  const key = `${symbol}_${interval}`;
  if (!seriesCache.has(key)) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(BACKTEST_DIR, 'data', `${key}.json`), 'utf8'),
    );
    seriesCache.set(key, raw.candles);
  }
  return seriesCache.get(key)!;
}

function groundingBlock(e: ManifestEntry): string {
  const candles = loadSeries(e.symbol, e.interval);
  const win = candles.slice(e.cutIndex - 120, e.cutIndex); // só o que está no gráfico
  // MESMA função que roda em produção (ai.adapter → buildRealDataBlock).
  // Antes havia uma cópia local aqui, que ficou defasada: sem volume, sem mapa
  // de volume e sem mapa de eventos. Medir com dados mais pobres do que os de
  // produção invalida a comparação — por isso agora é uma fonte só.
  // O dataset local traz volume em candles[i][5] (cripto tem; FX/metais vêm 0,
  // e nesse caso o bloco de volume some sozinho, exatamente como em produção).
  return buildRealDataBlock(e.symbol, e.interval, win) ?? '';
}

function loadDone(): Set<string> {
  // Conta como "feita" só análise SEM erro — linhas com erro são re-tentadas
  // na próxima execução (o avaliador usa a última linha de cada id).
  const done = new Set<string>();
  if (fs.existsSync(RESULTS)) {
    for (const line of fs.readFileSync(RESULTS, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (!rec.error) done.add(rec.id);
      } catch {
        /* linha corrompida (queda no meio do write) — será refeita */
      }
    }
  }
  return done;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`${question} [y/N] `, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase() === 'y');
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildOfficialPrompt(promptFile?: string | null): Promise<{ prompt: string; source: string }> {
  // Prompt CANDIDATO (--prompt-file): não toca no banco nem no prompt ativo.
  // Passa como override pelo mesmo builder de produção, então idioma,
  // consistência determinística e enriquecimento continuam idênticos.
  if (promptFile) {
    const stubDb: any = { promptConfig: { findFirst: async () => null, findUnique: async () => null } };
    const builder = new PromptBuilderService(stubDb);
    const prompt = await builder.buildPromptByVersion(
      'quick',
      undefined,
      readPromptFile(promptFile),
      'en',
    );
    return { prompt, source: `arquivo candidato (${path.basename(promptFile)}) — prompt oficial NÃO foi tocado` };
  }

  // Fidelidade máxima: se houver DATABASE_URL válido (env ou .env), resolve o
  // prompt ativo do banco (como produção). QUALQUER falha (credencial velha,
  // sem rede, etc.) cai no arquivo TRADING_SYSTEM_PROMPT — exatamente o
  // fallback que produção usa. Mesmo caminho do worker: injeta
  // OUTPUT LANGUAGE = English no {{USER_CONTEXT}}.
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const builder = new PromptBuilderService(prisma as any);
    const prompt = await builder.buildPromptByVersion('quick', undefined, undefined, 'en');
    await prisma.$disconnect().catch(() => {});
    return { prompt, source: 'database (PromptConfig ativo)' };
  } catch (err) {
    const msg = String((err as Error)?.message || err).split('\n').filter(Boolean)[0] || 'erro';
    console.warn(`Banco indisponível (${msg}) — usando o prompt do arquivo (mesmo fallback de produção).`);
  }
  const stub: any = { promptConfig: { findFirst: async () => null, findUnique: async () => null } };
  const builder = new PromptBuilderService(stub);
  const prompt = await builder.buildPromptByVersion('quick', undefined, undefined, 'en');
  return { prompt, source: 'file (TRADING_SYSTEM_PROMPT fallback)' };
}

async function main() {
  const { limit, every, ground, yes, promptFile } = parseArgs();

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY não está no ambiente. Rode: export OPENAI_API_KEY=... (a chave é sua, não sai do seu terminal).');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST)) {
    console.error(`manifest.json não encontrado em ${MANIFEST}. Rode antes as etapas A/B/render.`);
    process.exit(1);
  }

  const entries: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).entries;
  const done = loadDone();
  const pending = entries
    .filter((e) => !done.has(e.id))
    .filter((_, i) => i % every === 0)
    .slice(0, limit);
  if (ground) console.log('Grounding LIGADO: dados reais dos candles serão injetados no prompt.');

  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  console.log(`Amostras no manifest: ${entries.length} · já analisadas: ${done.size} · nesta rodada: ${pending.length}`);
  console.log(`Modelo: ${model} · custo estimado desta rodada: ~US$${(pending.length * COST_PER_ANALYSIS_USD).toFixed(2)}`);
  if (pending.length === 0) {
    console.log('Nada pendente. Pronto para a avaliação (Etapa D).');
    return;
  }
  if (!yes) {
    const ok = await confirm('Confirma disparar essas chamadas à OpenAI?');
    if (!ok) {
      console.log('Abortado. Nada foi chamado.');
      return;
    }
  }

  const { prompt, source } = await buildOfficialPrompt(promptFile);
  console.log(`Prompt oficial resolvido via: ${source} (${prompt.length} chars — não será gravado em nenhum arquivo)`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const adapter = new AIAdapter();

  let ok = 0;
  let failed = 0;
  const t0 = Date.now();

  for (const [n, entry] of pending.entries()) {
    const png = fs.readFileSync(path.join(BACKTEST_DIR, entry.file));
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

    let record: Record<string, unknown>;
    const started = Date.now();
    let attempt = 0;
    // até 4 tentativas p/ erros retriáveis (rate limit/timeout/5xx)
    for (;;) {
      attempt++;
      try {
        const effectivePrompt = ground ? `${prompt}\n\n${groundingBlock(entry)}` : prompt;
        const res = await adapter.analyzeImage(dataUrl, effectivePrompt, 'quick');
        const a: any = res.analysis || {};
        record = {
          id: entry.id,
          symbol: entry.symbol,
          interval: entry.interval,
          cutIndex: entry.cutIndex,
          cutTime: entry.cutTime,
          cutTimeIso: entry.cutTimeIso,
          lastClose: entry.lastClose,
          model,
          grounded: ground,
          durationMs: Date.now() - started,
          attempts: attempt,
          // decisão FINAL (pós-guards — o que o usuário veria)
          recommendation: res.recommendation,
          confidence: res.confidence,
          bias: res.bias,
          // recomendação crua do modelo (pré-guards), pra diagnóstico
          rawRecommendation: (res.rawResponse as any)?.recommendation ?? null,
          rawConfidence: (res.rawResponse as any)?.confidence ?? null,
          entry: a.entry ?? null,
          stopLoss: a.stopLoss ?? null,
          takeProfit1: a.takeProfit1 ?? null,
          takeProfit2: a.takeProfit2 ?? null,
          riskRewardTp1: a.riskRewardTp1 ?? null,
          riskRewardTp2: a.riskRewardTp2 ?? null,
          currentPriceRead: a.currentPrice ?? null,
          symbolRead: a.symbol ?? null,
          timeframeRead: a.timeframe ?? null,
          factorsPresent: a.factorsPresent ?? null,
          confluenceScore: a.confluenceScore ?? null,
          trendStrength: a.trendStrength ?? null,
          marketRegime: a.marketRegime ?? null,
          identifiedPatterns: a.identifiedPatterns ?? null,
          error: null,
        };
        ok++;
        break;
      } catch (err) {
        const retriable = err instanceof AIAnalysisError && err.retriable;
        if (retriable && attempt < 4) {
          const backoff = [2000, 8000, 20000][attempt - 1] ?? 20000;
          console.warn(`  retry ${attempt} em ${backoff / 1000}s (${(err as Error).message})`);
          await sleep(backoff);
          continue;
        }
        record = {
          id: entry.id,
          symbol: entry.symbol,
          interval: entry.interval,
          cutIndex: entry.cutIndex,
          cutTime: entry.cutTime,
          cutTimeIso: entry.cutTimeIso,
          lastClose: entry.lastClose,
          model,
          durationMs: Date.now() - started,
          attempts: attempt,
          error: err instanceof AIAnalysisError ? err.code : String((err as Error).message).slice(0, 200),
        };
        failed++;
        // billing = para tudo (produção já quebrou por crédito uma vez)
        if (err instanceof AIAnalysisError && err.code === 'openai_billing') {
          fs.appendFileSync(RESULTS, JSON.stringify(record) + '\n');
          console.error('\nERRO DE BILLING na OpenAI — parando. Confira o crédito e rode de novo (retoma de onde parou).');
          process.exit(2);
        }
        break;
      }
    }

    fs.appendFileSync(RESULTS, JSON.stringify(record) + '\n');
    const elapsed = (Date.now() - t0) / 1000;
    const rate = (n + 1) / elapsed;
    const etaMin = ((pending.length - n - 1) / rate) / 60;
    console.log(
      `[${n + 1}/${pending.length}] ${entry.id} → ${(record as any).recommendation ?? `ERRO:${(record as any).error}`} ` +
        `(conf ${(record as any).confidence ?? '-'}) · ETA ~${etaMin.toFixed(0)}min`,
    );
    await sleep(400); // respiro entre chamadas
  }

  console.log(`\nConcluído: ${ok} ok, ${failed} com erro, em ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  console.log(`Resultados: ${path.relative(process.cwd(), RESULTS)}`);
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
