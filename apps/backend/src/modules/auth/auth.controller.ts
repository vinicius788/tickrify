import { Body, Controller, Get, OnModuleInit, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { fetchClerkEmail } from '../../common/utils/clerk-email';
import { sendMetaEvent } from '../../common/analytics/meta-capi';

/** Sinal de cadastro para o Meta. Todo campo com decorator: o ValidationPipe rejeita o resto. */
export class AdsSignupDto {
  @IsBoolean()
  adsConsent!: boolean;

  @IsOptional()
  @Matches(/^fb\.\d\.\d{10,13}\.\d{3,20}$/)
  fbp?: string;

  @IsOptional()
  @Matches(/^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/)
  fbc?: string;
}

/** Cadastro so conta como "novo" para o Meta nas primeiras 24h da conta. */
const ADS_SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Origem declarada pelo proprio usuario.
 *
 * ⚠️ TODO campo PRECISA de decorator do class-validator. O ValidationPipe
 * global roda com `whitelist` e `forbidNonWhitelisted`, entao propriedade sem
 * decorator simplesmente NAO EXISTE para o pipe e a requisicao inteira e
 * rejeitada. Foi exatamente assim que o salvar do perfil de estrategia quebrou
 * 100% das vezes em producao, com typecheck e jest passando.
 *
 * Lista FECHADA de propósito: o `detail` e o unico texto livre, curto, e nunca
 * chega perto do prompt do motor.
 */
export class SetAcquisitionSourceDto {
  @IsIn(['chatgpt', 'other_ai', 'google', 'social', 'community', 'friend', 'ad', 'other'])
  source!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  detail?: string;
}

/**
 * Atribuicao tecnica capturada no primeiro toque do browser (UTM/referrer).
 * Campos fechados e curtos para caberem tambem em metadata da Stripe.
 */
export class SetTechnicalAttributionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  utmContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  utmTerm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  adsetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  adId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  clickId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  landingPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  landingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  referrerDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  capturedAt?: string;
}

