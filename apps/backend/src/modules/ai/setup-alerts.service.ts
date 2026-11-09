import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { getFreeQuota, type FreeQuotaCounter } from '../../common/free-quota';
import { INTERVAL_MS, candleSourceFor, fetchCrypto1m, fetchFxLatest5m, priceSymbolOf, type Candle, type CandleInterval, type CandleSource } from '../market/candles';
import { TwelveDataUnavailableError, fxMarketClosed, monitorFxIntervals, twelveDataUsage } from '../market/twelve-data';
import { extractShadowPlan } from '../../../worker/outcome.sweeper';
import { UNSUBSCRIBE_AUDIT_ACTION } from '../mail/lifecycle-email';
import { SetupsService, findSetupOfAnalysis, followInTransaction, lockSetups, readPlan } from './setups.service';
import { loadWatchContexts, storedWatchPlan, watchSummaryOf, type WatchSummary } from './watch-pending';

/**
 * Alertas de nivel dos setups acompanhados (27/10/2026, fase 1 da sessao diaria).
 *
 * Por que existe: de quem analisa, so 16% volta em outro dia; no trial, 76
 * usaram no dia 1 e 16 no dia 2. O setup acompanhado ja guardava o caminho de
 * volta, mas nada chamava o trader quando o preco chegava no nivel. Aqui o
 * Tickrify vigia o nivel em candles reais (1m em cripto, 5m em forex e ouro) e,
 * quando ele e tocado, marca o alerta como disparado (o e-mail sai por
 * setup-alert-email.ts, na mesma volta).
 *
 * Regras que nao se dobram:
 * - Alerta e de um setup (TrackedSetup): criar segue o setup se preciso.
 * - Disparo = maxima/minima de um candle que ABRIU depois da criacao (ou da
 *   volta de uma pausa) cruzou o nivel. Candle anterior nao conta.
 * - Ativo sem fonte de preco nao tem alerta. Nunca se inventa preco.
 * - Disparo por UPDATE condicional (status 'active' -> 'triggered'): duas
 *   instancias no Render nunca disparam duas vezes. Cada ativo e buscado por
 *   uma instancia so (claim em AlertPriceCheck), o que tambem e o cache.
 * - Conta travada (gratis esgotado, ex-assinante): os alertas ficam pausados
 *   (nada e apagado); o monitor so empurra o `watchFrom` para frente, entao
 *   voltar a assinar nao dispara pelo que aconteceu durante a pausa.
 * - O motor nunca le nada daqui. Tudo por SQL (fora do schema.prisma, ver a
 *   migracao 20261027120000_setup_alert).
 */
export const ALERT_LABELS = ['entry', 'stop', 'tp1', 'invalidation', 'custom'] as const;
export type AlertLabel = (typeof ALERT_LABELS)[number];
export type AlertSide = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered' | 'cancelled';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Todas as regras dos alertas num lugar so. Conferidas no SERVIDOR. */
export const ALERT_RULES = {
  maxActivePerSetup: 3,
  /** Setups com ao menos 1 alerta ativo, por pessoa. */
  maxSetupsWithAlerts: { free: 2, subscriber: 10 },
  /** A volta e de 1 min; forex/metal so buscam quando o intervalo do orcamento vence. */
  monitorIntervalMs: MINUTE,
  candleInterval: { crypto: '1m', fx: '5m' } as Record<CandleSource, CandleInterval>,
  /** Cache por ativo para todas as contas (Twelve Data tem cota diaria). */
  cacheTtlMs: { crypto: MINUTE, fx: 10 * MINUTE } as Record<CandleSource, number>,
  /** Sem disparo novo, de quanto em quanto o e-mail tenta de novo o que a Resend recusou. */
  emailRetryMs: 10 * MINUTE,
  /** A trava da conta sao varias consultas: nao refazer a cada minuto, por pessoa. */
  pauseCheckTtlMs: 5 * MINUTE,
  /**
   * Forex/metais buscados por volta. O Twelve Data gratis aceita 8 pedidos por
   * minuto (o grounding da analise usa a mesma chave): o que passar fica para a
   * proxima volta, na ordem de quem foi checado ha mais tempo.
   */
  maxFxSymbolsPerRun: 5,
  /** Janela maxima de candles por busca (worker parado por algumas horas). */
  lookbackMs: 8 * HOUR,
  /** Disparados que a lista ainda mostra. */
  triggeredVisibleMs: 7 * 24 * HOUR,
  triggeredVisibleOnSetupMs: 30 * 24 * HOUR,
  /** Depois de concluir um WATCH, quanto a tela espera o alerta automatico aparecer. */
  watchAutoPendingMs: 15 * 1000,
} as const;

/** Secao "Watching" do My Trades e do Diario. */
export const WATCHING_RULES = {
  lookbackMs: 21 * 24 * HOUR,
  /** WATCH encerrado continua na secao por este tempo. */
  closedVisibleMs: 7 * 24 * HOUR,
  /** Preco mais velho que isto nao vira "distancia atual" (fora do fim de semana do forex). */
  priceFreshMs: 2 * HOUR,
  maxItems: 20,
} as const;

