import { Body, Controller, Get, OnModuleInit, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { fetchClerkEmail } from '../../common/utils/clerk-email';

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
