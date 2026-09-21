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
import { AiService } from './ai.service';
import { PrismaService } from '../database/prisma.service';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ListAnalysesQueryDto } from './dto/list-analyses-query.dto';
import { SetOutcomeDto } from './dto/set-outcome.dto';
import { SetFavoriteDto } from './dto/set-favorite.dto';
import { SetStrategyDto } from './dto/set-strategy.dto';
import {
  AUTOMATIC_OUTCOMES,
  GROUNDING_LIVE_SINCE,
  confidenceBand,
  tally,
  type ConfidenceBand,
  type OutcomeRow,
} from './accuracy.util';
import { AB_V9_PROMPT_VER } from './ai.service';
import { normalizeSymbol } from '../../common/utils/analysis-normalizer';

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
        // SEGURANÇA: promptOverride NUNCA vem do cliente. Aceitá-lo permitiria
        // trocar o system prompt da plataforma e usar a OpenAI como ChatGPT
        // grátis (abuso de custo). O prompt é sempre resolvido server-side
        // (banco → arquivo). Forçamos undefined aqui, ignorando o campo do body.
        undefined,
        body.analysisType,
        body.userLanguage,
        htfImages,
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
      const analysis = (r.result as Record<string, unknown> | null)?.analysis as Record<string, unknown> | undefined;
      return {
        id: r.id,
        recommendation: r.recommendation,
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
   * Relatorio publico de acuracia — Fase 5 da auditoria de 24/07/2026.
   *
   * "Medimos nossa propria IA e publicamos os numeros feios" so funciona se o
   * numero for reproduzivel. Regras que este endpoint NAO pode quebrar:
   *  - so outcomes do sweeper automatico (ver AUTOMATIC_OUTCOMES; o veredicto
   *    manual do My Trades mora no mesmo campo em minusculas e e autorrelato);
   *  - todo recorte sai com n e intervalo de Wilson, nunca so a taxa;
   *  - recorte com n < 20 sai com publishable=false e o front mostra so o n.
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

    // O select devolve exatamente o shape de OutcomeRow — sem cast.
    const rows: OutcomeRow[] = await this.prisma.analysis.findMany({
      where: { outcome: { in: [...AUTOMATIC_OUTCOMES] }, isDemo: false, strategyHash: null },
      select: { outcome: true, confidence: true, createdAt: true, promptVer: true, model: true },
    });

    const breakdown: Record<string, number> = {};
    for (const row of rows) {
      const key = String(row.outcome);
      breakdown[key] = (breakdown[key] || 0) + 1;
    }

    const bands: ConfidenceBand[] = ['below60', 'band60to69', 'band70plus', 'unknown'];
    const byConfidence = bands.map((band) => ({
      band,
      ...tally(rows.filter((r) => confidenceBand(r.confidence) === band)),
    }));

    // Split pela data do deploy do grounding: mostra que a Tickrify mede as
    // proprias mudancas em vez de so anuncia-las.
    const byGrounding = {
      before: tally(rows.filter((r) => r.createdAt < GROUNDING_LIVE_SINCE)),
      after: tally(rows.filter((r) => r.createdAt >= GROUNDING_LIVE_SINCE)),
    };

    // A/B de prompt medido em PRODUÇÃO, com print real de usuário — o backtest
    // roda em gráfico renderizado, que é a limitação nº 1 do relatório interno.
    // promptVer -9 = perna v9 (ver AB_V9_PROMPT_VER em ai.service.ts).
    const withVer = rows as Array<(typeof rows)[number] & { promptVer: number | null; model: string | null }>;
    const byPrompt = {
      v9: tally(withVer.filter((r) => r.promptVer === AB_V9_PROMPT_VER)),
      current: tally(withVer.filter((r) => r.promptVer !== AB_V9_PROMPT_VER)),
    };

    // Corte por modelo: a migração gpt-4o-mini → gpt-5.6 é obrigatória até
    // 23/10/2026, e sem este corte não há como saber se a troca ajudou.
    const models = [...new Set(withVer.map((r) => r.model).filter(Boolean))] as string[];
    const byModel = models.map((m) => ({ model: m, ...tally(withVer.filter((r) => r.model === m)) }));

    const [waitCount, completedCount] = await Promise.all([
      this.prisma.analysis.count({
        where: { status: 'completed', isDemo: false, strategyHash: null, recommendation: { in: ['WAIT', 'HOLD', 'AGUARDAR'] } },
      }),
      this.prisma.analysis.count({
        where: { status: 'completed', isDemo: false, strategyHash: null, recommendation: { not: null } },
      }),
    ]);

    const payload = {
      updatedAt: new Date().toISOString(),
      groundingLiveSince: GROUNDING_LIVE_SINCE.toISOString(),
      overall: tally(rows),
      byConfidence,
      byGrounding,
      byPrompt,
      byModel,
      abstention: {
        wait: waitCount,
        total: completedCount,
        rate: completedCount > 0 ? Math.round((waitCount / completedCount) * 1000) / 10 : null,
      },
      breakdown,
    };

    this.accuracyCache = { at: Date.now(), payload };
    return payload;
  }

  @Get('usage')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getUsage(@CurrentUser() user: { id?: string; clerkUserId: string }) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getUsage(dbUserId);
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
}