/** Nivel fora desta faixa do preco da analise e erro de digitacao (mesma regua do validador). */
const LEVEL_BAND = { min: 0.5, max: 2 };
// Um pouco antes do TTL: as voltas de 1 min caem sempre do lado de fora.
const CLAIM_SLACK_MS = 10 * 1000;

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."SetupAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "priceSymbol" TEXT NOT NULL,
    "level" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "referencePrice" DOUBLE PRECISION NOT NULL,
    "prefilled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredAt" TIMESTAMP(3),
    "triggerPrice" DOUBLE PRECISION,
    "emailedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "SetupAlert_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SetupAlert_label_check" CHECK ("label" IN ('entry', 'stop', 'tp1', 'invalidation', 'custom')),
    CONSTRAINT "SetupAlert_side_check" CHECK ("side" IN ('above', 'below')),
    CONSTRAINT "SetupAlert_status_check" CHECK ("status" IN ('active', 'triggered', 'cancelled')),
    CONSTRAINT "SetupAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetupAlert_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "tickrify"."TrackedSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `ALTER TABLE "tickrify"."SetupAlert" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "SetupAlert_status_priceSymbol_idx" ON "tickrify"."SetupAlert"("status", "priceSymbol")`,
  `CREATE INDEX IF NOT EXISTS "SetupAlert_userId_status_idx" ON "tickrify"."SetupAlert"("userId", "status")`,
  `CREATE INDEX IF NOT EXISTS "SetupAlert_setupId_idx" ON "tickrify"."SetupAlert"("setupId")`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."AlertPriceCheck" (
    "symbol" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "lastPrice" DOUBLE PRECISION,
    "lastCandleAt" TIMESTAMP(3),
    CONSTRAINT "AlertPriceCheck_pkey" PRIMARY KEY ("symbol")
  )`,
  `ALTER TABLE "tickrify"."AlertPriceCheck" ADD COLUMN IF NOT EXISTS "intervalMs" INTEGER`,
];

export type AlertSuggestion = { label: Exclude<AlertLabel, 'custom'>; level: number };

export type AlertView = {
  id: string;
  setupId: string;
  analysisId: string;
  symbol: string;
  timeframe: string | null;
  level: number;
  label: AlertLabel;
  side: AlertSide;
  status: AlertStatus;
  createdAt: Date;
  triggeredAt: Date | null;
  triggerPrice: number | null;
  seenAt: Date | null;
  /** Ultimo preco checado do ativo (o mesmo para todas as contas) e quando. */
  lastPrice: number | null;
  checkedAt: Date | null;
  /** De quanto em quanto o ativo e checado agora; null = ainda nao se sabe ou mercado fechado. */
  checkIntervalMs: number | null;
  marketClosed: boolean;
};

type AlertRow = Omit<AlertView, 'timeframe' | 'lastPrice' | 'checkedAt' | 'checkIntervalMs' | 'marketClosed'> & {
  userId: string;
  priceSymbol: string;
  timeframe?: string | null;
  lastPrice?: number | null;
  checkedAt?: Date | null;
  intervalMs?: number | null;
};

/** O que a tela alega sobre a checagem: o intervalo em vigor, nunca um numero fixo. */
function checkCadence(priceSymbol: string, storedMs: number | null | undefined, now = new Date()): { checkIntervalMs: number | null; marketClosed: boolean } {
  const source = candleSourceFor(priceSymbol);
  if (source === 'crypto') return { checkIntervalMs: ALERT_RULES.monitorIntervalMs, marketClosed: false };
  if (source === 'fx' && fxMarketClosed(now)) return { checkIntervalMs: null, marketClosed: true };
  return { checkIntervalMs: storedMs == null ? null : Number(storedMs), marketClosed: false };
}

type RawPrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const positive = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Niveis que a tela oferece ja preenchidos. BUY/SELL: entrada, stop e TP1 do
 * plano. WATCH: o nivel do plano (rotulo entry) e a invalidacao dele. WAIT: o
 * modelo quase nunca manda nivel (em 20/10, 13 de 187), entao vale a
 * invalidacao ou os niveis que o codigo guardou ao rebaixar (shadow).
 * Sem nenhum, a pessoa digita.
 */
export function alertSuggestions(result: unknown, recommendation: string | null, timing?: Pick<AnalysisRow, 'createdAt' | 'groundingInterval'>): AlertSuggestion[] {
  const plan = readPlan(result, recommendation);
  const analysis = record(record(result).analysis);
  const out: AlertSuggestion[] = [];
  const push = (label: AlertSuggestion['label'], level: number | null) => {
    if (level != null && !out.some((s) => s.label === label)) out.push({ label, level });
  };
  if (plan.recommendation === 'BUY' || plan.recommendation === 'SELL') {
    push('entry', plan.entry);
    push('stop', plan.stopLoss);
    push('tp1', plan.takeProfit1);
    push('invalidation', positive(analysis.invalidationLevel));
  } else {
    // WATCH (03/11/2026): o nivel que destrava a entrada e a invalidacao do plano.
    if (plan.signalState === 'WATCH' && record(result).watchPlan) {
      const watch = timing && watchSummaryOf(result, recommendation, timing.createdAt, {
        groundingInterval: timing.groundingInterval, setupId: null, track: null,
      });
      if (!watch?.expiresAt || Date.parse(watch.expiresAt) <= Date.now()) return [];
      push('entry', watch.level);
      push('invalidation', watch.invalidation);
    }
    const shadow = extractShadowPlan(result);
    push('invalidation', positive(analysis.invalidationLevel));
    push('entry', shadow?.entry ?? null);
    push('stop', shadow?.stopLoss ?? null);
    push('tp1', shadow?.takeProfit1 ?? null);
  }
  return out;
}

export function sideFor(level: number, referencePrice: number): AlertSide | null {
  if (level > referencePrice) return 'above';
  if (level < referencePrice) return 'below';
  return null;
}

/**
 * O primeiro candle que abriu em `watchFrom` ou depois e cruzou o nivel.
 * Acima: maxima >= nivel. Abaixo: minima <= nivel. Candles em ordem de tempo.
 */
export function findTrigger(
  alert: { level: number; side: AlertSide; watchFrom: Date },
  candles: Candle[],
): { at: Date; price: number } | null {
  const from = alert.watchFrom.getTime();
  for (const c of candles) {
    if (c[0] < from) continue;
    if (alert.side === 'above' && c[2] >= alert.level) return { at: new Date(c[0]), price: c[2] };
    if (alert.side === 'below' && c[3] <= alert.level) return { at: new Date(c[0]), price: c[3] };
  }
  return null;
}

/** Mesma trava do servidor (gratis esgotado sem assinatura), so com o banco: o worker nao fala com a Stripe. */
export async function alertsPausedFor(prisma: FreeQuotaCounter & RawPrisma, userId: string): Promise<boolean> {
  if (!(await getFreeQuota(prisma, userId)).settledExhausted) return false;
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT (
      EXISTS (SELECT 1 FROM "tickrify"."Subscription" WHERE "userId" = ${userId} AND "status" IN ('active', 'trialing'))
      OR EXISTS (SELECT 1 FROM "tickrify"."User" WHERE "id" = ${userId} AND LOWER(COALESCE("role", '')) = 'admin')
    ) AS "ok"
  `;
  return rows[0]?.ok !== true;
}

const alertColumns = () => Prisma.sql`a."id", a."userId", a."setupId", a."analysisId", a."symbol", a."priceSymbol", a."level", a."label", a."side",
  a."status", a."createdAt", a."triggeredAt", a."triggerPrice", a."seenAt"`;

function toView(row: AlertRow): AlertView {
  return {
    id: row.id,
    setupId: row.setupId,
    analysisId: row.analysisId,
    symbol: row.symbol,
    timeframe: row.timeframe ?? null,
    level: Number(row.level),
    label: row.label,
    side: row.side,
    status: row.status,
    createdAt: row.createdAt,
    triggeredAt: row.triggeredAt,
    triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice),
    seenAt: row.seenAt,
    lastPrice: row.lastPrice == null ? null : Number(row.lastPrice),
    checkedAt: row.checkedAt ?? null,
    ...checkCadence(row.priceSymbol, row.intervalMs),
  };
}

