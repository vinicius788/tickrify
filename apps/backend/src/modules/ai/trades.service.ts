import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TicksService } from '../ticks/ticks.service';
import { AIAdapter } from './ai.adapter';
import { getFreeQuota } from '../../common/free-quota';
import { trackUserActivity } from '../../common/analytics/user-activity';
import { ImageStorageClient, prepareIncomingImage } from '../../common/utils/image-storage';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { normalizeSymbol } from '../../common/utils/analysis-normalizer';
import {
  TRADE_RULES,
  isOpenStatus,
  sameAsset,
  stateForVerdict,
  verdictFor,
  type CloseReason,
  type Direction,
  type MarkableStatus,
  type TradeStatus,
  type TradeTimelineEntry,
} from '../../common/trade-state';
import type { ManagementResult } from './trade-management';
import { releasePendingTradeCheck } from './trade-check-reservation';
import { admitTradeCheck, finishTradeCheck } from './trade-check-control';
import type { UploadedFile } from '../../common/interfaces/multer';

/**
 * Estado da operacao ligado a analise (13/10/2026). Regras puras em
 * common/trade-state.ts. Tabelas por SQL (boot + migracao
 * 20261013130000_trade_state), fora do schema.prisma, como os setups.
 *
 * Camada de baixo: nao conhece assinatura nem trava do gratis. Quem decide
 * acesso e o TradesController (via AiService), e o AiService chama
 * `syncFromVerdict` quando o resultado e marcado pelo My Trades/diario.
 */

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."TradeState" (
    "analysisId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "symbol" TEXT,
    "timeframe" TEXT,
    "entryPrice" DOUBLE PRECISION,
    "plannedEntry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "target" DOUBLE PRECISION,
    "pendingAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeState_pkey" PRIMARY KEY ("analysisId"),
    CONSTRAINT "TradeState_status_check" CHECK ("status" IN ('suggested', 'pending_order', 'in_trade', 'closed', 'cancelled', 'expired')),
    CONSTRAINT "TradeState_closeReason_check" CHECK ("closeReason" IS NULL OR "closeReason" IN ('target_hit', 'stop_hit', 'breakeven', 'manual', 'invalidated', 'cancelled')),
    CONSTRAINT "TradeState_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "TradeState_userId_status_idx" ON "tickrify"."TradeState"("userId", "status")',
  `CREATE TABLE IF NOT EXISTS "tickrify"."TradeCheck" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "currentPrice" DOUBLE PRECISION,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeCheck_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeCheck_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "TradeCheck_analysisId_createdAt_idx" ON "tickrify"."TradeCheck"("analysisId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "TradeCheck_userId_isFree_createdAt_idx" ON "tickrify"."TradeCheck"("userId", "isFree", "createdAt")',
];

const DAY_MS = 24 * 60 * 60 * 1000;

export type TradeView = {
  analysisId: string;
  status: TradeStatus;
  direction: Direction;
  symbol: string | null;
  timeframe: string | null;
  entryPrice: number | null;
  plannedEntry: number | null;
  stopLoss: number | null;
  target: number | null;
  closeReason: CloseReason | null;
  timeline: TradeTimelineEntry[];
  checks: Array<{ id: string; createdAt: string; currentPrice: number | null; result: ManagementResult }>;
  checksLeft: number;
  analysisCreatedAt: string;
};

type AnalysisPlan = {
  id: string;
  createdAt: Date;
  direction: Direction;
  symbol: string | null;
  timeframe: string | null;
  entry: number | null;
  entryType: string | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  invalidationLevel: number | null;
  thesis: string | null;
};

type StateRow = {
  analysisId: string;
  status: TradeStatus;
  direction: Direction;
  symbol: string | null;
  timeframe: string | null;
  entryPrice: number | null;
  plannedEntry: number | null;
  stopLoss: number | null;
  target: number | null;
  pendingAt: Date | null;
  closeReason: CloseReason | null;
  timeline: TradeTimelineEntry[];
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export function tradeError(code: string, message: string, status = HttpStatus.BAD_REQUEST): HttpException {
  return new HttpException({ code, message }, status);
}

@Injectable()
export class TradesService implements OnModuleInit {
  private readonly logger = new Logger(TradesService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: AIAdapter,
    private readonly ticks: TicksService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[trades] Tabelas prontas.');
      await this.warnStalePending();
    } catch (error) {
      this.logger.warn(`[trades] Tabelas indisponiveis (estado da operacao desligado): ${error instanceof Error ? error.message : error}`);
    }
  }

  /** So avisa: idade nao prova que a execucao parou, nada e restituido aqui. */
  private async warnStalePending(): Promise<void> {
    try {
      const [row] = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM "tickrify"."TradeCheck"
          WHERE "result" = 'null'::jsonb AND "createdAt" < NOW() - INTERVAL '10 minutes'`,
      );
      if (row?.n) this.logger.warn(`[trades] ${row.n} checagem(ns) pendente(s) ha mais de 10 min: conferir com scripts/reconcile-trade-check.cjs`);
    } catch {
      // Aviso opcional: nunca derruba o boot.
    }
  }

  private assertReady(): void {
    if (!this.ready) throw tradeError('trades_unavailable', 'Trade tracking is temporarily unavailable.', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** Plano da analise (so BUY/SELL concluida da propria pessoa). */
  private async plan(userId: string, analysisId: string): Promise<AnalysisPlan> {
    const row = await this.prisma.analysis.findFirst({
      where: { id: analysisId, userId },
      select: { id: true, createdAt: true, status: true, recommendation: true, result: true },
    });
    if (!row) throw tradeError('analysis_not_found', 'Analysis not found', HttpStatus.NOT_FOUND);
    const rec = String(row.recommendation || '').toUpperCase();
    const direction: Direction | null = rec === 'BUY' || rec === 'COMPRA' ? 'BUY' : rec === 'SELL' || rec === 'VENDA' ? 'SELL' : null;
    if (row.status !== 'completed' || !direction) {
      throw tradeError('not_a_trade', 'Only a completed BUY or SELL analysis can be tracked as a trade.');
    }
    const result = (row.result ?? {}) as Record<string, unknown>;
    const a = ((result.analysis ?? result) ?? {}) as Record<string, unknown>;
    const pick = (k: string) => num(a[k]) ?? num(result[k]);
    const text = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : typeof result[k] === 'string' ? (result[k] as string) : null);
    return {
      id: row.id,
      createdAt: row.createdAt,
      direction,
      symbol: text('symbol') ? normalizeSymbol(text('symbol') as string) : null,
      timeframe: text('timeframe'),
      entry: pick('entry'),
      entryType: text('entryType'),
      stopLoss: pick('stopLoss'),
      takeProfit1: pick('takeProfit1'),
      takeProfit2: pick('takeProfit2'),
      invalidationLevel: pick('invalidationLevel'),
      thesis: text('executiveSummary') ?? text('reasoning'),
    };
  }

  private async readState(analysisId: string): Promise<StateRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "analysisId", "status", "direction", "symbol", "timeframe", "entryPrice", "plannedEntry", "stopLoss",
              "target", "pendingAt", "closeReason", "timeline"
         FROM "tickrify"."TradeState" WHERE "analysisId" = $1`,
      analysisId,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      analysisId: String(r.analysisId),
      status: r.status as TradeStatus,
      direction: r.direction as Direction,
      symbol: (r.symbol as string | null) ?? null,
      timeframe: (r.timeframe as string | null) ?? null,
      entryPrice: num(r.entryPrice),
      plannedEntry: num(r.plannedEntry),
      stopLoss: num(r.stopLoss),
      target: num(r.target),
      pendingAt: r.pendingAt ? new Date(r.pendingAt as string) : null,
      closeReason: (r.closeReason as CloseReason | null) ?? null,
      timeline: Array.isArray(r.timeline) ? (r.timeline as TradeTimelineEntry[]) : [],
    };
  }

  /** Ordem pendente esquecida vira `expired` (e "entrada nao atingida" no resultado). */
  private async expireIfStale(userId: string, state: StateRow, now = new Date()): Promise<StateRow> {
    if (state.status !== 'pending_order' || !state.pendingAt) return state;
    if (now.getTime() - state.pendingAt.getTime() < TRADE_RULES.pendingOrderExpiryDays * DAY_MS) return state;
    const timeline = await this.write(userId, state.analysisId, { status: 'expired', closeReason: 'cancelled' }, state, now);
    return { ...state, status: 'expired', closeReason: 'cancelled', timeline };
  }

  /** Grava estado + linha do tempo e o resultado antigo junto. */
  private async write(
    userId: string,
    analysisId: string,
    next: { status: TradeStatus; entryPrice?: number | null; closeReason?: CloseReason | null },
    previous: StateRow | null,
    now: Date,
    plan?: AnalysisPlan,
    options: { syncVerdict?: boolean } = {},
  ): Promise<TradeTimelineEntry[]> {
    const entry: TradeTimelineEntry = {
      status: next.status,
      at: now.toISOString(),
      ...(next.entryPrice !== undefined ? { entryPrice: next.entryPrice } : {}),
      ...(next.closeReason ? { closeReason: next.closeReason } : {}),
    };
    const timeline = [...(previous?.timeline ?? []), entry].slice(-50);
    const closed = next.status === 'closed' || next.status === 'cancelled' || next.status === 'expired';
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "tickrify"."TradeState" ("analysisId", "userId", "status", "direction", "symbol", "timeframe",
          "entryPrice", "plannedEntry", "stopLoss", "target", "pendingAt", "openedAt", "closedAt", "closeReason", "timeline")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          CASE WHEN $3 = 'pending_order' THEN $11::timestamp(3) END,
          CASE WHEN $3 = 'in_trade' THEN $11::timestamp(3) END,
          CASE WHEN $12 THEN $11::timestamp(3) END, $13, $14::jsonb)
       ON CONFLICT ("analysisId") DO UPDATE SET
          "status" = EXCLUDED."status",
          "entryPrice" = COALESCE(EXCLUDED."entryPrice", "TradeState"."entryPrice"),
          "pendingAt" = CASE WHEN EXCLUDED."status" = 'pending_order' THEN $11::timestamp(3) ELSE "TradeState"."pendingAt" END,
          "openedAt" = CASE WHEN EXCLUDED."status" = 'in_trade' THEN COALESCE("TradeState"."openedAt", $11::timestamp(3)) ELSE "TradeState"."openedAt" END,
          "closedAt" = CASE WHEN $12 THEN $11::timestamp(3) ELSE NULL END,
          "closeReason" = EXCLUDED."closeReason",
          "timeline" = EXCLUDED."timeline",
          "updatedAt" = NOW()`,
      analysisId,
      userId,
      next.status,
      previous?.direction ?? plan?.direction ?? 'BUY',
      previous?.symbol ?? plan?.symbol ?? null,
      previous?.timeframe ?? plan?.timeframe ?? null,
      next.entryPrice ?? null,
      previous?.plannedEntry ?? plan?.entry ?? null,
      previous?.stopLoss ?? plan?.stopLoss ?? null,
      previous?.target ?? plan?.takeProfit1 ?? null,
      now,
      closed,
      next.closeReason ?? null,
      JSON.stringify(timeline),
    );
    if (options.syncVerdict === false) return timeline;
    const verdict = verdictFor(next.status, next.closeReason ?? null);
    if (verdict === undefined) return timeline;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "tickrify"."Analysis" SET "userVerdict" = $3, "closedAt" = $4 WHERE "id" = $1 AND "userId" = $2`,
        analysisId,
        userId,
        verdict,
        verdict && verdict !== 'open' ? now : null,
      );
    } catch (error) {
      this.logger.warn(`[trades] Resultado antigo nao sincronizado: ${error instanceof Error ? error.message : error}`);
    }
    return timeline;
  }

  /** Marca o estado (Order pending / I'm in this trade / Close trade / cancelar ordem). */
  async mark(
    userId: string,
    analysisId: string,
    input: { status: MarkableStatus; entryPrice?: number | null; closeReason?: CloseReason | null },
  ): Promise<TradeView> {
    this.assertReady();
    const plan = await this.plan(userId, analysisId);
    const previous = await this.readState(analysisId);
    if (input.status === 'closed' && !input.closeReason) {
      throw new BadRequestException('closeReason is required to close a trade');
    }
    if (input.status === 'cancelled' && previous?.status === 'in_trade') {
      throw new BadRequestException('An open trade is closed, not cancelled');
    }
    const now = new Date();
    const closeReason = input.status === 'closed' ? input.closeReason ?? null : input.status === 'cancelled' ? 'cancelled' : null;
    await this.write(userId, analysisId, { status: input.status, entryPrice: input.entryPrice ?? null, closeReason }, previous, now, plan);

    const event =
      input.status === 'pending_order'
        ? 'trade_marked_pending'
        : input.status === 'in_trade'
          ? 'trade_marked_open'
          : 'trade_closed';
    void trackUserActivity(this.prisma, userId, event, {
      analysisId,
      symbol: plan.symbol,
      direction: plan.direction,
      ...(event === 'trade_closed' ? { close_reason: closeReason } : {}),
      ...(input.status === 'in_trade' ? { has_entry_price: input.entryPrice != null } : {}),
    });
    return this.view(userId, analysisId);
  }

  /** Resultado marcado pelo My Trades/diario: o estado acompanha (sem gravar o resultado de volta). */
  async syncFromVerdict(userId: string, analysisId: string, verdict: string | null): Promise<void> {
    if (!this.ready) return;
    try {
      const previous = await this.readState(analysisId);
      const next = stateForVerdict(verdict);
      if (!previous && next.status === 'suggested') return;
      if (previous?.status === next.status && previous.closeReason === next.closeReason) return;
      const plan = previous ? undefined : await this.plan(userId, analysisId).catch(() => undefined);
      if (!previous && !plan) return;
      await this.write(userId, analysisId, next, previous, new Date(), plan, { syncVerdict: false });
    } catch (error) {
      this.logger.warn(`[trades] Estado nao sincronizado com o resultado: ${error instanceof Error ? error.message : error}`);
    }
  }

  async view(userId: string, analysisId: string): Promise<TradeView> {
    this.assertReady();
    const plan = await this.plan(userId, analysisId);
    let state = await this.readState(analysisId);
    if (state) state = await this.expireIfStale(userId, state);
    const checks = await this.prisma.$queryRawUnsafe<Array<{ id: string; createdAt: Date; currentPrice: number | null; result: ManagementResult | null }>>(
      `SELECT "id", "createdAt", "currentPrice", "result" FROM "tickrify"."TradeCheck"
        WHERE "analysisId" = $1 AND "userId" = $2 ORDER BY "createdAt" DESC LIMIT 20`,
      analysisId,
      userId,
    );
    return {
      analysisId,
      status: state?.status ?? 'suggested',
      direction: plan.direction,
      symbol: plan.symbol,
      timeframe: plan.timeframe,
      entryPrice: state?.entryPrice ?? null,
      plannedEntry: plan.entry,
      stopLoss: plan.stopLoss,
      target: plan.takeProfit1,
      closeReason: state?.closeReason ?? null,
      timeline: state?.timeline ?? [],
      // JSON null reserves a check in flight; never expose it as an AI result.
      checks: checks.filter((c): c is typeof c & { result: ManagementResult } => c.result !== null).map((c) => ({
        id: c.id,
        createdAt: new Date(c.createdAt).toISOString(),
        currentPrice: num(c.currentPrice),
        result: c.result,
      })),
      checksLeft: Math.max(0, TRADE_RULES.maxChecksPerTrade - checks.length),
      analysisCreatedAt: plan.createdAt.toISOString(),
    };
  }

  /** Operacoes pendentes ou abertas dentro da janela, para a pergunta de follow-up. */
  async listOpen(userId: string): Promise<Array<{
    analysisId: string;
    status: TradeStatus;
    symbol: string | null;
    timeframe: string | null;
    direction: Direction;
    updatedAt: string;
  }>> {
    if (!this.ready) return [];
    const rows = await this.prisma.$queryRawUnsafe<Array<StateRow & { updatedAt: Date }>>(
      `SELECT "analysisId", "status", "direction", "symbol", "timeframe", "entryPrice", "plannedEntry", "stopLoss",
              "target", "pendingAt", "closeReason", "timeline", "updatedAt"
         FROM "tickrify"."TradeState"
        WHERE "userId" = $1 AND "status" IN ('pending_order', 'in_trade')
          AND "updatedAt" > NOW() - ($2 || ' days')::interval
        ORDER BY "updatedAt" DESC LIMIT 20`,
      userId,
      String(TRADE_RULES.followUpWindowDays),
    );
    const out = [];
    for (const raw of rows) {
      const state = await this.expireIfStale(userId, {
        ...raw,
        pendingAt: raw.pendingAt ? new Date(raw.pendingAt) : null,
        timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
      });
      if (!isOpenStatus(state.status)) continue;
      out.push({
        analysisId: state.analysisId,
        status: state.status,
        symbol: state.symbol,
        timeframe: state.timeframe,
        direction: state.direction,
        updatedAt: new Date(raw.updatedAt).toISOString(),
      });
    }
    return out;
  }

  /**
   * Grafico novo chegando: le o simbolo (barato, sem cota) e devolve as
   * operacoes abertas do MESMO ativo. Quem decide e o trader (a tela pergunta).
   */
  async matchOpen(userId: string, imageFile?: UploadedFile, base64Image?: string) {
    const open = await this.listOpen(userId);
    if (open.length === 0) return { symbol: null, matches: [] };
    const prepared = this.prepare(imageFile, base64Image);
    const symbol = await this.adapter.readChartSymbol(prepared.dataUrl).catch(() => null);
    const normalized = symbol ? normalizeSymbol(symbol) : null;
    return { symbol: normalized, matches: normalized ? open.filter((t) => sameAsset(t.symbol, normalized)) : [] };
  }

  private prepare(imageFile?: UploadedFile, base64Image?: string) {
    try {
      return prepareIncomingImage(imageFile, base64Image);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid image payload');
    }
  }

  /**
   * Checagem de gerenciamento. `paidAccess` vem do controller; quem nao assina
   * gasta da cota gratis (TRADE_RULES.managementCheckCost analises).
   */
  async check(
    userId: string,
    analysisId: string,
    input: { imageFile?: UploadedFile; base64Image?: string; currentPrice?: number | null; language?: string | null },
    paidAccess: boolean,
    blockedError: (quota: Awaited<ReturnType<typeof getFreeQuota>>) => HttpException,
  ): Promise<{ result: ManagementResult; view: TradeView }> {
    this.assertReady();
    const checkId = randomUUID();
    await admitTradeCheck(this.prisma, { id: checkId, userId,
      instance: `${process.env.RENDER_INSTANCE_ID || 'local'}:${process.pid}`, startedAt: new Date().toISOString() });
    try {
      return await this.checkAdmitted(userId, analysisId, input, paidAccess, blockedError, checkId);
    } finally {
      try { await finishTradeCheck(this.prisma, checkId); }
      catch { this.logger.error(`[trades] Check ticket ${checkId} could not be cleared; drain/recovery required.`); }
    }
  }

  private async checkAdmitted(
    userId: string,
    analysisId: string,
    input: { imageFile?: UploadedFile; base64Image?: string; currentPrice?: number | null; language?: string | null },
    paidAccess: boolean,
    blockedError: (quota: Awaited<ReturnType<typeof getFreeQuota>>) => HttpException,
    checkId: string,
  ): Promise<{ result: ManagementResult; view: TradeView }> {
    const plan = await this.plan(userId, analysisId);
    const state = await this.readState(analysisId).then((s) => (s ? this.expireIfStale(userId, s) : null));
    if (!state || !isOpenStatus(state.status)) {
      throw tradeError('trade_not_open', 'Mark the trade as pending or open before checking it.');
    }
    const used = await this.prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      'SELECT COUNT(*) AS n FROM "tickrify"."TradeCheck" WHERE "analysisId" = $1',
      analysisId,
    );
    if (Number(used[0]?.n ?? 0) >= TRADE_RULES.maxChecksPerTrade) {
      throw tradeError('trade_check_limit', `This trade already has ${TRADE_RULES.maxChecksPerTrade} checks.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const cost = TRADE_RULES.managementCheckCost;
    if (paidAccess) {
      if ((await this.ticks.getBalance(userId)) < cost) {
        throw tradeError('INSUFFICIENT_TICKS', 'Not enough ticks for a trade check.', HttpStatus.PAYMENT_REQUIRED);
      }
    } else {
      const quota = await getFreeQuota(this.prisma, userId);
      if (quota.exhausted) throw blockedError(quota);
    }

    const prepared = this.prepare(input.imageFile, input.base64Image);
    const imageUrl = await this.upload(userId, prepared);
    const currentPrice = num(input.currentPrice ?? null);

    let result: ManagementResult;
    try {
      // Also compensate if the reservation committed but its acknowledgement
      // was lost: in that case no model request has started yet.
      await this.reserveCheck(userId, analysisId, checkId, paidAccess, imageUrl, currentPrice, blockedError);
      result = await this.adapter.manageTrade(imageUrl, {
        direction: plan.direction,
        status: state.status as 'pending_order' | 'in_trade',
        symbol: plan.symbol,
        timeframe: plan.timeframe,
        plannedEntry: plan.entry,
        entryType: plan.entryType,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        invalidationLevel: plan.invalidationLevel,
        thesis: plan.thesis,
        entryPrice: state.entryPrice,
        hoursSinceAnalysis: (Date.now() - plan.createdAt.getTime()) / 3_600_000,
        currentPrice,
        language: input.language || 'en',
      });
      const saved = await this.prisma.$executeRawUnsafe(
        `UPDATE "tickrify"."TradeCheck" SET "result" = $3::jsonb
          WHERE "id" = $1 AND "userId" = $2 AND "result" = 'null'::jsonb`,
        checkId,
        userId,
        JSON.stringify(result),
      );
      if (saved !== 1) throw tradeError('trade_check_unavailable', 'Trade check could not be saved.', HttpStatus.SERVICE_UNAVAILABLE);
    } catch (error) {
      try {
        await this.releaseCheck(userId, checkId);
      } catch {
        // Keep the reservation if compensation cannot commit. Never grant
        // another AI call or credit based on an unconfirmed refund.
        this.logger.error(`[trades] Could not release check ${checkId}; reconciliation required.`);
      }
      throw error;
    }
    void trackUserActivity(this.prisma, userId, 'trade_management_requested', {
      analysisId,
      situation: result.situation,
      action: result.action,
      status: state.status,
      decided_by_price: result.decidedByPrice,
      needs_current_price: result.needsCurrentPrice,
      paid: paidAccess,
    });
    return { result, view: await this.view(userId, analysisId) };
  }

  private async reserveCheck(
    userId: string,
    analysisId: string,
    checkId: string,
    paidAccess: boolean,
    imageUrl: string,
    currentPrice: number | null,
    blockedError: (quota: Awaited<ReturnType<typeof getFreeQuota>>) => HttpException,
  ): Promise<void> {
    // Share Serializable isolation with normal free-analysis reservations:
    // both endpoints must see the other's in-flight use of the same quota.
    // No upload or model request runs inside this short transaction.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const used = await tx.$queryRawUnsafe<Array<{ n: bigint | number }>>(
            'SELECT COUNT(*) AS n FROM "tickrify"."TradeCheck" WHERE "analysisId" = $1',
            analysisId,
          );
          if (Number(used[0]?.n ?? 0) >= TRADE_RULES.maxChecksPerTrade) {
            throw tradeError('trade_check_limit', `This trade already has ${TRADE_RULES.maxChecksPerTrade} checks.`, HttpStatus.TOO_MANY_REQUESTS);
          }
          const cost = TRADE_RULES.managementCheckCost;
          if (paidAccess) {
            const balance = await tx.userTicks.findUnique({ where: { userId }, select: { balance: true } });
            if ((balance?.balance ?? 0) < cost) {
              throw tradeError('INSUFFICIENT_TICKS', 'Not enough ticks for a trade check.', HttpStatus.PAYMENT_REQUIRED);
            }
            await this.ticks.debitTicks(userId, cost, 'Checagem de operacao', { analysisId, kind: 'trade_check', tradeCheckId: checkId }, tx);
          } else {
            const quota = await getFreeQuota(tx, userId);
            if (quota.exhausted) throw blockedError(quota);
          }
          // Reuse the existing JSONB column: JSON null means pending. This
          // consumes quota before AI without adding a schema or migration.
          await tx.$executeRawUnsafe(
            `INSERT INTO "tickrify"."TradeCheck" ("id", "analysisId", "userId", "isFree", "cost", "imageUrl", "currentPrice", "result")
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'null'::jsonb)`,
            checkId, analysisId, userId, !paidAccess, cost,
            imageUrl.startsWith('data:') ? null : imageUrl, currentPrice,
          );
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (error) {
        // Raw writes expose PostgreSQL serialization failures as P2010/40001;
        // model writes expose P2034. Both mean the transaction was aborted.
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
        if (!conflict) throw error;
        // Retry only transactions known to have rolled back, never AI calls.
        if (attempt >= 4) throw tradeError('trade_check_busy', 'Please try the trade check again.', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
  }

  private async releaseCheck(userId: string, checkId: string): Promise<void> {
    await releasePendingTradeCheck(this.prisma, userId, checkId);
  }

  private async upload(userId: string, prepared: ReturnType<typeof prepareIncomingImage>): Promise<string> {
    const storage = new ImageStorageClient();
    if (!storage.isConfigured()) return prepared.dataUrl;
    try {
      return await storage.uploadBuffer({
        buffer: prepared.buffer,
        mimeType: prepared.mimeType,
        extension: prepared.extension,
        pathPrefix: `analyses/${userId}/trade-checks`,
      });
    } catch (error) {
      if (isProductionRuntime()) throw error;
      return prepared.dataUrl;
    }
  }
}
