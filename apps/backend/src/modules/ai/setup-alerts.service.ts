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
import { INTERVAL_MS, candleSourceFor, fetchFxLatest5m, fetchWindowFor, priceSymbolOf, type Candle, type CandleSource } from '../market/candles';
import { TwelveDataUnavailableError, fxMarketClosed, monitorFxIntervalMs, twelveDataUsage } from '../market/twelve-data';
import { extractShadowPlan } from '../../../worker/outcome.sweeper';
import { SetupsService, readPlan } from './setups.service';
import { storedWatchPlan } from './watch-pending';
import { nearEdge } from '../../common/utils/plan-engine';

/**
 * Alertas de nivel dos setups acompanhados (27/10/2026, fase 1 da sessao diaria).
 *
 * Por que existe: de quem analisa, so 16% volta em outro dia; no trial, 76
 * usaram no dia 1 e 16 no dia 2. O setup acompanhado ja guardava o caminho de
 * volta, mas nada chamava o trader quando o preco chegava no nivel. Aqui o
 * Tickrify vigia o nivel em candles reais de 5m e, quando ele e tocado, marca o
 * alerta como disparado (o e-mail sai por setup-alert-email.ts).
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
  monitorIntervalMs: 10 * MINUTE,
  candleInterval: '5m' as const,
  /** Cache por ativo para todas as contas (Twelve Data tem cota diaria). */
  cacheTtlMs: { crypto: 5 * MINUTE, fx: 10 * MINUTE } as Record<CandleSource, number>,
  /**
   * Forex/metais buscados por volta. O Twelve Data gratis aceita 8 pedidos por
   * minuto (o grounding da analise usa a mesma chave): o que passar fica para a
   * proxima volta, na ordem de quem foi checado ha mais tempo.
   */
  maxFxSymbolsPerRun: 5,
  /** Janela maxima de candles por busca (100 candles de 5m). */
  lookbackMs: 8 * HOUR,
  /** Disparados que a lista ainda mostra. */
  triggeredVisibleMs: 7 * 24 * HOUR,
  triggeredVisibleOnSetupMs: 30 * 24 * HOUR,
} as const;

/** Nivel fora desta faixa do preco da analise e erro de digitacao (mesma regua do validador). */
const LEVEL_BAND = { min: 0.5, max: 2 };
// Um pouco antes do TTL: as varreduras de 10 min caem sempre do lado de fora.
const CLAIM_SLACK_MS = MINUTE;

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
};