type AnalysisRow = { createdAt: Date; groundingInterval: string | null; id: string; status: string; recommendation: string | null; result: unknown; setupId: string | null; updatedAt?: Date | null };

const levelInBand = (level: number, referencePrice: number) => level >= referencePrice * LEVEL_BAND.min && level <= referencePrice * LEVEL_BAND.max;

const lockAlerts = (tx: RawPrisma, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`alerts:${userId}`}))`;

async function countSetupsWithAlerts(db: RawPrisma, userId: string, exceptSetupId: string | null = null): Promise<number> {
  const except = exceptSetupId ? Prisma.sql`AND "setupId" <> ${exceptSetupId}` : Prisma.empty;
  const [{ n }] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT "setupId")::int AS "n" FROM "tickrify"."SetupAlert"
    WHERE "userId" = ${userId} AND "status" = 'active' ${except}
  `;
  return Number(n) || 0;
}

/**
 * Ultimo fechamento conhecido do ativo: o cache do monitor se for recente,
 * senao uma busca. Forex/metal pede os ultimos 120 candles de 5m
 * (o mesmo pedido do grounding, cache compartilhado; no fim de semana vale o
 * fechamento de sexta). Sem cota ou falhou = null; nunca se inventa preco.
 */
async function latestAlertPrice(db: RawPrisma, priceSymbol: string, source: CandleSource): Promise<number | null> {
  try {
    const cached = await db.$queryRaw<Array<{ lastPrice: number | null; checkedAt: Date | null }>>`
      SELECT "lastPrice", "checkedAt" FROM "tickrify"."AlertPriceCheck" WHERE "symbol" = ${priceSymbol} LIMIT 1
    `;
    const hit = cached[0];
    if (hit?.lastPrice && hit.checkedAt && Date.now() - hit.checkedAt.getTime() < ALERT_RULES.cacheTtlMs[source]) {
      return Number(hit.lastPrice);
    }
    const now = Date.now();
    const candles =
      source === 'fx'
        ? await fetchFxLatest5m(priceSymbol, 'monitor', ALERT_RULES.cacheTtlMs.fx)
        : await fetchCrypto1m(priceSymbol, now - 10 * MINUTE, now);
    return candles?.length ? candles[candles.length - 1][4] : null;
  } catch {
    return null;
  }
}

/**
 * Grava o alerta com o lock de alertas da pessoa ja tomado. Mesmo nivel ativo
 * no setup devolve o alerta que existe; teto estourado lanca Conflict.
 */
async function insertAlertLocked(
  tx: RawPrisma,
  input: {
    userId: string;
    setupId: string;
    analysisId: string;
    symbol: string;
    priceSymbol: string;
    level: number;
    label: AlertLabel;
    side: AlertSide;
    referencePrice: number;
    cap: number;
    /** So o alerta automatico do WATCH tem validade; o feito a mao nao expira. */
    expiresAt: Date | null;
  },
): Promise<{ row: AlertRow; created: boolean }> {
  const { userId, setupId, level, cap } = input;
  const same = await tx.$queryRaw<AlertRow[]>`
    SELECT ${alertColumns()} FROM "tickrify"."SetupAlert" a
    WHERE a."setupId" = ${setupId} AND a."userId" = ${userId} AND a."status" = 'active' AND a."level" = ${level}
    LIMIT 1
  `;
  if (same[0]) return { row: same[0], created: false };
  const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS "n" FROM "tickrify"."SetupAlert"
    WHERE "setupId" = ${setupId} AND "userId" = ${userId} AND "status" = 'active'
  `;
  if (Number(n) >= ALERT_RULES.maxActivePerSetup) {
    throw new ConflictException({
      code: 'alert_setup_limit',
      message: `A setup can have ${ALERT_RULES.maxActivePerSetup} active alerts. Cancel one to add another.`,
    });
  }
  if (Number(n) === 0 && (await countSetupsWithAlerts(tx, userId, setupId)) >= cap) {
    throw new ConflictException({ code: 'alert_limit', limit: cap, message: `You have alerts on ${cap} setups. Cancel one to add another.` });
  }
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "tickrify"."SetupAlert"
      ("id", "userId", "setupId", "analysisId", "symbol", "priceSymbol", "level", "label", "side", "referencePrice",
       "prefilled", "status", "createdAt", "updatedAt", "watchFrom", "expiresAt")
    VALUES (${id}, ${userId}, ${setupId}, ${input.analysisId}, ${input.symbol}, ${input.priceSymbol}, ${level}, ${input.label},
      ${input.side}, ${input.referencePrice}, ${input.label !== 'custom'}, 'active', NOW(), NOW(), NOW(), ${input.expiresAt})
  `;
  const inserted = await tx.$queryRaw<AlertRow[]>`
    SELECT ${alertColumns()} FROM "tickrify"."SetupAlert" a WHERE a."id" = ${id} LIMIT 1
  `;
  return { row: inserted[0], created: true };
}

type WatchingAlertRow = { id: string; setupId: string; analysisId: string; level: number; status: AlertStatus; triggeredAt: Date | null; seenAt: Date | null };

export type WatchingItem = {
  analysisId: string;
  symbol: string | null;
  timeframe: string | null;
  createdAt: Date;
  watch: WatchSummary;
  /** Ultimo preco checado do ativo; null sem checagem recente (nunca busca preco para a tela). */
  lastPrice: number | null;
  checkedAt: Date | null;
  checkIntervalMs: number | null;
  marketClosed: boolean;
  alert: { id: string; setupId: string; status: AlertStatus; triggeredAt: Date | null; seenAt: Date | null } | null;
};

export type WatchAlertOutcome =
  | 'created'
  | 'not_watch'
  | 'print_mode'
  | 'no_price_source'
  | 'analysis_missing'
  | 'unsubscribed'
  | 'free_locked'
  | 'no_level'
  | 'no_price'
  | 'level_rejected'
  | 'already_handled'
  | 'limit'
  | 'error';

/**
 * Todo WATCH vira alerta sozinho (09/11/2026): quando o preco chega no nivel, o
 * trader e chamado de volta. Fila e caminho sincrono chamam isto depois de
 * gravar `completed`. Mesmas regras do alerta manual; o que nao cabe nelas nao
 * cria nada e nao da erro: a analise nunca depende disto.
 *
 * Seguir e gravar o alerta acontecem na MESMA transacao: bater no teto nao
 * deixa setup seguido sem alerta. Uma vez por analise: alerta cancelado pela
 * pessoa nao volta, e setup largado continua largado.
 */
