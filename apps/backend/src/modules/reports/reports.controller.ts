import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

/**
 * Botão de reportar problema — o lado do usuário.
 *
 * Exige sessão. Relato anônimo é canal de spam, e todo usuário que consegue
 * usar o produto — inclusive no plano grátis — tem conta. A demo anônima da
 * /try é a exceção conhecida e fica de fora por enquanto.
 *
 * O `@UseGuards(AuthGuard)` é redundante com o guard global e está aqui de
 * propósito (defesa em profundidade). Foi o teste route-access.spec que exigiu:
 * a regra do projeto é que toda rota declare acesso EXPLICITAMENTE, para que
 * ninguém precise saber de cor que existe um guard global.
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // 5 por hora por usuário. Não é sobre carga — é sobre o painel continuar
  // legível. Uma pessoa frustrada clicando 40 vezes esconde os outros relatos.
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async criar(
    @CurrentUser() user: { id: string; email?: string | null },
    @Body() body: CreateReportDto,
  ) {
    const { id, status } = await this.reports.criar({
      userId: user.id,
      userEmail: user.email,
      message: body.message,
      route: body.route,
      analysisId: body.analysisId,
      context: body.context,
    });

    // O protocolo devolvido não é enfeite: é o que o usuário cola numa conversa
    // depois ("mandei o relato X") e o que liga o e-mail do admin à linha no banco.
    return { id, status, mensagem: 'Relato recebido. Obrigado — isso ajuda de verdade.' };
  }
}
