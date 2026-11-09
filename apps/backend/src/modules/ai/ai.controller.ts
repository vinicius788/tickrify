import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService, buildClientContext } from './ai.service';
import type { TrialContext } from './trial.service';
import { resolveClientIp } from '../../common/middleware/request-context.middleware';
import { PrismaService } from '../database/prisma.service';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ListAnalysesQueryDto } from './dto/list-analyses-query.dto';
import { JournalQueryDto } from './dto/journal-query.dto';
import { SetTradeNoteDto } from './dto/set-trade-note.dto';
import { SetOutcomeDto } from './dto/set-outcome.dto';
import { SetFavoriteDto } from './dto/set-favorite.dto';
import { SetStrategyDto } from './dto/set-strategy.dto';
import { Prisma } from '@prisma/client';
import {
  AUTOMATIC_OUTCOMES,
  CURRENT_ENGINE_MAJOR,
  CURRENT_ENGINE_SINCE,
  CURRENT_ENGINE_SQL,
  FILL_CANDLE_RULE,
  GROUNDING_LIVE_SINCE,
  MIN_N_TO_PUBLISH,
  PUBLIC_SCORED_OUTCOMES,
  averageResult,
  breakdownOf,
  confidenceBand,
  currentEngineReport,
  previousTradeR,
  splitByFillCandleRule,
  tally,
  type ConfidenceBand,
  type OutcomeRow,
} from './accuracy.util';
import { normalizeSymbol } from '../../common/utils/analysis-normalizer';
import { analysisInterval } from '../market/candle-store';
import { trackingWindowEnd } from '../../../worker/analysis-tracker';

type TrialRequest = { ip?: string; headers?: Record<string, string | string[] | undefined> };