export async function createWatchAlert(
  prisma: PrismaClient,
  input: { analysisId: string; userId: string; result: unknown; recommendation: string | null },
  log: (message: string) => void = () => undefined,
): Promise<WatchAlertOutcome> {
  const { analysisId, userId, result, recommendation } = input;
  if (!storedWatchPlan(result, recommendation)) return 'not_watch';
  const outcome = await (async (): Promise<WatchAlertOutcome> => {
    if (record(result).dataMode !== 'real_data') return 'print_mode';
    const plan = readPlan(result, recommendation);
    const price = priceSymbolOf(plan.symbol);
    if (!price || !plan.symbol) return 'no_price_source';
    const symbol = plan.symbol;

    const [analysis] = await prisma.$queryRaw<
      Array<{ id: string; setupId: string | null; createdAt: Date; groundingInterval: string | null; clerkUserId: string | null }>
    >`
      SELECT a."id", a."setupId", a."createdAt", a."groundingStats"->>'interval' AS "groundingInterval", u."clerkUserId"
      FROM "tickrify"."Analysis" a
      JOIN "tickrify"."User" u ON u."id" = a."userId"
      WHERE a."id" = ${analysisId} AND a."userId" = ${userId} AND a."status" = 'completed'
      LIMIT 1
    `;
    if (!analysis) return 'analysis_missing';
    const unsubscribed = await prisma.adminAudit.findFirst({
      where: { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: userId },
      select: { id: true },
    });
    if (unsubscribed) return 'unsubscribed';
    if (await alertsPausedFor(prisma, userId)) return 'free_locked';

    // So o nivel do plano do modelo: nunca niveis guardados pelo codigo nem o mapa do NO_TRADE.
    const watch = watchSummaryOf(result, recommendation, analysis.createdAt, {
      groundingInterval: analysis.groundingInterval, setupId: null, track: null,
    });
    const level = watch?.level;
    const expiresAt = watch?.expiresAt;
    if (level == null || !expiresAt || Date.parse(expiresAt) <= Date.now()) return 'no_level';
    const referencePrice = (await latestAlertPrice(prisma, price.priceSymbol, price.source)) ?? positive(record(record(result).analysis).currentPrice);
    if (referencePrice == null) return 'no_price';
    const side = levelInBand(level, referencePrice) ? sideFor(level, referencePrice) : null;
    if (!side) return 'level_rejected';

    const [{ ok: isSubscriber }] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM "tickrify"."Subscription" WHERE "userId" = ${userId} AND "status" IN ('active', 'trialing')) AS "ok"
    `;
    const cap = isSubscriber ? ALERT_RULES.maxSetupsWithAlerts.subscriber : ALERT_RULES.maxSetupsWithAlerts.free;

    const saved = await prisma.$transaction(async (tx) => {
      await lockAlerts(tx, userId);
      const handled = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "tickrify"."SetupAlert" WHERE "analysisId" = ${analysisId} AND "userId" = ${userId} LIMIT 1
      `;
      if (handled[0]) return null;
      await lockSetups(tx, userId);
      const existing = await findSetupOfAnalysis(tx, userId, analysis);
      if (existing && existing.status !== 'tracking') return null;
      const { setup } = await followInTransaction(tx, userId, analysis, plan);
      const { row, created } = await insertAlertLocked(tx, {
        userId, setupId: setup.id, analysisId, symbol, priceSymbol: price.priceSymbol,
        level, label: 'entry', side, referencePrice, cap, expiresAt: new Date(expiresAt),
      });
      return created ? { alertId: row.id, setupId: setup.id } : null;
    });
    if (!saved) return 'already_handled';

    if (analysis.clerkUserId) {
      captureServer(analysis.clerkUserId, 'setup_alert_created', {
        alertId: saved.alertId,
        setupId: saved.setupId,
        label: 'entry',
        prefilled: true,
        auto: true,
        symbol_class: price.symbolClass,
        is_subscriber: isSubscriber,
        trial_day: isSubscriber ? null : (await getFreeQuota(prisma, userId)).trial?.dayIndex ?? null,
      });
    }
    return 'created';
  })().catch((error: unknown): WatchAlertOutcome => {
    if (error instanceof ConflictException) return 'limit';
    log(`[alerts] Alerta automatico falhou analysis=${analysisId}: ${error instanceof Error ? error.message : error}`);
    return 'error';
  });
  log(`[alerts] watch-auto analysis=${analysisId} outcome=${outcome}`);
  return outcome;
}

