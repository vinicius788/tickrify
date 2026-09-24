import { IsISO8601 } from 'class-validator';

/**
 * Intervalo do Diario (calendario do mes), ja no fuso do trader: o navegador
 * calcula o 1o dia do mes e o 1o dia do mes seguinte no horario local e manda
 * os dois em ISO. O limite de 45 dias e checado no service.
 *
 * Decorator em TODO campo: o ValidationPipe global roda com
 * `forbidNonWhitelisted`, e campo sem decorator faz o pipe rejeitar a
 * requisicao inteira (ver a secao do SetStrategyDto no CLAUDE.md).
 */
export class JournalQueryDto {
  @IsISO8601({ strict: true })
  from!: string;

  @IsISO8601({ strict: true })
  to!: string;
}
