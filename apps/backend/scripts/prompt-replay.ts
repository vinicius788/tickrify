#!/usr/bin/env ts-node
/**
 * Replay de prints REAIS de producao com o prompt atual (controle) e com o
 * candidato, medidos pela MESMA regua do sweeper (TP1 x SL em 48h, 30m).
 *
 * Por que existe (13/10/2026): o backtest-runner usa graficos desenhados no
 * matplotlib; aqui o teste roda nos prints que os usuarios mandaram, contra o
 * que o mercado fez depois. O candidato atual e o v7.6 (TP1 mais perto):
 * no v12, TP1 >= 2R acertou 20% (n=77, -0,27R) e TP1 < 1,5R acertou 61% (n=46).
 *
 * Uso (em apps/backend, com o .env de producao para ler os prints):
 *   pnpm exec ts-node scripts/prompt-replay.ts --input ../../_local/replay-input.json
 *   pnpm exec ts-node scripts/prompt-replay.ts --input ../../_local/replay-input.json --execute
 * Sem --execute so conta casos e custo. Retomavel: pula o que ja rodou.
 * O prompt nunca e gravado; so as respostas resumidas.
 */
// Mesmas condicoes nos dois bracos: sem grounding ao vivo (o print e antigo e
// a guarda de print velho reteria os candles de qualquer jeito) e sem news
// guard (o calendario de HOJE nao vale para um grafico antigo).
process.env.ENABLE_QUICK_GROUNDING = 'false';
process.env.ENABLE_NEWS_GUARD = 'false';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { AIAdapter } from '../src/modules/ai/ai.adapter';
import { PromptBuilderService } from '../src/modules/prompt/prompt-builder.service';
import { TRADING_SYSTEM_PROMPT } from '../src/common/prompts/trading-system-prompt';
import { canonicalFxPair } from '../src/common/utils/analysis-normalizer';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';
import {
  Candle,
  TradePlan,
  evaluateTrade,
  fetchCryptoWindow,
  fetchFxWindow,
} from '../worker/outcome.sweeper';

const COST_PER_CALL_USD = 0.0195; // quick medido em 09/09 (CLAUDE.md 3.2)
const WINDOW_MS = 48 * 60 * 60 * 1000;
const OUT = path.resolve(__dirname, '../../../scripts/backtest/results/prompt-replay.jsonl');

const TP1_LINE = 'SL: always beyond structural level or OB/FVG. Min R:R 1:1.5. Target 1:2+.';
const TP1_PATCH = [
  'SL: always beyond structural level or OB/FVG.',
  'TARGET PLACEMENT: takeProfit1 is the FIRST realistic objective, the nearest opposing liquidity or structure level that price can plausibly reach within the next ~20-30 candles of this timeframe, typically 1.0 to 1.5 times the risk. Never push takeProfit1 further away to improve the ratio: measured on real outcomes, a takeProfit1 set at 2R or more was reached only about 20% of the time. Put the extended objective (2R or more) in takeProfit2. The R:R >= 1.5 requirement (checklist item 6) is measured to takeProfit2, never to takeProfit1.',
].join('\n');

interface InputRow {
  id: string;
  createdAt: string;
  imageUrl: string;
  symbol: string;
}
type Arm = 'control' | 'v76';
interface Done {
  id: string;
  arm: Arm;
  symbol: string;
  cls: 'crypto' | 'metal' | 'forex';
  recommendation: string;
  outcome: string;
  rrTp1: number | null;
  error?: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function classOf(symbol: string): Done['cls'] | null {
  if (normalizeToBinancePerp(symbol).isCrypto) return 'crypto';
  const pair = canonicalFxPair(symbol);
  if (!pair) return null;
  return pair.startsWith('XAU') || pair.startsWith('XAG') ? 'metal' : 'forex';
}

async function buildPrompt(arm: Arm): Promise<string> {
  if (!TRADING_SYSTEM_PROMPT.includes(TP1_LINE)) {
    throw new Error('A linha do TP1 mudou no prompt; revise TP1_LINE antes de medir.');
  }
  const source = arm === 'v76' ? TRADING_SYSTEM_PROMPT.replace(TP1_LINE, TP1_PATCH) : TRADING_SYSTEM_PROMPT;
  const stubDb: any = { promptConfig: { findFirst: async () => null, findUnique: async () => null } };
  return new PromptBuilderService(stubDb).buildPromptByVersion('quick', undefined, source, 'en');
}

const candleCache = new Map<string, Candle[] | null>();
async function windowFor(row: InputRow, cls: Done['cls']): Promise<Candle[] | null> {
  if (candleCache.has(row.id)) return candleCache.get(row.id) ?? null;
  // O Supabase exporta "2026-10-01 10:00:00.123" sem fuso; a coluna e UTC.
  const raw = row.createdAt.trim().replace(' ', 'T');
  const start = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(raw) ? raw : `${raw}Z`);
  const { base } = normalizeToBinancePerp(row.symbol);
  let candles: Candle[] | null;
  if (cls === 'crypto' && base) {
    candles = await fetchCryptoWindow(base, start, start + WINDOW_MS);
  } else {
    // Twelve Data gratis: 8 creditos por minuto.
    await new Promise((r) => setTimeout(r, 8_000));
    candles = await fetchFxWindow(row.symbol, start, start + WINDOW_MS);
  }
  candleCache.set(row.id, candles);
  return candles;
}

