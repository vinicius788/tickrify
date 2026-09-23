#!/usr/bin/env ts-node
/** Piloto isolado de análise. Dry-run por padrão; nunca consulta PromptConfig. */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../../..');
const BACKTEST = path.join(ROOT, 'scripts/backtest');
const RESULTS = path.join(BACKTEST, 'results');
const sha256 = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex');

type Mode = 'quick' | 'deep';
interface Case {
  id: string;
  symbol: string;
  interval: string;
  mode: Mode;
  chartFile: string;
  chartSha256: string;
  assetClass: string;
}
interface Options {
  promptFile: string;
  promptOrigin: 'active-snapshot' | 'versioned-reference';
  modelQuick: string;
  modelDeep: string;
  out: string;
  maxCalls: number;
  maxEstimatedUsd: number;
  reservePerCallUsd: number;
  execute: boolean;
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} deve ser inteiro positivo`);
  return parsed;
}

function positiveUsd(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} deve ser número positivo`);
  return parsed;
}

function parseArgs(args: string[]): Options {
  const pairs: Record<string, string> = {};
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') {
      if (execute) throw new Error('--execute repetido');
      execute = true;
      continue;
    }
    const key = args[i];
    if (!['--prompt-file', '--prompt-origin', '--model-quick', '--model-deep', '--out',
      '--max-calls', '--max-estimated-usd', '--reserve-per-call-usd'].includes(key) ||
        !args[i + 1] || pairs[key]) throw new Error(`Argumento inválido: ${key}`);
    pairs[key] = args[++i];
  }
  const required = ['--prompt-file', '--prompt-origin', '--model-quick', '--model-deep', '--out',
    '--max-calls', '--max-estimated-usd', '--reserve-per-call-usd'];
  for (const key of required) if (!pairs[key]) throw new Error(`Falta ${key}`);
  if (!['active-snapshot', 'versioned-reference'].includes(pairs['--prompt-origin'])) {
    throw new Error('--prompt-origin inválido');
  }
  for (const key of ['--model-quick', '--model-deep']) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(pairs[key])) throw new Error(`${key} inválido`);
  }
  const out = pairs['--out'];
  if (!/^[A-Za-z0-9._-]{1,80}\.jsonl$/.test(out)) throw new Error('--out deve ser nome .jsonl, sem caminho');
  const promptFile = path.resolve(pairs['--prompt-file']);
  if (!/\.(txt|md)$/i.test(promptFile)) throw new Error('Prompt deve ser arquivo .txt ou .md local');
  return {
    promptFile,
    promptOrigin: pairs['--prompt-origin'] as Options['promptOrigin'],
    modelQuick: pairs['--model-quick'],
    modelDeep: pairs['--model-deep'],
    out,
    maxCalls: positiveInt(pairs['--max-calls'], '--max-calls'),
    maxEstimatedUsd: positiveUsd(pairs['--max-estimated-usd'], '--max-estimated-usd'),
    reservePerCallUsd: positiveUsd(pairs['--reserve-per-call-usd'], '--reserve-per-call-usd'),
    execute,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const preflight = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/analysis-pilot-preflight.mjs')], {
    encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' },
  }));
  const manifestBytes = fs.readFileSync(path.join(BACKTEST, 'pilot-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { cases: Case[] };
  if (preflight.manifestSha256 !== sha256(manifestBytes)) throw new Error('Manifesto mudou após preflight');
  const prompt = fs.readFileSync(opts.promptFile, 'utf8').trim();
  if (prompt.length < 1000) throw new Error('Prompt local vazio ou incompleto');
  const promptSha256 = sha256(prompt);
  const output = path.join(RESULTS, opts.out);
  if (fs.existsSync(output) || fs.existsSync(`${output}.meta.json`)) {
    throw new Error('Saída já existe; cada rodada usa nome novo para não misturar versões');
  }
  const selected = manifest.cases.slice(0, opts.maxCalls);
  const plan = {
    mode: opts.execute ? 'execute' : 'dry-run',
    inputCases: manifest.cases.length,
    selectedCases: selected.length,
    selectedByMode: {
      quick: selected.filter((c) => c.mode === 'quick').length,
      deep: selected.filter((c) => c.mode === 'deep').length,
    },
    manifestSha256: preflight.manifestSha256,
    promptSha256,
    promptOrigin: opts.promptOrigin,
    modelQuick: opts.modelQuick,
    modelDeep: opts.modelDeep,
    maxCalls: opts.maxCalls,
    maxEstimatedUsd: opts.maxEstimatedUsd,
    reservePerCallUsd: opts.reservePerCallUsd,
    flags: { quickGrounding: false, marketEnrichment: false, newsGuard: false, rrGuard: true },
    limitation: 'USD is a local estimate, not a hard provider spending cap; the per-call reserve must be reviewed before execution.',
  };
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  if (!opts.execute) return;

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente');
  if (opts.maxCalls > manifest.cases.length) throw new Error('max-calls excede os casos do manifesto');
  if (opts.reservePerCallUsd > opts.maxEstimatedUsd) throw new Error('Reserva por chamada excede teto estimado');
  // Os gráficos são históricos. Impede vazamento de calendário/dados de hoje,
  // chamadas auxiliares e dumps de resposta definidos no ambiente do operador.
  process.env.ENABLE_QUICK_GROUNDING = 'false';
  process.env.ENABLE_MARKET_ENRICHMENT = 'false';
  process.env.ENABLE_NEWS_GUARD = 'false';
  process.env.ENABLE_RR_GUARD = 'true';
  process.env.AI_MODEL_QUICK = opts.modelQuick;
  process.env.AI_MODEL_DEEP = opts.modelDeep;
  delete process.env.AI_DEBUG_DUMP_RAW;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Dynamic require após fixar as flags; nenhum Prisma é instanciado.
  const OpenAI = require('openai').default;
  const { AIAdapter, AIAnalysisError } = require('../src/modules/ai/ai.adapter');
  const { PromptBuilderService } = require('../src/modules/prompt/prompt-builder.service');
  const { computeCost, extractUsage } = require('../src/modules/ai/model-cost');
  const adapter = new AIAdapter();
  const sdk = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const originalCreate = sdk.chat.completions.create.bind(sdk.chat.completions);
  let calls = 0;
  let callUsage: Array<{ model: string; usage: unknown }> = [];
  (sdk.chat.completions as any).create = async (...args: unknown[]) => {
    if (calls >= opts.maxCalls) throw new Error('Teto de chamadas atingido');
    calls++;
    const response = await originalCreate(...(args as [any, any]));
    callUsage.push({ model: response.model, usage: response.usage });
    return response;
  };
  (adapter as any).openai = sdk;
  const builder = new PromptBuilderService({ promptConfig: {
    findFirst: async () => { throw new Error('Acesso ao banco proibido neste piloto'); },
    findUnique: async () => { throw new Error('Acesso ao banco proibido neste piloto'); },
  } });
  const prompts: Record<Mode, string> = {
    quick: await builder.buildPromptByVersion('quick', undefined, prompt, 'en'),
    deep: await builder.buildPromptByVersion('deep', undefined, prompt, 'en'),
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(`${output}.meta.json`, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(output, '', { flag: 'wx', mode: 0o600 });
  let estimatedUsd = 0;
  for (const c of selected) {
    if (calls >= opts.maxCalls || estimatedUsd + opts.reservePerCallUsd > opts.maxEstimatedUsd) break;
    const chart = fs.readFileSync(path.join(BACKTEST, c.chartFile));
    if (sha256(chart) !== c.chartSha256) throw new Error(`Gráfico alterado após preflight: ${c.id}`);
    const before = calls;
    callUsage = [];
    const started = Date.now();
    let record: Record<string, unknown>;
    try {
      const response = await adapter.analyzeImage(`data:image/png;base64,${chart.toString('base64')}`, prompts[c.mode], c.mode);
      record = {
        id: c.id, symbol: c.symbol, interval: c.interval, assetClass: c.assetClass,
        analysisType: c.mode, chartSha256: c.chartSha256, promptSha256,
        model: c.mode === 'quick' ? opts.modelQuick : opts.modelDeep,
        recommendation: response.recommendation,
        rawRecommendation: response.rawResponse?.recommendation ?? null,
        confidence: response.confidence, bias: response.bias,
        analysis: response.analysis,
        entry: response.analysis?.entry ?? null,
        stopLoss: response.analysis?.stopLoss ?? null,
        takeProfit1: response.analysis?.takeProfit1 ?? null,
        takeProfit2: response.analysis?.takeProfit2 ?? null,
        error: null,
      };
    } catch (error) {
      record = {
        id: c.id, symbol: c.symbol, interval: c.interval, assetClass: c.assetClass,
        analysisType: c.mode, chartSha256: c.chartSha256, promptSha256,
        model: c.mode === 'quick' ? opts.modelQuick : opts.modelDeep,
        error: error instanceof AIAnalysisError ? String((error as { code: unknown }).code) : 'unclassified',
      };
    }
    const caseCost = callUsage.reduce((sum, item) => {
      const usage = extractUsage(item.usage);
      if (!item.usage || usage.totalTokens <= 0) return NaN;
      const cost = computeCost(item.model, usage, c.mode === 'deep' ? 3 : 1).costUsd;
      return cost == null ? NaN : sum + cost;
    }, callUsage.length ? 0 : NaN);
    if (Number.isFinite(caseCost)) estimatedUsd += caseCost;
    record.durationMs = Date.now() - started;
    record.requests = calls - before;
    record.usage = callUsage.map((item) => ({ model: item.model, ...extractUsage(item.usage) }));
    record.estimatedCostUsd = Number.isFinite(caseCost) ? caseCost : null;
    fs.appendFileSync(output, JSON.stringify(record) + '\n');
    process.stdout.write(`${c.id}: ${record.error || record.recommendation} · chamadas ${calls}/${opts.maxCalls} · estimativa US$${estimatedUsd.toFixed(4)}\n`);
    // Uma falha pode ser cobrada sem usage; não avançar com custo desconhecido.
    if (calls - before !== 1 || !Number.isFinite(caseCost) || record.error) break;
  }
  process.stdout.write(`Encerrado: ${calls} chamadas, estimativa local US$${estimatedUsd.toFixed(4)}. Resultados: ${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Erro inesperado'}\n`);
  process.exitCode = 1;
});