/** Sinais da propria requisicao para o anti-abuso do trial. */
function trialContextFrom(req: TrialRequest): TrialContext {
  const single = (name: string) => {
    const value = req.headers?.[name];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
  return { ip: resolveClientIp(req), deviceId: single('x-tickrify-device'), userAgent: single('user-agent') };
}

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
  ) {}

  private async resolveDbUserId(user: { id?: string; clerkUserId: string }): Promise<string | undefined> {
    if (user.id) return user.id;
    const dbUser = await this.prisma.user.findUnique({
      where: { clerkUserId: user.clerkUserId },
      select: { id: true },
    });
    return dbUser?.id;
  }

  @Post('analyze')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024,
        // base64 dos timeframes maiores (top-down) vai em campos de texto;
        // ~10MB de imagem ≈ ~14MB em base64, então elevamos o limite por campo.
        fieldSize: 20 * 1024 * 1024,
      },
    }),
  )
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async analyze(
    @CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null },
    @UploadedFile() file: UploadedFileType,
    @Body() body: CreateAnalysisDto,
    @Req() req: TrialRequest,
  ) {
    try {
      const dbUserId = await this.resolveDbUserId(user);
      if (!dbUserId) throw new UnauthorizedException('Authenticated user could not be resolved');

      const htfImages = [body.htfBase64Image1, body.htfBase64Image2].filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      );

      const result = await this.aiService.createAnalysis(
        dbUserId,
        file,
        body.base64Image,
        body.analysisType,
        body.userLanguage,
        htfImages,
        buildClientContext(body),
        body.setupId ?? null,
        { ...trialContextFrom(req), timezone: body.timezone ?? null },
      );

      this.logger.log(`Analysis created: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.warn(
        `Analyze request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw error;
    }
  }

  @Get('analysis/:id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async getAnalysis(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getAnalysis(id, dbUserId);
  }

  @Get('analyses')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async listAnalyses(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Query() query: ListAnalysesQueryDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.listAnalyses(dbUserId, query.limit ?? 20, query.cursor ?? null);
  }

  /**
   * Diario (calendario do mes): analises concluidas no intervalo pedido, no
   * MESMO formato da lista paginada. O agrupamento por dia e feito no navegador,
   * no fuso do trader.
   */
  @Get('journal')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getJournal(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Query() query: JournalQueryDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.listAnalysesInRange(dbUserId, new Date(query.from), new Date(query.to));
  }

  @Patch('analysis/:id/outcome')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async setOutcome(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
    @Body() body: SetOutcomeDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.setOutcome(dbUserId, id, {
      outcome: body.outcome ?? null,
      pnlPercent: body.pnlPercent ?? null,
      pnlAmount: body.pnlAmount ?? null,
    });
  }

  @Patch('analysis/:id/favorite')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async setFavorite(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
    @Body() body: SetFavoriteDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.setFavorite(dbUserId, id, body.isFavorite === true);
  }

  @Patch('analysis/:id/note')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async setTradeNote(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
    @Body() body: SetTradeNoteDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.setTradeNote(dbUserId, id, body);
  }

  /** Escala do eixo para as linhas da extensao. Uma leitura de IA por analise, guardada. */
  @Get('analysis/:id/price-axis')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async getPriceAxis(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getPriceAxis(dbUserId, id);
  }

  @Get('strategy')
  @UseGuards(AuthGuard)
  async getStrategy(
    @CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null },
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) return { profile: null, paid: false };
    const paid = await this.aiService.hasPaidAccess(dbUserId);
    return { profile: await this.aiService.getStrategy(dbUserId), paid };
  }

  @Put('strategy')
  @UseGuards(AuthGuard)
  async setStrategy(
    @CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null },
    @Body() body: SetStrategyDto,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException();
    // Recurso pago. A checagem fica aqui, na escrita, e de novo no adapter na
    // hora de injetar: quem cancela a assinatura para de ter o bloco no prompt
    // mesmo que a linha continue no banco.
    if (!(await this.aiService.hasPaidAccess(dbUserId))) {
      throw new ForbiddenException({ code: 'paid_feature', message: 'Strategy profile requires a subscription.' });
    }
    return this.aiService.setStrategy(dbUserId, body);
  }

  /**
   * Endpoint PÚBLICO — vitrine das últimas análises completadas, anonimizadas.
   * Aberto porque a landing precisa dele para visitante deslogado. Não expõe
   * usuário nem imagem, e filtra isDemo:false.
   */
  @Public()
  @Get('public-analyses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getPublicAnalyses() {
    const rows = await this.prisma.analysis.findMany({
      // isDemo: false → análises da demo anônima nunca vazam para a vitrine.
      // strategyHash: null — a seção da landing se chama "The latest reads,
      // unfiltered" e promete que nada é escolhido a dedo. Uma leitura moldada
      // pelo perfil de um usuário não é uma leitura crua do motor. Entra aqui
      // pelo mesmo motivo que o isDemo: false já está.
      where: { status: 'completed', recommendation: { not: null }, isDemo: false, strategyHash: null },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        recommendation: true,
        confidence: true,
        createdAt: true,
        result: true,
      },
    });

    return rows.map((r) => {
      const result = r.result as Record<string, unknown> | null;
      const analysis = result?.analysis as Record<string, unknown> | undefined;
      const marketStructure = analysis?.marketStructure as Record<string, unknown> | undefined;
      const rawBias = result?.bias ?? marketStructure?.bias;
      const bias = typeof rawBias === 'string' && ['bullish', 'bearish', 'neutral'].includes(rawBias.toLowerCase())
        ? rawBias.toLowerCase()
        : null;
      return {
        id: r.id,
        recommendation: r.recommendation,
        bias,
        confidence: r.confidence,
        createdAt: r.createdAt,
        symbol: normalizeSymbol(analysis?.symbol),
        timeframe: String(analysis?.timeframe || '').trim(),
        entry: analysis?.entry ?? null,
        stopLoss: analysis?.stopLoss ?? null,
        takeProfit1: analysis?.takeProfit1 ?? null,
        takeProfit2: analysis?.takeProfit2 ?? null,
      };
    });
  }

  /**
   * Endpoint PÚBLICO — os últimos planos de trade que o sweeper já pontuou
   * (30/09/2026). É o recibo da vitrine: a lista "latest reads" só mostra
   * leituras com menos de 48h, que ainda não têm resultado; esta mostra o que o
   * mercado fez depois, na ordem em que foram pontuadas, ganhos e perdas juntos.
   *
   * Mesmas regras da vitrine e da /accuracy: só o outcome automático (nunca o
   * veredito do usuário), isDemo:false, strategyHash:null, sem usuário e sem
   * imagem. WAIT/ABSTAIN, UNTRACKABLE e INCOMPLETE ficam de fora porque não são
   * trade pontuável; NO_FILL e TIMEOUT entram, porque esconder isso seria
   * escolher a dedo.
   */
  @Public()
  @Get('public-analyses/scored')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getScoredPublicAnalyses() {
    const rows = await this.prisma.analysis.findMany({
      where: { outcome: { in: [...PUBLIC_SCORED_OUTCOMES] }, isDemo: false, strategyHash: null },
      orderBy: [{ outcomeAt: 'desc' }, { id: 'desc' }],
      take: 6,
      select: { id: true, recommendation: true, createdAt: true, outcome: true, outcomeAt: true, outcomeDetail: true, result: true },
    });

    return rows.map((r) => {
      const detail = (r.outcomeDetail ?? {}) as Record<string, unknown>;
      const result = r.result as Record<string, unknown> | null;
      const analysis = result?.analysis as Record<string, unknown> | undefined;
      const level = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
      return {
        id: r.id,
        recommendation: r.recommendation,
        createdAt: r.createdAt,
        outcome: r.outcome,
        outcomeAt: r.outcomeAt,
        symbol: normalizeSymbol(detail.symbol ?? analysis?.symbol),
        timeframe: String(analysis?.timeframe || '').trim(),
        // Os níveis vêm do outcomeDetail: são exatamente os que o sweeper usou.
        entry: level(detail.entry),
        stopLoss: level(detail.stopLoss),
        takeProfit1: level(detail.takeProfit1),
      };
    });
  }

  /**
   * Relatorio publico de acuracia — Fase 5 da auditoria de 24/07/2026.
   *
   * "Medimos nossa propria IA e publicamos os numeros feios" so funciona se o
   * numero for reproduzivel. Regras que este endpoint NAO pode quebrar:
   *  - so outcomes do sweeper automatico (ver AUTOMATIC_OUTCOMES; o veredicto
   *    manual do My Trades mora no mesmo campo em minusculas e e autorrelato);
   *  - todo recorte sai com n e intervalo de Wilson, nunca so a taxa;
   *  - recorte com n < 20 sai com publishable=false e o front mostra so o n;
   *  - motor anterior (`previous`, sweeper) e motor atual (`current`,
   *    rastreador, major >= 4) nunca se somam (04/11/2026).
   *
   * Cache em memoria de 1h: o Render roda no plano free, isto nao pode
   * recalcular a cada request. Sem dependencia nova.
   */
  private accuracyCache: { at: number; payload: unknown } | null = null;

  /**
   * Endpoint PÚBLICO — a página /accuracy é o diferencial do produto e precisa
   * abrir para quem não tem conta. Devolve só agregado (Wilson 95%), nunca
   * análise individual nem dado de usuário. Cache de 1h em memória.
   */
  @Public()
  @Get('accuracy')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getAccuracy() {
    const ONE_HOUR = 3_600_000;
    if (this.accuracyCache && Date.now() - this.accuracyCache.at < ONE_HOUR) {
      return this.accuracyCache.payload;
    }

    const current = Prisma.raw(CURRENT_ENGINE_SQL);
    const rewardTp1 = Prisma.sql`CASE
      WHEN jsonb_typeof(a."result"->'analysis'->'riskRewardTp1') = 'number' THEN (a."result"->'analysis'->>'riskRewardTp1')::float8
      WHEN jsonb_typeof(a."result"->'riskRewardTp1') = 'number' THEN (a."result"->>'riskRewardTp1')::float8
    END`;

    // Motor anterior (sem versao ou major < 4): tudo o que a pagina publicava,
    // com as mesmas regras, so que sem as analises do motor atual.
    const allRows = await this.prisma.$queryRaw<Array<OutcomeRow & { model: string | null; rewardTp1: number | null }>>(Prisma.sql`
      SELECT a."outcome", a."confidence", a."createdAt", a."model", a."outcomeDetail", ${rewardTp1} AS "rewardTp1"
      FROM "tickrify"."Analysis" a
      WHERE a."outcome" IN (${Prisma.join([...AUTOMATIC_OUTCOMES])})
        AND a."isDemo" = false AND a."strategyHash" IS NULL
        AND NOT (${current})
    `);
    // Regra do candle do fill (decisao de 20/10/2026): tudo que a resposta ja
    // tinha (overall e cortes) e calculado so com as linhas `legacy`, o historico
    // comparavel. As linhas `stop_only` vao so para `stopOnly`, sem se misturar.
    const { legacy: rows, stop_only: stopOnlyRows } = splitByFillCandleRule(allRows);

    const bands: ConfidenceBand[] = ['below60', 'band60to69', 'band70plus', 'unknown'];
    const byConfidence = bands.map((band) => ({
      band,
      ...tally(rows.filter((r) => confidenceBand(r.confidence) === band)),
    }));

    // Corte por modelo: a migração gpt-4o-mini → gpt-5.6 é obrigatória até
    // 23/10/2026, e sem este corte não há como saber se a troca ajudou.
    const models = [...new Set(rows.map((r) => r.model).filter(Boolean))] as string[];
    const byModel = models.map((m) => ({ model: m, ...tally(rows.filter((r) => r.model === m)) }));

    const [abst] = await this.prisma.$queryRaw<Array<{ wait: number; total: number }>>(Prisma.sql`
      SELECT count(*) FILTER (WHERE a."recommendation" IN ('WAIT', 'HOLD', 'AGUARDAR'))::int AS "wait", count(*)::int AS "total"
      FROM "tickrify"."Analysis" a
      WHERE a."status" = 'completed' AND a."isDemo" = false AND a."strategyHash" IS NULL
        AND a."recommendation" IS NOT NULL AND NOT (${current})
    `);
    const waitCount = Number(abst?.wait ?? 0);
    const completedCount = Number(abst?.total ?? 0);

    const overall = tally(rows);
    const previousTrades = rows.filter((r) => ['WIN', 'LOSS', 'TIMEOUT'].includes(String(r.outcome)));
    const previousR = previousTrades.flatMap((r) => {
      const t = previousTradeR(r);
      return t ? [t] : [];
    });
    const firstRecord = allRows.reduce<Date | null>((min, r) => (!min || r.createdAt < min ? r.createdAt : min), null);

    const previous = {
      firstRecordAt: firstRecord ? firstRecord.toISOString() : null,
      groundingLiveSince: GROUNDING_LIVE_SINCE.toISOString(),
      overall,
      byConfidence,
      // Split pela data do deploy do grounding: mostra que a Tickrify mede as
      // proprias mudancas em vez de so anuncia-las.
      byGrounding: {
        before: tally(rows.filter((r) => r.createdAt < GROUNDING_LIVE_SINCE)),
        after: tally(rows.filter((r) => r.createdAt >= GROUNDING_LIVE_SINCE)),
      },
      byModel,
      abstention: {
        wait: waitCount,
        total: completedCount,
        rate: completedCount > 0 ? Math.round((waitCount / completedCount) * 1000) / 10 : null,
      },
      breakdown: breakdownOf(rows),
      // `stopOnly`: a serie da regra nova do candle do fill, a parte (nunca somada
      // ao overall). `methodology`: qual regra cada serie usa.
      stopOnly: { overall: tally(stopOnlyRows), breakdown: breakdownOf(stopOnlyRows) },
      methodology: { overall: 'legacy', stopOnly: 'stop_only', newEvaluations: FILL_CANDLE_RULE },
      // Resultado medio por trade em R (WIN = riskRewardTp1, LOSS = -1, TIMEOUT = 0),
      // so linhas legacy, antes de custos; sem R valido fica fora e conta em `excluded`.
      averageResult: averageResult(previousR, previousTrades.length - previousR.length),
    };

    // Motor atual: o rastreador (AnalysisTrack), nunca o sweeper. Tabela
    // indisponivel = `current: null` e a pagina diz que nao carregou.
    // Filtro proprio (04/11/2026, decisao do dono): gratis, trial e pago contam
    // (o motor e o mesmo para todos); fora a conta do dono (role admin ou
    // acesso manual `manual_%`) e analise com perfil de estrategia. A demo
    // anonima do /try nunca grava em "Analysis" (so em "DemoUsage").
    let currentReport: ReturnType<typeof currentEngineReport> | null = null;
    try {
      const raw = await this.prisma.$queryRaw<Array<{
        createdAt: Date; signalState: string | null; dataMode: string | null; symbol: string | null; reachProbability: number | null;
        watchPlan: unknown; groundingInterval: string | null; timeframe: string | null;
        trackStatus: string | null; trackOutcome: string | null; trackReason: string | null; touched: boolean | null;
        fillPrice: number | null; stopLoss: number | null; takeProfit1: number | null; trackSymbol: string | null;
      }>>(Prisma.sql`
        SELECT a."createdAt", a."result"->>'signalState' AS "signalState", a."result"->>'dataMode' AS "dataMode",
          COALESCE(a."result"->'analysis'->>'symbol', a."result"->>'symbol') AS "symbol",
          CASE WHEN jsonb_typeof(a."result"->'watchReach'->'probability') = 'number'
            THEN (a."result"->'watchReach'->>'probability')::float8 END AS "reachProbability",
          a."result"->'watchPlan' AS "watchPlan", a."groundingStats"->>'interval' AS "groundingInterval",
          a."result"->'analysis'->>'timeframe' AS "timeframe",
          t."status" AS "trackStatus", t."outcome" AS "trackOutcome", t."reason" AS "trackReason", t."touched", t."fillPrice", t."stopLoss", t."takeProfit1",
          t."symbol" AS "trackSymbol"
        FROM "tickrify"."Analysis" a
        LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
        WHERE a."status" = 'completed' AND a."strategyHash" IS NULL AND (${current})
          AND NOT EXISTS (SELECT 1 FROM "tickrify"."User" u WHERE u."id" = a."userId" AND u."role" = 'admin')
          AND NOT EXISTS (SELECT 1 FROM "tickrify"."Subscription" s WHERE s."userId" = a."userId" AND s."stripeId" LIKE 'manual_%')
      `);
      currentReport = currentEngineReport(raw.map((r) => ({
        createdAt: r.createdAt,
        signalState: r.signalState,
        dataMode: r.dataMode,
        symbol: r.symbol,
        reachProbability: r.reachProbability,
        windowEndMs: trackingWindowEnd(r.createdAt, r.watchPlan, r.symbol, analysisInterval(r.groundingInterval, r.timeframe)),
        track: r.trackStatus
          ? {
            status: r.trackStatus, outcome: r.trackOutcome, reason: r.trackReason, touched: Boolean(r.touched),
            symbol: r.trackSymbol ?? r.symbol, fillPrice: r.fillPrice, stopLoss: r.stopLoss, takeProfit1: r.takeProfit1,
          }
          : null,
      })));
    } catch (err) {
      this.logger.warn(`[accuracy] Motor atual indisponivel: ${err instanceof Error ? err.message : err}`);
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      // Filtros publicos de cada serie (a pagina os descreve na metodologia).
      filters: {
        previous: { isDemo: false, strategyHash: null },
        current: { freeTrialAndPaid: true, strategyHash: null, excludesOwnerAccount: true },
        minResolvedToPublish: MIN_N_TO_PUBLISH,
      },
      currentEngine: { major: CURRENT_ENGINE_MAJOR, since: CURRENT_ENGINE_SINCE.toISOString() },
      previous,
      current: currentReport,
    };

    this.accuracyCache = { at: Date.now(), payload };
    return payload;
  }

  @Get('usage')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getUsage(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Req() req: TrialRequest,
    @Query('tz') tz?: string,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    // `tz`: fuso do navegador para o trial (validado no servico).
    return this.aiService.getUsage(dbUserId, { ...trialContextFrom(req), timezone: typeof tz === 'string' ? tz : null });
  }

  /** Heatmap de consistência: análises por dia (últimos ~119 dias) do usuário. */
  @Get('activity')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getActivity(@CurrentUser() user: { id?: string; clerkUserId: string }) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getActivityHeatmap(dbUserId);
  }

  /** O que o mercado fez com os planos do proprio usuario nos ultimos 30 dias. */
  @Get('track-record')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getTrackRecord(@CurrentUser() user: { id?: string; clerkUserId: string }) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getTrackRecord(dbUserId);
  }
}