@Controller('auth')
export class AuthController implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  /**
   * Garante as colunas de origem, de forma idempotente e sem nunca derrubar o
   * boot. Mesmo padrao das colunas do Analysis no AiService: em producao
   * `RUN_MIGRATIONS_ON_START=false`, entao a migracao Prisma sozinha nao basta.
   */
  async onModuleInit(): Promise<void> {
    const colunas = [
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionSource" TEXT',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionDetail" TEXT',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionAnsweredAt" TIMESTAMP(3)',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "firstTouchAttribution" JSONB',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "firstTouchAt" TIMESTAMP(3)',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "lastTouchAttribution" JSONB',
      'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "lastTouchAt" TIMESTAMP(3)',
    ];
    for (const sql of colunas) {
      try {
        await this.prisma.$executeRawUnsafe(sql);
      } catch {
        /* recurso de atribuicao fica indisponivel; o resto do app segue */
      }
    }
  }

  /**
   * Grava a origem uma vez. Nao sobrescreve resposta anterior: a primeira e a
   * que vale, e reenvio (aba duplicada, clique duplo) nao corrompe o dado.
   */
  @Post('acquisition-source')
  @UseGuards(AuthGuard)
  async setAcquisitionSource(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Body() body: SetAcquisitionSourceDto,
  ) {
    const where = user.id ? { id: user.id } : { clerkUserId: user.clerkUserId };
    const atual = await this.prisma.user.findUnique({
      where,
      select: { id: true, acquisitionSource: true },
    });
    if (!atual) return { ok: false };
    if (atual.acquisitionSource) return { ok: true, alreadyAnswered: true };

    await this.prisma.user.update({
      where: { id: atual.id },
      data: {
        acquisitionSource: body.source,
        acquisitionDetail: body.detail?.trim() || null,
        acquisitionAnsweredAt: new Date(),
      },
    });
    return { ok: true };
  }

  /**
   * Grava first-touch uma vez e last-touch sempre que houver novo dado tecnico.
   * Isto cobre signup/checkout mesmo quando PostHog/Meta Pixel nao carregam por
   * consentimento, sem depender de cookie de terceiro.
   */
  @Post('technical-attribution')
  @UseGuards(AuthGuard)
  async setTechnicalAttribution(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Body() body: SetTechnicalAttributionDto,
  ) {
    const attribution = this.normalizeTechnicalAttribution(body);
    if (!Object.keys(attribution).length) return { ok: true, empty: true };

    const where = user.id ? { id: user.id } : { clerkUserId: user.clerkUserId };
    const atual = await this.prisma.user.findUnique({
      where,
      select: { id: true, firstTouchAttribution: true },
    });
    if (!atual) return { ok: false };

    const capturedAt = this.parseAttributionDate(body.capturedAt) ?? new Date();
    await this.prisma.user.update({
      where: { id: atual.id },
      data: {
        ...(atual.firstTouchAttribution
          ? {}
          : {
              firstTouchAttribution: attribution,
              firstTouchAt: capturedAt,
            }),
        lastTouchAttribution: attribution,
        lastTouchAt: capturedAt,
      },
    });

    return { ok: true, firstTouchSaved: !atual.firstTouchAttribution };
  }

  /**
   * CompleteRegistration pela Conversions API. O navegador chama UMA vez,
   * logo depois do cadastro e so com aceite de cookies; o servidor confere que
   * a conta existe e e recente, e manda com o MESMO event_id do pixel
   * (signup_<id do Clerk>), entao o Meta conta um so.
   *
   * Por que nao no auth.guard, na criacao do usuario: la nao ha como saber se
   * a pessoa aceitou cookies de marketing, nem o fbp/fbc do navegador.
   */
  @Post('ads-signup')
  @UseGuards(AuthGuard)
  async adsSignup(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Body() body: AdsSignupDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    if (!body.adsConsent) return { sent: false, reason: 'no_consent' };
    const dbUser = await this.prisma.user.findUnique({
      where: user.id ? { id: user.id } : { clerkUserId: user.clerkUserId },
      select: { clerkUserId: true, email: true, createdAt: true },
    });
    if (!dbUser) return { sent: false, reason: 'unknown_user' };
    if (Date.now() - dbUser.createdAt.getTime() > ADS_SIGNUP_WINDOW_MS) return { sent: false, reason: 'not_new' };

    const ua = req.headers?.['user-agent'];
    const sent = await sendMetaEvent({
      eventName: 'CompleteRegistration',
      eventId: `signup_${dbUser.clerkUserId}`,
      eventTime: dbUser.createdAt,
      user: { externalId: dbUser.clerkUserId, email: dbUser.email },
      ads: {
        consent: true,
        fbp: body.fbp ?? null,
        fbc: body.fbc ?? null,
        ip: req.ip ?? null,
        userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null,
      },
    });
    return { sent };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null }) {
    let dbUser = await this.prisma.user.findUnique({
      where: user.id ? { id: user.id } : { clerkUserId: user.clerkUserId },
      include: {
        subscriptions: true,
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      },
    });

    if (!dbUser) {
      // Rede de segurança apenas: o AuthGuard roda antes deste handler em
      // TODA requisição autenticada (incluindo esta) e já faz o
      // find-then-create de verdade — é lá que mora a criação real do
      // usuário e o disparo do e-mail de boas-vindas (ver auth.guard.ts,
      // 14/09/2026). Se ainda assim chegarmos aqui sem dbUser, algo bem
      // incomum aconteceu; criamos sem reenviar boas-vindas para não duplicar.
      dbUser = await this.prisma.user.create({
        data: {
          clerkUserId: user.clerkUserId,
          email: user.email || undefined,
        },
        include: {
          subscriptions: true,
          analyses: true
        },
      });
    } else if (!dbUser.email) {
      // Conta existente sem e-mail (criada antes do backfill existir) →
      // preenche silenciosamente, sem reenviar boas-vindas.
      void this.backfillEmailAndWelcome(dbUser.id, user.clerkUserId, false);
    }

    return dbUser;
  }

  private normalizeTechnicalAttribution(body: SetTechnicalAttributionDto): Record<string, string> {
    const fields: Array<keyof SetTechnicalAttributionDto> = [
      'utmSource',
      'utmMedium',
      'utmCampaign',
      'utmContent',
      'utmTerm',
      'campaignId',
      'adsetId',
      'adId',
      'clickId',
      'landingPath',
      'landingUrl',
      'referrer',
      'referrerDomain',
    ];

    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = typeof body[field] === 'string' ? body[field]!.trim() : '';
      if (value) out[field] = value;
    }
    return out;
  }

  private parseAttributionDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Busca o e-mail na API do Clerk e persiste no User. Fire-and-forget:
   * roda fora do caminho da resposta e nunca propaga erro (e-mail jamais
   * pode quebrar o fluxo de auth).
   */
  private async backfillEmailAndWelcome(
    userId: string,
    clerkUserId: string,
    isNewUser: boolean,
  ): Promise<void> {
    try {
      const email = await fetchClerkEmail(clerkUserId);
      if (!email) return;

      await this.prisma.user.update({ where: { id: userId }, data: { email } });

      if (isNewUser) {
        await this.mail.sendWelcome(email);
      }
    } catch {
      // best-effort — sem log barulhento; o MailService já loga falha de envio
    }
  }
}
