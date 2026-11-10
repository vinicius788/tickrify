/**
 * Continuacao do setup (09/11/2026, chave ENABLE_SETUP_CONTINUATION, desligada
 * por padrao). Quando o trader reanalisa um setup cujo WATCH ainda vale, o
 * modelo recebe o plano anterior DEPOIS da parte fixa do prompt, le o grafico
 * de novo e diz o que aconteceu com o plano.
 *
 * Regras que nao se dobram:
 * - So campos fechados e numeros. O unico texto e o `trigger` do watchPlan,
 *   escrito pelo modelo (nunca pelo usuario), cortado e sem quebra de linha.
 * - O status vem de uma ultima linha do `executiveSummary` (ultimo campo gerado,
 *   depois do checklist) e sai do texto antes de qualquer decisao: o validador
 *   e a tela nunca veem a linha.
 * - Prompt base, schema, validador e ENGINE_RULES nao mudam. Sem plano valido,
 *   o prompt fica byte a byte igual.
 *
 * Arquivo proprio: worker, caminho sincrono e adapter usam a mesma regra.
 */
import type { PrismaClient } from '@prisma/client';
import { flagBool } from '../../common/flags/feature-flags';
import { canonicalFxPair, normalizeSymbol } from '../../common/utils/analysis-normalizer';
import { nearEdge, type WatchPlan } from '../../common/utils/plan-engine';
import { readPlan } from './setups.service';
import { storedWatchPlan, watchSummaryOf } from './watch-pending';

export const SETUP_CONTINUATION_FLAG = 'ENABLE_SETUP_CONTINUATION';
export const CONTINUATION_STATUSES = ['CONFIRMED', 'STILL_WAITING', 'CHANGED', 'INVALIDATED'] as const;
export type ContinuationStatus = (typeof CONTINUATION_STATUSES)[number];

const MAX_TRIGGER_CHARS = 200;
const STATUS_LINE = /^[^\S\n]*[*_`]*PRIOR_PLAN_STATUS[*_`]*\s*[:=]\s*[*_`]*([A-Z_ ]+?)[*_`.]*[^\S\n]*$/gim;

export interface PriorPlan {
  setupId: string;
  priorAnalysisId: string;
  symbol: string;
  createdAt: Date;
  plan: WatchPlan;
  alert: { level: number; triggeredAt: Date } | null;
}

export interface SetupContinuation {
  setupId: string;
  priorAnalysisId: string;
  status: ContinuationStatus | null;
  direction: WatchPlan['direction'];
  level: number;
}

const assetKey = (symbol: unknown): string => {
  const normalized = normalizeSymbol(symbol).toUpperCase();
  return canonicalFxPair(normalized) ?? normalized.replace(/[^A-Z0-9]/g, '').replace(/(USDT|USDC)P?$/, 'USD');
};

/** Mesmo ativo? Sufixo de corretora e USDT/USDC nao separam; simbolo vazio nunca bate. */
export function sameAsset(a: unknown, b: unknown): boolean {
  const left = assetKey(a);
  return Boolean(left) && left !== 'N/A' && left !== 'NA' && left === assetKey(b);
}

/**
 * O plano anterior do setup, se ele terminou em WATCH e ainda vale. Sem chave,
 * sem plano ou com o banco fora: null, e a analise segue como sempre. O ativo so
 * e conferido no adapter, que le o simbolo do grafico novo.
 */