function measure(rec: string, analysis: any, window: Candle[] | null): { outcome: string; rrTp1: number | null } {
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const rrTp1 = num(analysis?.riskRewardTp1);
  if (rec !== 'BUY' && rec !== 'SELL') return { outcome: 'WAIT', rrTp1: null };
  const entry = num(analysis?.entry);
  const stopLoss = num(analysis?.stopLoss);
  const takeProfit1 = num(analysis?.takeProfit1);
  if (entry == null || stopLoss == null || takeProfit1 == null) return { outcome: 'INCOMPLETE', rrTp1 };
  if (!window) return { outcome: 'UNTRACKABLE', rrTp1 };
  const plan: TradePlan = {
    recommendation: rec, symbol: String(analysis?.symbol || ''), entry, stopLoss, takeProfit1,
    takeProfit2: num(analysis?.takeProfit2),
  };
  return { outcome: evaluateTrade(plan, window).outcome, rrTp1 };
}

function summarize(rows: Done[]): void {
  const groups: Array<[string, (d: Done) => boolean]> = [
    ['todas', () => true], ['crypto', (d) => d.cls === 'crypto'], ['metal', (d) => d.cls === 'metal'], ['forex', (d) => d.cls === 'forex'],
  ];
  for (const [label, keep] of groups) {
    for (const arm of ['control', 'v76'] as Arm[]) {
      const r = rows.filter((d) => d.arm === arm && !d.error && keep(d));
      if (r.length === 0) continue;
      const count = (o: string) => r.filter((d) => d.outcome === o).length;
      const w = count('WIN'); const l = count('LOSS');
      const scored = r.filter((d) => (d.outcome === 'WIN' && d.rrTp1 != null) || d.outcome === 'LOSS');
      const exp = scored.length ? scored.reduce((s, d) => s + (d.outcome === 'WIN' ? (d.rrTp1 as number) : -1), 0) / scored.length : null;
      console.log(
        `${label.padEnd(6)} ${arm.padEnd(7)} n=${r.length} WAIT=${((100 * count('WAIT')) / r.length).toFixed(0)}% ` +
        `WIN=${w} LOSS=${l} NO_FILL=${count('NO_FILL')} TIMEOUT=${count('TIMEOUT')} ` +
        `acerto=${w + l ? ((100 * w) / (w + l)).toFixed(1) : '-'}% expectancy=${exp == null ? '-' : exp.toFixed(3)}R`,
      );
    }
  }
  console.log('\nRegra fixada antes de medir: o v7.6 sobe so se a expectancy de "todas" melhorar, com WIN+LOSS >= 30 nos dois bracos, e o WAIT do v7.6 ficar em no maximo 55%.');
}

async function main() {
  const input = arg('--input');
  if (!input) throw new Error('Passe --input <arquivo JSON exportado do Supabase>');
  const rows = (JSON.parse(fs.readFileSync(input, 'utf8')) as InputRow[]).filter((r) => r.id && r.imageUrl && r.createdAt);
  const cases = rows.map((r) => ({ row: r, cls: classOf(r.symbol) })).filter((c): c is { row: InputRow; cls: Done['cls'] } => c.cls !== null);

  const done: Done[] = fs.existsSync(OUT)
    ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const doneKeys = new Set(done.filter((d) => !d.error).map((d) => `${d.id}:${d.arm}`));
  const todo = cases.flatMap((c) => (['control', 'v76'] as Arm[]).map((arm) => ({ ...c, arm }))).filter((t) => !doneKeys.has(`${t.row.id}:${t.arm}`));

  console.log(`Casos mediveis: ${cases.length} de ${rows.length}. Chamadas a fazer: ${todo.length}. Custo estimado: US$ ${(todo.length * COST_PER_CALL_USD).toFixed(2)}.`);
  if (!process.argv.includes('--execute')) {
    if (done.length) summarize(done);
    console.log('\nDry-run. Para rodar de verdade, repita com --execute.');
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ok = await new Promise<string>((r) => rl.question('Confirmar o gasto? (digite sim) ', r));
  rl.close();
  if (ok.trim().toLowerCase() !== 'sim') return;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const prompts: Record<Arm, string> = { control: await buildPrompt('control'), v76: await buildPrompt('v76') };
  const adapter = new AIAdapter();
  let i = 0;
  for (const t of todo) {
    i += 1;
    let record: Done;
    try {
      const res: any = await adapter.analyzeImage(t.row.imageUrl, prompts[t.arm], 'quick');
      const window = await windowFor(t.row, t.cls);
      const m = measure(String(res.recommendation), res.analysis, window);
      record = { id: t.row.id, arm: t.arm, symbol: t.row.symbol, cls: t.cls, recommendation: String(res.recommendation), ...m };
    } catch (err) {
      record = {
        id: t.row.id, arm: t.arm, symbol: t.row.symbol, cls: t.cls, recommendation: 'ERROR', outcome: 'ERROR', rrTp1: null,
        error: err instanceof Error ? err.message.slice(0, 200) : 'erro',
      };
    }
    fs.appendFileSync(OUT, `${JSON.stringify(record)}\n`);
    done.push(record);
    console.log(`[${i}/${todo.length}] ${t.arm} ${t.row.symbol} -> ${record.recommendation} ${record.outcome}${record.error ? ` (${record.error})` : ''}`);
  }
  console.log('');
  summarize(done);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
