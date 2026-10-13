import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { ReportsService, type ReportKind, type ReportStatus } from '../reports/reports.service';
import { SetFlagDto } from './dto/set-flag.dto';
import { SetReportStatusDto } from './dto/set-report-status.dto';
import { PrismaService } from '../database/prisma.service';
import { buildAcquisitionReport, parseDias } from './acquisition-report';
import { billingCycleForPriceId } from '../../config/stripe.config';
import { CampaignSendDto } from './dto/campaign-send.dto';
import { MailService } from '../mail/mail.service';
import { publicUrl } from '../mail/lifecycle-email';
import {
  CAMPAIGN_SEGMENTS,
  DEFAULT_SEND_SEGMENTS,
  campaignReport,
  countCampaign,
  renderCampaignEmail,
  sendCampaign,
  type CampaignDeps,
  type CampaignSegment,
} from '../mail/reactivation-campaign';

/**
 * Painel de administração — a "loja de apps" interna.
 *
 * `@UseGuards(AuthGuard, AdminGuard)` no nível da CLASSE de propósito: aqui a
 * omissão em um método novo custa caro demais para depender de alguém lembrar.
 * (O AuthGuard global já fecharia a rota, mas quem exige `role=admin` é o
 * AdminGuard, e ele NÃO é global.)
 */
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private readonly logger = new Logger(AdminController.name);
  /** Um disparo por vez neste processo: o segundo POST recebe 409. */
  private campaignRunning = false;

  private campaignDeps(): CampaignDeps {
    return {
      prisma: this.prisma,
      mail: this.mail,
      appUrl: publicUrl(process.env.FRONTEND_URL, 'https://tickrify.com'),
      apiBaseUrl: publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com'),
      log: (level, message) => this.logger[level](message),
    };
  }

  /**
   * Campanha de reativacao (05/10/2026), ver `reactivation-campaign.ts`.
   * GET conta quem receberia por grupo (nao grava nada); `preview` devolve o
   * e-mail de um grupo; POST `send` dispara em segundo plano e responde na hora.
   */
  @Get('campaigns/reactivation')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async campanhaContagem() {
    return { ...(await countCampaign(this.campaignDeps())), running: this.campaignRunning };
  }

  /** Quem recebeu e o que fez depois (analise, checkout, assinatura). */
  @Get('campaigns/reactivation/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async campanhaRelatorio() {
    return campaignReport(this.prisma);
  }

  @Get('campaigns/reactivation/preview')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  campanhaPrevia(@Query('segment') segment?: string) {
    if (!(CAMPAIGN_SEGMENTS as readonly string[]).includes(String(segment))) {
      throw new BadRequestException(`segment must be one of: ${CAMPAIGN_SEGMENTS.join(', ')}`);
    }
    const deps = this.campaignDeps();
    return renderCampaignEmail(segment as CampaignSegment, {
      appUrl: deps.appUrl,
      firstName: 'Alex',
      unsubscribeUrl: `${deps.apiBaseUrl}/api/email/unsubscribe?preview=1`,
    });
  }

  @Post('campaigns/reactivation/send')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  campanhaDisparo(@Body() body: CampaignSendDto) {
    if (this.campaignRunning) throw new ConflictException('Campaign is already running');
    const segments = (body.segments as CampaignSegment[] | undefined) ?? DEFAULT_SEND_SEGMENTS;
    this.campaignRunning = true;
    void sendCampaign(this.campaignDeps(), segments)
      .catch((err) => this.logger.warn(`[campaign] Falha: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        this.campaignRunning = false;
      });
    return { started: true, segments };
  }

  /**
   * Aba "Origem": de onde vem quem cadastra, analisa e assina (declarado pela
   * pessoa e primeiro toque tecnico). `dias` = 7, 30, 90 ou 0 (desde o inicio).
   */
  @Get('acquisition')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async origem(@Query('dias') dias?: string) {
    return buildAcquisitionReport(this.prisma, parseDias(dias));
  }

  /**
   * Aba "Cancelamentos" (13/10/2026): assinaturas da Stripe com cancelamento
   * agendado ou ja encerradas, com o motivo da lista fechada do portal, o
   * plano e o codigo do afiliado que indicou (se houver). Colunas de
   * cancelamento gravadas por SQL (fora do schema.prisma), por isso SQL aqui.
   */
  @Get('cancellations')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cancelamentos() {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        subscriptionId: string;
        email: string | null;
        status: string;
        priceId: string | null;
        cancelAtPeriodEnd: boolean;
        canceledAt: Date | null;
        cancelAt: Date | null;
        endedAt: Date | null;
        currentPeriodEnd: Date | null;
        cancelReason: string | null;
        cancelFeedback: string | null;
        createdAt: Date;
        affiliateCode: string | null;
      }>
    >(
      `SELECT s."stripeId" AS "subscriptionId", u."email", s."status", s."priceId", s."cancelAtPeriodEnd",
              s."canceledAt", s."cancelAt", s."endedAt", s."currentPeriodEnd", s."cancelReason", s."cancelFeedback",
              s."createdAt", a."referralCode" AS "affiliateCode"
         FROM "tickrify"."Subscription" s
         JOIN "tickrify"."User" u ON u."id" = s."userId"
         LEFT JOIN "tickrify"."AffiliateReferral" r ON r."userId" = s."userId"
         LEFT JOIN "tickrify"."Affiliate" a ON a."id" = r."affiliateId"
        WHERE s."stripeId" LIKE 'sub\\_%'
          AND (s."cancelAtPeriodEnd" = true OR s."status" = 'canceled')
        ORDER BY COALESCE(s."canceledAt", s."endedAt", s."updatedAt") DESC
        LIMIT 200`,
    );
    return rows.map((row) => ({
      ...row,
      billingCycle: billingCycleForPriceId(row.priceId),
      // Fim do acesso: o que ja aconteceu, ou o que esta agendado.
      accessEndsAt: row.endedAt ?? row.cancelAt ?? row.currentPeriodEnd,
    }));
  }

  /** Estado de todas as funções: valor, de onde veio e o que cada uma faz. */
  @Get('flags')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listarFlags() {
    return this.flags.listar();
  }

  /** Liga, desliga ou ajusta uma função. Grava quem mexeu. */
  @Patch('flags/:key')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async definirFlag(
    @CurrentUser() user: { id: string; clerkUserId: string },
    @Param('key') key: string,
    @Body() body: SetFlagDto,
  ) {
    return this.flags.definir(key, body.value, user);
  }

  /** Remove o override e devolve o controle para a variável de ambiente. */
  @Delete('flags/:key')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async limparFlag(
    @CurrentUser() user: { id: string; clerkUserId: string },
    @Param('key') key: string,
  ) {
    return this.flags.limpar(key, user);
  }

  /** Força releitura do banco — útil para conferir o que o worker vai ver. */
  @Post('flags/recarregar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async recarregar() {
    const ok = await this.flags.recarregar();
    return { recarregado: ok, ...this.flags.listar() };
  }

  // ── Relatos de problema (item 8) ──────────────────────────────────────────

  /** Caixa de entrada dos relatos, com a contagem por estado. */
  @Get('reports')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listarRelatos(@Query('status') status?: string, @Query('kind') kindRaw?: string) {
    const filtro = (status && status !== 'todos' ? status : undefined) as ReportStatus | undefined;
    // Problemas e opinioes (quadrinho do painel) ficam em abas separadas.
    const kind: ReportKind = kindRaw === 'feedback' ? 'feedback' : 'problem';
    const [itens, contagem] = await Promise.all([
      this.reports.listar(filtro, 50, kind),
      this.reports.contarPorStatus(kind),
    ]);
    return { itens, contagem };
  }

  /** aberto → investigando → resolvido | descartado. */
  @Patch('reports/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async definirStatusRelato(@Param('id') id: string, @Body() body: SetReportStatusDto) {
    await this.reports.definirStatus(id, body.status);
    return { id, status: body.status };
  }
}