@Injectable()
export class SetupAlertsService implements OnModuleInit {
  private readonly logger = new Logger(SetupAlertsService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly setups: SetupsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[alerts] Tabelas prontas.');
    } catch (error) {
      this.ready = false;
      this.logger.warn(`[alerts] Indisponivel (alertas desligados): ${error instanceof Error ? error.message : error}`);
    }
  }

  private assertReady() {
    if (!this.ready) {
      throw new ServiceUnavailableException({ code: 'alerts_unavailable', message: 'Price alerts are temporarily unavailable.' });
    }
  }

  private async loadAnalysis(userId: string, analysisId: string): Promise<AnalysisRow> {
    const rows = await this.prisma.$queryRaw<AnalysisRow[]>`
      SELECT "id", "status", "recommendation", "result", "setupId", "createdAt", "updatedAt", "groundingStats"->>'interval' AS "groundingInterval"
      FROM "tickrify"."Analysis"
      WHERE "id" = ${analysisId} AND "userId" = ${userId}
      LIMIT 1
    `;
    const analysis = rows[0];
    if (!analysis || analysis.status !== 'completed') throw new NotFoundException({ code: 'analysis_not_found' });
    return analysis;
  }

  /** WATCH recem-concluido cujo alerta automatico ainda nao foi gravado (a tela espera em vez de oferecer criar). */
  private async watchAlertPending(userId: string, analysis: AnalysisRow, hasPriceSource: boolean): Promise<boolean> {
    const age = analysis.updatedAt ? Date.now() - analysis.updatedAt.getTime() : Infinity;
    if (age > ALERT_RULES.watchAutoPendingMs || !hasPriceSource) return false;
    if (record(analysis.result).dataMode !== 'real_data' || !storedWatchPlan(analysis.result, analysis.recommendation)) return false;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "tickrify"."SetupAlert" WHERE "analysisId" = ${analysis.id} AND "userId" = ${userId} LIMIT 1
    `;
    return rows.length === 0;
  }

  /**
   * O que a tela do resultado precisa para oferecer o alerta: se o ativo tem
   * fonte de preco, os niveis ja preenchidos, o setup (se ja segue) e os
   * alertas dele.
   */
  async options(userId: string, analysisId: string, isSubscriber: boolean) {
    this.assertReady();
    const analysis = await this.loadAnalysis(userId, analysisId);
    const plan = readPlan(analysis.result, analysis.recommendation);
    const price = priceSymbolOf(plan.symbol);
    const referencePrice = positive(record(record(analysis.result).analysis).currentPrice);
    const { setup } = await this.setups.findForAnalysis(userId, analysisId);
    const following = setup?.status === 'tracking' ? setup : null;
    const alerts = following ? (await this.list(userId, { setupId: following.id })).items : [];
    return {
      available: Boolean(price),
      symbol: plan.symbol,
      symbolClass: price?.symbolClass ?? null,
      referencePrice,
      suggestions: price ? alertSuggestions(analysis.result, analysis.recommendation, analysis) : [],
      setupId: following?.id ?? null,
      alerts,
      // WATCH com alerta valendo no nivel do plano: a tela troca o formulario por "We'll email you".
      watchAlert: plan.signalState === 'WATCH' ? alerts.find((a) => a.status === 'active' && a.label === 'entry' && a.analysisId === analysisId) ?? null : null,
      autoAlertPending: await this.watchAlertPending(userId, analysis, Boolean(price)),
      limits: {
        perSetup: ALERT_RULES.maxActivePerSetup,
        maxSetups: isSubscriber ? ALERT_RULES.maxSetupsWithAlerts.subscriber : ALERT_RULES.maxSetupsWithAlerts.free,
        setupsUsed: await countSetupsWithAlerts(this.prisma, userId),
      },
    };
  }

  /**
   * Cria o alerta (e segue o setup, se ainda nao segue: um clique so).
   * Rotulo diferente de `custom` tem de bater com o nivel preenchido pelo
   * servidor; nivel editado chega como `custom`. Clique duplo no mesmo nivel
   * devolve o mesmo alerta.
   */
  async create(
    user: { id: string; clerkUserId?: string },
    input: { analysisId: string; label: AlertLabel; level: number },
    context: { isSubscriber: boolean; trialDay: number | null },
  ): Promise<{ alert: AlertView; setupId: string }> {
    this.assertReady();
    const analysis = await this.loadAnalysis(user.id, input.analysisId);
    const plan = readPlan(analysis.result, analysis.recommendation);
    const price = priceSymbolOf(plan.symbol);
    if (!price || !plan.symbol) {
      throw new UnprocessableEntityException({ code: 'alert_unavailable', message: "Price alerts aren't available for this asset yet." });
    }
    const symbol = plan.symbol;
    const level = input.level;
    const suggestion = alertSuggestions(analysis.result, analysis.recommendation, analysis).find((s) => s.label === input.label);
    if (input.label !== 'custom' && (!suggestion || Math.abs(suggestion.level - level) > Math.abs(level) * 1e-9)) {
      throw new BadRequestException({ code: 'alert_level_mismatch', message: 'This level does not match the analysis.' });
    }
    // O lado (acima/abaixo) sai do preco de AGORA: um alerta criado a partir de
    // uma analise antiga, com o preco ja longe, dispararia na primeira volta sem
    // o preco ter ido ate o nivel. O preco da analise so vale sem preco real.
    const referencePrice =
      (await latestAlertPrice(this.prisma, price.priceSymbol, price.source)) ?? positive(record(record(analysis.result).analysis).currentPrice);
    if (referencePrice == null) {
      throw new UnprocessableEntityException({ code: 'alert_price_unavailable', message: 'We could not read the current price. Try again later.' });
    }
    if (!levelInBand(level, referencePrice)) {
      throw new BadRequestException({ code: 'alert_level_out_of_range', message: 'This level is too far from the current price.' });
    }
    const side = sideFor(level, referencePrice);
    if (!side) throw new BadRequestException({ code: 'alert_level_at_price', message: 'Price is already at this level.' });

    const { setup } = await this.setups.follow(user, input.analysisId);
    const cap = context.isSubscriber ? ALERT_RULES.maxSetupsWithAlerts.subscriber : ALERT_RULES.maxSetupsWithAlerts.free;

    const { row, created } = await this.prisma.$transaction(async (tx) => {
      await lockAlerts(tx, user.id);
      return insertAlertLocked(tx, {
        userId: user.id, setupId: setup.id, analysisId: input.analysisId, symbol, priceSymbol: price.priceSymbol,
        level, label: input.label, side, referencePrice, cap, expiresAt: null,
      });
    });

    if (created && user.clerkUserId) {
      captureServer(user.clerkUserId, 'setup_alert_created', {
        alertId: row.id,
        setupId: setup.id,
        label: input.label,
        prefilled: input.label !== 'custom',
        symbol_class: price.symbolClass,
        is_subscriber: context.isSubscriber,
        trial_day: context.trialDay,
      });
    }
    return { alert: toView({ ...row, timeframe: setup.timeframe }), setupId: setup.id };
  }

  /**
   * Alertas da pessoa: ativos e disparados recentes (7 dias; 30 na pagina do
   * setup), com o ultimo preco checado do ativo. `unseen` = disparados que a
   * pessoa ainda nao abriu.
   */
  async list(userId: string, options: { setupId?: string | null } = {}) {
    this.assertReady();
    const setupId = options.setupId ?? null;
    const since = new Date(Date.now() - (setupId ? ALERT_RULES.triggeredVisibleOnSetupMs : ALERT_RULES.triggeredVisibleMs));
    const onlySetup = setupId ? Prisma.sql`AND a."setupId" = ${setupId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<AlertRow[]>`
      SELECT ${alertColumns()}, s."timeframe", p."lastPrice", p."checkedAt", p."intervalMs"
      FROM "tickrify"."SetupAlert" a
      JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId" AND s."status" = 'tracking'
      LEFT JOIN "tickrify"."AlertPriceCheck" p ON p."symbol" = a."priceSymbol"
      WHERE a."userId" = ${userId} ${onlySetup}
        AND (a."status" = 'active' OR (a."status" = 'triggered' AND a."triggeredAt" > ${since}))
      ORDER BY (a."status" = 'triggered' AND a."seenAt" IS NULL) DESC, a."triggeredAt" DESC NULLS LAST, a."createdAt" DESC, a."id" DESC
      LIMIT 100
    `;
    const items = rows.map(toView);
    return { items, unseen: items.filter((a) => a.status === 'triggered' && !a.seenAt).length };
  }

  /**
   * Secao "Watching" do My Trades e do Diario: os WATCH valendo e os encerrados
   * ha ate 7 dias, com o alerta do nivel e o ultimo preco checado. O que o preco
   * fez vem so do rastreador (ou do proprio alerta, antes da linha existir).
   * Informacao de mercado: nada aqui entra em acerto, P&L ou estatistica.
   */
  async watching(userId: string): Promise<{ items: WatchingItem[] }> {
    this.assertReady();
    const now = new Date();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; recommendation: string | null; result: unknown; createdAt: Date }>>`
      SELECT "id", "recommendation", "result", "createdAt"
      FROM "tickrify"."Analysis"
      WHERE "userId" = ${userId} AND "status" = 'completed' AND "createdAt" > ${new Date(now.getTime() - WATCHING_RULES.lookbackMs)}
        AND "result"->>'signalState' = 'WATCH'
      ORDER BY "createdAt" DESC
      LIMIT 100
    `;
    if (rows.length === 0) return { items: [] };
    const contexts = await loadWatchContexts(this.prisma, rows.map((r) => r.id));
    const entries = rows.flatMap((row) => {
      const context = contexts.get(row.id);
      const watch = watchSummaryOf(row.result, row.recommendation, row.createdAt, context);
      if (!watch) return [];
      const closedAt = watch.expiresAt ? Date.parse(watch.expiresAt) : row.createdAt.getTime();
      if (closedAt <= now.getTime() - WATCHING_RULES.closedVisibleMs) return [];
      const plan = readPlan(row.result, row.recommendation);
      return [{ row, watch, symbol: plan.symbol, timeframe: plan.timeframe, priceSymbol: priceSymbolOf(plan.symbol)?.priceSymbol ?? null }];
    });
    if (entries.length === 0) return { items: [] };

    const symbols = [...new Set(entries.flatMap((e) => (e.priceSymbol ? [e.priceSymbol] : [])))];
    const checks = new Map(
      symbols.length
        ? (
            await this.prisma.$queryRaw<Array<{ symbol: string; lastPrice: number | null; checkedAt: Date | null; intervalMs: number | null }>>`
              SELECT "symbol", "lastPrice", "checkedAt", "intervalMs" FROM "tickrify"."AlertPriceCheck" WHERE "symbol" IN (${Prisma.join(symbols)})
            `
          ).map((c) => [c.symbol, c])
        : [],
    );
    const alerts = await this.prisma.$queryRaw<WatchingAlertRow[]>`
      SELECT "id", "setupId", "analysisId", "level", "status", "triggeredAt", "seenAt" FROM "tickrify"."SetupAlert"
      WHERE "userId" = ${userId} AND "analysisId" IN (${Prisma.join(entries.map((e) => e.row.id))})
      ORDER BY "createdAt" DESC
    `;

    const items = entries.map(({ row, watch, symbol, timeframe, priceSymbol }): WatchingItem => {
      const check = priceSymbol ? checks.get(priceSymbol) : undefined;
      const cadence = priceSymbol ? checkCadence(priceSymbol, check?.intervalMs, now) : { checkIntervalMs: null, marketClosed: false };
      const age = check?.checkedAt ? now.getTime() - check.checkedAt.getTime() : Infinity;
      const fresh = age < WATCHING_RULES.priceFreshMs || (cadence.marketClosed && age < 3 * 24 * HOUR);
      const onLevel = alerts.filter((a) => a.analysisId === row.id && Math.abs(Number(a.level) - watch.level) <= Math.abs(watch.level) * 1e-9);
      const alert = onLevel.find((a) => a.status === 'triggered') ?? onLevel.find((a) => a.status === 'active') ?? onLevel[0] ?? null;
      return {
        analysisId: row.id,
        symbol,
        timeframe,
        createdAt: row.createdAt,
        watch,
        lastPrice: fresh && check?.lastPrice != null ? Number(check.lastPrice) : null,
        checkedAt: fresh ? check?.checkedAt ?? null : null,
        ...cadence,
        alert: alert ? { id: alert.id, setupId: alert.setupId, status: alert.status, triggeredAt: alert.triggeredAt, seenAt: alert.seenAt } : null,
      };
    });
    const open = (item: WatchingItem) => item.watch.outcome === 'pending' && item.watch.expiresAt !== null && Date.parse(item.watch.expiresAt) > now.getTime();
    const rank = (item: WatchingItem) => (item.alert?.status === 'triggered' && !item.alert.seenAt ? 0 : open(item) ? 1 : 2);
    const expiry = (item: WatchingItem) => (item.watch.expiresAt ? Date.parse(item.watch.expiresAt) : item.createdAt.getTime());
    items.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? expiry(a) - expiry(b) : expiry(b) - expiry(a)));
    return { items: items.slice(0, WATCHING_RULES.maxItems) };
  }

  /** Para o paywall `alerts`: o ativo de um alerta pausado da conta travada. */
  async pausedSymbol(userId: string): Promise<string | null> {
    if (!this.ready) return null;
    const rows = await this.prisma.$queryRaw<Array<{ symbol: string }>>`
      SELECT "symbol" FROM "tickrify"."SetupAlert"
      WHERE "userId" = ${userId} AND "status" = 'active'
      ORDER BY "createdAt" DESC LIMIT 1
    `;
    return rows[0]?.symbol ?? null;
  }

  private async findOwned(userId: string, alertId: string): Promise<AlertRow> {
    const rows = await this.prisma.$queryRaw<AlertRow[]>`
      SELECT ${alertColumns()} FROM "tickrify"."SetupAlert" a WHERE a."id" = ${alertId} AND a."userId" = ${userId} LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException({ code: 'alert_not_found' });
    return rows[0];
  }

  async cancel(userId: string, alertId: string): Promise<{ alert: AlertView }> {
    this.assertReady();
    const row = await this.findOwned(userId, alertId);
    if (row.status !== 'active') return { alert: toView(row) };
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."SetupAlert" SET "status" = 'cancelled', "cancelledAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = ${alertId} AND "userId" = ${userId} AND "status" = 'active'
    `;
    return { alert: toView({ ...row, status: 'cancelled' }) };
  }

  async markSeen(userId: string, alertId: string): Promise<{ alert: AlertView }> {
    this.assertReady();
    const row = await this.findOwned(userId, alertId);
    if (row.status !== 'triggered' || row.seenAt) return { alert: toView(row) };
    const seenAt = new Date();
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."SetupAlert" SET "seenAt" = ${seenAt}, "updatedAt" = NOW()
      WHERE "id" = ${alertId} AND "userId" = ${userId} AND "seenAt" IS NULL
    `;
    return { alert: toView({ ...row, seenAt }) };
  }

  /** Setup largado ou arquivado: os alertas ativos dele acabam junto. Nunca lanca. */
  async cancelForSetup(userId: string, setupId: string): Promise<void> {
    if (!this.ready) return;
    try {
      await this.prisma.$executeRaw`
        UPDATE "tickrify"."SetupAlert" SET "status" = 'cancelled', "cancelledAt" = NOW(), "updatedAt" = NOW()
        WHERE "setupId" = ${setupId} AND "userId" = ${userId} AND "status" = 'active'
      `;
    } catch (error) {
      this.logger.warn(`[alerts] Alertas do setup nao cancelados (${setupId}): ${error instanceof Error ? error.message : error}`);
    }
  }
}

// ── Monitor (worker embutido, a cada 1 min) ─────────────────────────────────

type MonitorRow = {
  id: string;
  userId: string;
  setupId: string;
  priceSymbol: string;
  level: number;
  label: AlertLabel;
  side: AlertSide;
  createdAt: Date;
  watchFrom: Date;
  clerkUserId: string | null;
};

export type AlertMonitorDeps = {
  prisma: RawPrisma & FreeQuotaCounter;
  now?: () => Date;
  fetchCrypto?: typeof fetchCrypto1m;
  fetchFxLatest?: typeof fetchFxLatest5m;
  isPaused?: (userId: string) => Promise<boolean>;
  /** Guardado entre as voltas: a trava da conta nao precisa ser refeita a cada minuto. */
  pauseCache?: Map<string, { paused: boolean; at: number }>;
  capture?: typeof captureServer;
  log(level: 'log' | 'warn', message: string): void;
};

/**
 * Uma volta do monitor. Agrupa os alertas ativos por ativo, pega o direito de
 * buscar cada ativo (uma instancia por vez, no maximo 1x por intervalo), busca
 * uma vez as velas (1m cripto, 5m forex/metal) e dispara o que cruzou. Devolve
 * os numeros do log.
 */
export type AlertMonitorCounts = { symbols: number; checked: number; triggered: number; paused: number };

export async function runAlertMonitor(deps: AlertMonitorDeps): Promise<AlertMonitorCounts> {
  const now = deps.now ? deps.now() : new Date();
  const fetchCrypto = deps.fetchCrypto ?? fetchCrypto1m;
  const fetchFxLatest = deps.fetchFxLatest ?? fetchFxLatest5m;
  const checkPaused = deps.isPaused ?? ((userId: string) => alertsPausedFor(deps.prisma, userId));
  const isPaused = async (userId: string) => {
    const hit = deps.pauseCache?.get(userId);
    if (hit && now.getTime() - hit.at < ALERT_RULES.pauseCheckTtlMs) return hit.paused;
    const paused = await checkPaused(userId);
    deps.pauseCache?.set(userId, { paused, at: now.getTime() });
    return paused;
  };
  const capture = deps.capture ?? captureServer;
  const counts = { symbols: 0, checked: 0, triggered: 0, paused: 0 };

  // Alerta automatico cuja janela do WATCH fechou: cancela e libera o teto.
  const expired = await deps.prisma.$executeRaw`
    UPDATE "tickrify"."SetupAlert" SET "status" = 'cancelled', "cancelledAt" = ${now}, "updatedAt" = NOW()
    WHERE "status" = 'active' AND "expiresAt" IS NOT NULL AND "expiresAt" <= ${now}
  `;
  if (Number(expired) > 0) deps.log('log', `[alerts] expirados=${Number(expired)}`);

  const rows = await deps.prisma.$queryRaw<MonitorRow[]>`
    SELECT a."id", a."userId", a."setupId", a."priceSymbol", a."level", a."label", a."side", a."createdAt", a."watchFrom",
      u."clerkUserId"
    FROM "tickrify"."SetupAlert" a
    JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId" AND s."status" = 'tracking'
    JOIN "tickrify"."User" u ON u."id" = a."userId"
    WHERE a."status" = 'active'
    ORDER BY a."priceSymbol", a."createdAt"
    LIMIT 2000
  `;
  if (rows.length === 0) return counts;

  const pausedUsers = new Set<string>();
  for (const userId of new Set(rows.map((r) => r.userId))) {
    try {
      if (await isPaused(userId)) pausedUsers.add(userId);
    } catch (err) {
      // Na duvida, nao dispara: melhor atrasar um alerta que avisar conta travada.
      pausedUsers.add(userId);
      deps.log('warn', `[alerts] Trava nao conferida user=${userId}: ${(err as Error)?.message ?? err}`);
    }
  }
  if (pausedUsers.size > 0) {
    // Pausado: o relogio anda junto, para a volta nao disparar pelo passado.
    await deps.prisma.$executeRaw`
      UPDATE "tickrify"."SetupAlert" SET "watchFrom" = ${now}, "updatedAt" = NOW()
      WHERE "status" = 'active' AND "userId" IN (${Prisma.join([...pausedUsers])})
    `;
    counts.paused = rows.filter((r) => pausedUsers.has(r.userId)).length;
  }

  const bySymbol = new Map<string, MonitorRow[]>();
  for (const row of rows) {
    if (pausedUsers.has(row.userId)) continue;
    bySymbol.set(row.priceSymbol, [...(bySymbol.get(row.priceSymbol) ?? []), row]);
  }

  if (bySymbol.size === 0) return counts;
  // Quem foi checado ha mais tempo primeiro, e o ouro sempre antes dos outros
  // forex: o teto por volta nunca deixa o mesmo ativo de fora.
  const lastChecks = new Map(
    (
      await deps.prisma.$queryRaw<Array<{ symbol: string; claimedAt: Date | null; lastCandleAt: Date | null }>>`
        SELECT "symbol", "claimedAt", "lastCandleAt" FROM "tickrify"."AlertPriceCheck"
        WHERE "symbol" IN (${Prisma.join([...bySymbol.keys()])})
      `
    ).map((r) => [r.symbol, r]),
  );
  const gold = (symbol: string) => (symbol === 'XAUUSD' ? 0 : 1);
  const ordered = [...bySymbol.entries()].sort(
    ([a], [b]) => gold(a) - gold(b) || (lastChecks.get(a)?.claimedAt?.getTime() ?? 0) - (lastChecks.get(b)?.claimedAt?.getTime() ?? 0),
  );
  let fxFetches = 0;
  // Forex/metal: o menor intervalo que a reserva do monitor ainda paga hoje.
  const fxSymbols = ordered.map(([symbol]) => symbol).filter((symbol) => candleSourceFor(symbol) === 'fx');
  const fxIntervals = fxSymbols.length > 0 ? monitorFxIntervals(fxSymbols, await twelveDataUsage(now), now) : new Map<string, number>();

  for (const [priceSymbol, alerts] of ordered) {
    try {
      const source = candleSourceFor(priceSymbol);
      if (!source) continue;
      if (source === 'fx' && (fxMarketClosed(now) || fxFetches >= ALERT_RULES.maxFxSymbolsPerRun)) continue;
      const interval = source === 'fx' ? fxIntervals.get(priceSymbol) ?? ALERT_RULES.cacheTtlMs.fx : ALERT_RULES.cacheTtlMs.crypto;
      const claimed = await deps.prisma.$queryRaw<Array<{ symbol: string }>>`
        INSERT INTO "tickrify"."AlertPriceCheck" ("symbol", "claimedAt") VALUES (${priceSymbol}, ${now})
        ON CONFLICT ("symbol") DO UPDATE SET "claimedAt" = EXCLUDED."claimedAt"
        WHERE "AlertPriceCheck"."claimedAt" IS NULL OR "AlertPriceCheck"."claimedAt" < ${new Date(now.getTime() - (interval - CLAIM_SLACK_MS))}
        RETURNING "symbol"
      `;
      if (claimed.length === 0) continue;
      counts.symbols++;
      if (source === 'fx') fxFetches++;

      const earliest = Math.min(...alerts.map((a) => a.watchFrom.getTime()));
      const step = INTERVAL_MS[ALERT_RULES.candleInterval[source]];
      // So o que falta: normalmente 2 ou 3 velas desde a ultima volta.
      const seen = lastChecks.get(priceSymbol)?.lastCandleAt?.getTime() ?? 0;
      const startMs = Math.max(earliest - step, seen - step, now.getTime() - ALERT_RULES.lookbackMs);
      const candles =
        source === 'fx'
          ? (await fetchFxLatest(priceSymbol, 'monitor', interval / 2))?.filter((c) => c[0] >= startMs) ?? null
          : await fetchCrypto(priceSymbol, startMs, now.getTime());
      if (!candles || candles.length === 0) {
        deps.log('warn', `[alerts] Sem candles symbol=${priceSymbol}`);
        continue;
      }
      const last = candles[candles.length - 1];
      await deps.prisma.$executeRaw`
        UPDATE "tickrify"."AlertPriceCheck"
        SET "checkedAt" = ${now}, "lastPrice" = ${last[4]}, "lastCandleAt" = ${new Date(last[0])}, "intervalMs" = ${interval}
        WHERE "symbol" = ${priceSymbol}
      `;

      for (const alert of alerts) {
        counts.checked++;
        const hit = findTrigger({ level: Number(alert.level), side: alert.side, watchFrom: alert.watchFrom }, candles);
        if (!hit) continue;
        const won = await deps.prisma.$executeRaw`
          UPDATE "tickrify"."SetupAlert"
          SET "status" = 'triggered', "triggeredAt" = ${hit.at}, "triggerPrice" = ${hit.price}, "updatedAt" = NOW()
          WHERE "id" = ${alert.id} AND "status" = 'active'
        `;
        if (Number(won) !== 1) continue;
        counts.triggered++;
        if (alert.clerkUserId) {
          capture(alert.clerkUserId, 'setup_alert_triggered', {
            alertId: alert.id,
            setupId: alert.setupId,
            label: alert.label,
            symbol_class: priceSymbolOf(priceSymbol)?.symbolClass ?? null,
            minutes_to_trigger: Math.max(0, Math.round((hit.at.getTime() - alert.createdAt.getTime()) / MINUTE)),
          }, { dedupeKey: `setup_alert_triggered:${alert.id}` });
        }
      }
    } catch (err) {
      if (err instanceof TwelveDataUnavailableError) {
        deps.log('log', `[alerts] symbol=${priceSymbol} adiado: cota do Twelve Data (${err.reason})`);
        // Minuto cheio nao e falta de cota: tenta na proxima volta, sem esperar o intervalo inteiro.
        if (err.reason === 'rate_limited') {
          await deps.prisma.$executeRaw`UPDATE "tickrify"."AlertPriceCheck" SET "claimedAt" = NULL WHERE "symbol" = ${priceSymbol}`.catch(() => undefined);
        }
        continue;
      }
      deps.log('warn', `[alerts] Falha best-effort symbol=${priceSymbol}: ${(err as Error)?.message ?? err}`);
    }
  }
  return counts;
}

/**
 * A volta do worker: monitor e, se algo disparou, e-mail na mesma volta. Sem
 * disparo, o e-mail so roda de vez em quando (o que a Resend recusou). Volta
 * lenta (fonte fora do ar) nunca se sobrepoe a seguinte.
 */
export function createAlertTick(options: {
  monitor: () => Promise<AlertMonitorCounts>;
  emails: () => Promise<{ due: number; sent: number }>;
  log: (level: 'log' | 'warn', message: string) => void;
  now?: () => number;
}): () => Promise<void> {
  const clock = options.now ?? Date.now;
  let running = false;
  let lastEmails = 0;
  let lastLog = 0;
  return async () => {
    if (running) return;
    running = true;
    try {
      const counts = await options.monitor().catch((err) => {
        options.log('warn', `[alerts] Varredura falhou: ${(err as Error)?.message ?? err}`);
        return null;
      });
      const triggered = (counts?.triggered ?? 0) > 0;
      if (counts && (triggered || (counts.symbols > 0 && clock() - lastLog >= ALERT_RULES.emailRetryMs))) {
        lastLog = clock();
        options.log('log', `[alerts] symbols=${counts.symbols} checked=${counts.checked} triggered=${counts.triggered} paused=${counts.paused}`);
      }
      if (!triggered && clock() - lastEmails < ALERT_RULES.emailRetryMs) return;
      lastEmails = clock();
      const emails = await options.emails().catch((err) => {
        options.log('warn', `[setup-alert] Varredura falhou: ${(err as Error)?.message ?? err}`);
        return null;
      });
      if (emails && emails.sent > 0) options.log('log', `[setup-alert] Volta: ${JSON.stringify(emails)}`);
    } finally {
      running = false;
    }
  };
}