type AlertRow = Omit<AlertView, 'timeframe' | 'lastPrice' | 'checkedAt'> & {
  userId: string;
  timeframe?: string | null;
  lastPrice?: number | null;
  checkedAt?: Date | null;
};

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
export function alertSuggestions(result: unknown, recommendation: string | null): AlertSuggestion[] {
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
    const watch = storedWatchPlan(result, plan.recommendation);
    if (watch) {
      push('entry', nearEdge(watch));
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

const alertColumns = () => Prisma.sql`a."id", a."userId", a."setupId", a."analysisId", a."symbol", a."level", a."label", a."side",
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
  };
}

type AnalysisRow = { id: string; status: string; recommendation: string | null; result: unknown; setupId: string | null };

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
      SELECT "id", "status", "recommendation", "result", "setupId"
      FROM "tickrify"."Analysis"
      WHERE "id" = ${analysisId} AND "userId" = ${userId}
      LIMIT 1
    `;
    const analysis = rows[0];
    if (!analysis || analysis.status !== 'completed') throw new NotFoundException({ code: 'analysis_not_found' });
    return analysis;
  }

  private async countSetupsWithAlerts(db: RawPrisma, userId: string, exceptSetupId: string | null = null): Promise<number> {
    const except = exceptSetupId ? Prisma.sql`AND "setupId" <> ${exceptSetupId}` : Prisma.empty;
    const [{ n }] = await db.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT "setupId")::int AS "n" FROM "tickrify"."SetupAlert"
      WHERE "userId" = ${userId} AND "status" = 'active' ${except}
    `;
    return Number(n) || 0;
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
      suggestions: price ? alertSuggestions(analysis.result, analysis.recommendation) : [],
      setupId: following?.id ?? null,
      alerts,
      limits: {
        perSetup: ALERT_RULES.maxActivePerSetup,
        maxSetups: isSubscriber ? ALERT_RULES.maxSetupsWithAlerts.subscriber : ALERT_RULES.maxSetupsWithAlerts.free,
        setupsUsed: await this.countSetupsWithAlerts(this.prisma, userId),
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
    const level = input.level;
    const suggestion = alertSuggestions(analysis.result, analysis.recommendation).find((s) => s.label === input.label);
    if (input.label !== 'custom' && (!suggestion || Math.abs(suggestion.level - level) > Math.abs(level) * 1e-9)) {
      throw new BadRequestException({ code: 'alert_level_mismatch', message: 'This level does not match the analysis.' });
    }
    // O lado (acima/abaixo) sai do preco de AGORA: um alerta criado a partir de
    // uma analise antiga, com o preco ja longe, dispararia na primeira volta sem
    // o preco ter ido ate o nivel. O preco da analise so vale sem preco real.
    const referencePrice =
      (await this.latestPrice(price.priceSymbol, price.source)) ?? positive(record(record(analysis.result).analysis).currentPrice);
    if (referencePrice == null) {
      throw new UnprocessableEntityException({ code: 'alert_price_unavailable', message: 'We could not read the current price. Try again later.' });
    }
    if (level < referencePrice * LEVEL_BAND.min || level > referencePrice * LEVEL_BAND.max) {
      throw new BadRequestException({ code: 'alert_level_out_of_range', message: 'This level is too far from the current price.' });
    }
    const side = sideFor(level, referencePrice);
    if (!side) throw new BadRequestException({ code: 'alert_level_at_price', message: 'Price is already at this level.' });

    const { setup } = await this.setups.follow(user, input.analysisId);
    const cap = context.isSubscriber ? ALERT_RULES.maxSetupsWithAlerts.subscriber : ALERT_RULES.maxSetupsWithAlerts.free;

    const { row, created } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`alerts:${user.id}`}))`;
      const same = await tx.$queryRaw<AlertRow[]>`
        SELECT ${alertColumns()} FROM "tickrify"."SetupAlert" a
        WHERE a."setupId" = ${setup.id} AND a."userId" = ${user.id} AND a."status" = 'active' AND a."level" = ${level}
        LIMIT 1
      `;
      if (same[0]) return { row: same[0], created: false };
      const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS "n" FROM "tickrify"."SetupAlert"
        WHERE "setupId" = ${setup.id} AND "userId" = ${user.id} AND "status" = 'active'
      `;
      if (Number(n) >= ALERT_RULES.maxActivePerSetup) {
        throw new ConflictException({
          code: 'alert_setup_limit',
          message: `A setup can have ${ALERT_RULES.maxActivePerSetup} active alerts. Cancel one to add another.`,
        });
      }
      if (Number(n) === 0 && (await this.countSetupsWithAlerts(tx, user.id, setup.id)) >= cap) {
        throw new ConflictException({ code: 'alert_limit', limit: cap, message: `You have alerts on ${cap} setups. Cancel one to add another.` });
      }
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "tickrify"."SetupAlert"
          ("id", "userId", "setupId", "analysisId", "symbol", "priceSymbol", "level", "label", "side", "referencePrice",
           "prefilled", "status", "createdAt", "updatedAt", "watchFrom")
        VALUES (${id}, ${user.id}, ${setup.id}, ${input.analysisId}, ${plan.symbol}, ${price.priceSymbol}, ${level}, ${input.label},
          ${side}, ${referencePrice}, ${input.label !== 'custom'}, 'active', NOW(), NOW(), NOW())
      `;
      const inserted = await tx.$queryRaw<AlertRow[]>`
        SELECT ${alertColumns()} FROM "tickrify"."SetupAlert" a WHERE a."id" = ${id} LIMIT 1
      `;
      return { row: inserted[0], created: true };
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
   * Ultimo fechamento de 5m conhecido do ativo: o cache do monitor se for
   * recente, senao uma busca. Forex/metal pede os ultimos 120 candles de 5m
   * (o mesmo pedido do grounding, cache compartilhado; no fim de semana vale o
   * fechamento de sexta). Sem cota ou falhou = null; nunca se inventa preco.
   */
  private async latestPrice(priceSymbol: string, source: CandleSource): Promise<number | null> {
    try {
      const cached = await this.prisma.$queryRaw<Array<{ lastPrice: number | null; checkedAt: Date | null }>>`
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
          : await fetchWindowFor(priceSymbol, now - 2 * HOUR, now, ALERT_RULES.candleInterval, 1, 'monitor');
      return candles?.length ? candles[candles.length - 1][4] : null;
    } catch {
      return null;
    }
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
      SELECT ${alertColumns()}, s."timeframe", p."lastPrice", p."checkedAt"
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

// ── Monitor (worker embutido, a cada 10 min) ────────────────────────────────

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
  fetchWindow?: typeof fetchWindowFor;
  fetchFxLatest?: typeof fetchFxLatest5m;
  isPaused?: (userId: string) => Promise<boolean>;
  capture?: typeof captureServer;
  log(level: 'log' | 'warn', message: string): void;
};

/**
 * Uma volta do monitor. Agrupa os alertas ativos por ativo, pega o direito de
 * buscar cada ativo (uma instancia por vez, no maximo 1x por TTL), busca os
 * candles de 5m e dispara o que cruzou. Devolve os numeros do log.
 */
export async function runAlertMonitor(deps: AlertMonitorDeps): Promise<{ symbols: number; checked: number; triggered: number; paused: number }> {
  const now = deps.now ? deps.now() : new Date();
  const fetchWindow = deps.fetchWindow ?? fetchWindowFor;
  const fetchFxLatest = deps.fetchFxLatest ?? fetchFxLatest5m;
  const isPaused = deps.isPaused ?? ((userId: string) => alertsPausedFor(deps.prisma, userId));
  const capture = deps.capture ?? captureServer;
  const counts = { symbols: 0, checked: 0, triggered: 0, paused: 0 };

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
  // Quem foi checado ha mais tempo primeiro: o teto de forex por volta nunca
  // deixa o mesmo ativo sempre de fora.
  const lastClaims = new Map(
    (
      await deps.prisma.$queryRaw<Array<{ symbol: string; claimedAt: Date | null }>>`
        SELECT "symbol", "claimedAt" FROM "tickrify"."AlertPriceCheck"
        WHERE "symbol" IN (${Prisma.join([...bySymbol.keys()])})
      `
    ).map((r) => [r.symbol, r.claimedAt?.getTime() ?? 0]),
  );
  const ordered = [...bySymbol.entries()].sort(([a], [b]) => (lastClaims.get(a) ?? 0) - (lastClaims.get(b) ?? 0));
  let fxFetches = 0;
  // Forex/metal: intervalo que cabe na reserva do monitor com N ativos, e 30
  // min acima de 80% do dia (twelve-data.ts).
  const fxSymbols = ordered.filter(([symbol]) => candleSourceFor(symbol) === 'fx').length;
  const fxIntervalMs = fxSymbols > 0 ? monitorFxIntervalMs(fxSymbols, await twelveDataUsage(now)) : ALERT_RULES.cacheTtlMs.fx;

  for (const [priceSymbol, alerts] of ordered) {
    try {
      const source = candleSourceFor(priceSymbol);
      if (!source) continue;
      if (source === 'fx' && (fxMarketClosed(now) || fxFetches >= ALERT_RULES.maxFxSymbolsPerRun)) continue;
      const ttl = (source === 'fx' ? fxIntervalMs : ALERT_RULES.cacheTtlMs.crypto) - CLAIM_SLACK_MS;
      const claimed = await deps.prisma.$queryRaw<Array<{ symbol: string }>>`
        INSERT INTO "tickrify"."AlertPriceCheck" ("symbol", "claimedAt") VALUES (${priceSymbol}, ${now})
        ON CONFLICT ("symbol") DO UPDATE SET "claimedAt" = EXCLUDED."claimedAt"
        WHERE "AlertPriceCheck"."claimedAt" IS NULL OR "AlertPriceCheck"."claimedAt" < ${new Date(now.getTime() - ttl)}
        RETURNING "symbol"
      `;
      if (claimed.length === 0) continue;
      counts.symbols++;
      if (source === 'fx') fxFetches++;

      const earliest = Math.min(...alerts.map((a) => a.watchFrom.getTime()));
      const startMs = Math.max(earliest - INTERVAL_MS[ALERT_RULES.candleInterval], now.getTime() - ALERT_RULES.lookbackMs);
      const candles =
        source === 'fx'
          ? (await fetchFxLatest(priceSymbol, 'monitor', ALERT_RULES.cacheTtlMs.fx))?.filter((c) => c[0] >= startMs) ?? null
          : await fetchWindow(priceSymbol, startMs, now.getTime(), ALERT_RULES.candleInterval, 1, 'monitor');
      if (!candles || candles.length === 0) {
        deps.log('warn', `[alerts] Sem candles symbol=${priceSymbol}`);
        continue;
      }
      const last = candles[candles.length - 1];
      await deps.prisma.$executeRaw`
        UPDATE "tickrify"."AlertPriceCheck"
        SET "checkedAt" = ${now}, "lastPrice" = ${last[4]}, "lastCandleAt" = ${new Date(last[0])}
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
        continue;
      }
      deps.log('warn', `[alerts] Falha best-effort symbol=${priceSymbol}: ${(err as Error)?.message ?? err}`);
    }
  }
  return counts;
}