export async function loadPriorPlan(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  input: { analysisId: string; userId: string; setupId: string | null | undefined },
  log: (message: string) => void = () => undefined,
  now: Date = new Date(),
): Promise<PriorPlan | null> {
  const { analysisId, userId, setupId } = input;
  if (!setupId || !flagBool(SETUP_CONTINUATION_FLAG)) return null;
  try {
    const [prior] = await prisma.$queryRaw<
      Array<{ id: string; createdAt: Date; recommendation: string | null; result: unknown; groundingInterval: string | null }>
    >`
      SELECT "id", "createdAt", "recommendation", "result", "groundingStats"->>'interval' AS "groundingInterval"
      FROM "tickrify"."Analysis"
      WHERE "setupId" = ${setupId} AND "userId" = ${userId} AND "status" = 'completed' AND "id" <> ${analysisId}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
    `;
    if (!prior) return null;
    const plan = storedWatchPlan(prior.result, prior.recommendation);
    const symbol = readPlan(prior.result, prior.recommendation).symbol;
    if (!plan || !symbol) return null;
    const watch = watchSummaryOf(prior.result, prior.recommendation, prior.createdAt, {
      groundingInterval: prior.groundingInterval, setupId, track: null,
    });
    if (!watch?.expiresAt || Date.parse(watch.expiresAt) <= now.getTime()) return null;
    const [alert] = await prisma.$queryRaw<Array<{ level: number; triggeredAt: Date }>>`
      SELECT "level", "triggeredAt" FROM "tickrify"."SetupAlert"
      WHERE "setupId" = ${setupId} AND "userId" = ${userId} AND "analysisId" = ${prior.id}
        AND "status" = 'triggered' AND "triggeredAt" IS NOT NULL
      ORDER BY "triggeredAt" DESC
      LIMIT 1
    `;
    const level = Number(alert?.level);
    return {
      setupId,
      priorAnalysisId: prior.id,
      symbol,
      createdAt: prior.createdAt,
      plan,
      alert: alert && Number.isFinite(level) ? { level, triggeredAt: alert.triggeredAt } : null,
    };
  } catch (error) {
    log(`[continuation] Plano anterior nao lido (${analysisId}): ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** O gatilho numa linha so, sem nada que feche o <user_context>. */
const cleanTrigger = (trigger: string) => trigger.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim().slice(0, MAX_TRIGGER_CHARS).trim();

export function buildPriorPlanBlock(prior: PriorPlan): string {
  const { plan, alert } = prior;
  const lines = [
    '# PRIOR PLAN (your earlier read of this same setup; context only, never a reason to enter)',
    `Earlier analysis: ${utc(prior.createdAt)}`,
    'Earlier state: WATCH',
    `Direction: ${plan.direction.toUpperCase()}`,
    `Entry zone: ${plan.zoneLow} to ${plan.zoneHigh}`,
    `Invalidation: ${plan.invalidation}`,
    `Targets: ${plan.target2 === null ? plan.target1 : `${plan.target1}, ${plan.target2}`}`,
  ];
  if (alert) lines.push(`Alert reached: ${alert.level} at ${utc(alert.triggeredAt)}`);
  const trigger = cleanTrigger(plan.trigger);
  if (trigger) lines.push(`Earlier trigger: ${trigger}`);
  lines.push(
    '',
    'First read the current chart on its own, as if this plan did not exist. Then compare that read with the plan and classify the plan as exactly one of:',
    'CONFIRMED: price is in the zone and the trigger is present.',
    'STILL_WAITING: price has not reached the zone, or the trigger is not present yet.',
    'CHANGED: the structure changed. Say what changed in one sentence.',
    'INVALIDATED: price went beyond the invalidation, or the plan no longer applies.',
    'The checks C1 to C7 and the state follow the same rules as always. The earlier plan is never a reason to enter or to pass a check.',
    'End "analysis.executiveSummary" with a final line that contains only: PRIOR_PLAN_STATUS: followed by one of the four words above.',
  );
  return lines.join('\n');
}

/**
 * Le o status do texto do modelo e tira a linha. Sem status reconhecivel: null,
 * nunca erro. Com mais de uma linha, vale a ultima.
 */
export function readContinuationStatus(text: unknown): { status: ContinuationStatus | null; text: unknown } {
  if (typeof text !== 'string') return { status: null, text };
  let status: ContinuationStatus | null = null;
  const cleaned = text.replace(STATUS_LINE, (_line, value: string) => {
    const word = value.trim().toUpperCase().replace(/\s+/g, '_');
    status = CONTINUATION_STATUSES.find((s) => s === word) ?? status;
    return '';
  });
  return { status, text: cleaned.trimEnd() };
}

export function continuationOf(prior: PriorPlan, status: ContinuationStatus | null): SetupContinuation {
  return {
    setupId: prior.setupId,
    priorAnalysisId: prior.priorAnalysisId,
    status,
    direction: prior.plan.direction,
    level: nearEdge(prior.plan),
  };
}
