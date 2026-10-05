import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
  ) {}

  /**
   * Aba "Origem": de onde vem quem cadastra, analisa e assina (declarado pela
   * pessoa e primeiro toque tecnico). `dias` = 7, 30, 90 ou 0 (desde o inicio).
   */
  @Get('acquisition')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async origem(@Query('dias') dias?: string) {
    return buildAcquisitionReport(this.prisma, parseDias(dias));
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
