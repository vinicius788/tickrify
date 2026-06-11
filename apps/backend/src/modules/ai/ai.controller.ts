import {
  Body,
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { PrismaService } from '../database/prisma.service';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ListAnalysesQueryDto } from './dto/list-analyses-query.dto';
import { SetOutcomeDto } from './dto/set-outcome.dto';
import { SetFavoriteDto } from './dto/set-favorite.dto';

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

    return this.aiService.listAnalyses(dbUserId, query.limit ?? 20);
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

  @Get('performance')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getPerformance(
    @CurrentUser() user: { id?: string; clerkUserId: string },
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getPerformance(dbUserId);
  }

  @Post('analyze/stream')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 } }),
  )
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  async analyzeStream(
    @CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null },
    @UploadedFile() file: UploadedFileType,
    @Body() body: CreateAnalysisDto,
    @Res() res: Response,
  ) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) {
      res.status(401).end();
      return;
    }

    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.aiService.streamAnalysis(
        dbUserId,
        file,
        body.base64Image,
        undefined, // SEGURANÇA: promptOverride nunca vem do cliente (ver endpoint analyze)
        body.analysisType,
        sendEvent,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro na análise.';
      sendEvent('error', { code: 'analysis_failed', message, retriable: false });
    } finally {
      res.end();
    }
  }

  /** Endpoint público — retorna as últimas 10 análises completadas, anonimizadas */
  @Get('public-analyses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getPublicAnalyses() {
    const rows = await this.prisma.analysis.findMany({
      where: { status: 'completed', recommendation: { not: null } },
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
        symbol: String(analysis?.symbol || 'N/A').trim(),
        timeframe: String(analysis?.timeframe || '').trim(),
        entry: analysis?.entry ?? null,
        stopLoss: analysis?.stopLoss ?? null,
        takeProfit1: analysis?.takeProfit1 ?? null,
        takeProfit2: analysis?.takeProfit2 ?? null,
      };
    });
  }

  @Get('usage')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getUsage(@CurrentUser() user: { id?: string; clerkUserId: string }) {
    const dbUserId = await this.resolveDbUserId(user);
    if (!dbUserId) throw new UnauthorizedException('Authenticated user not found');

    return this.aiService.getUsage(dbUserId);
  }
}
