import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AnalysisType } from '../../ticks/tick-packages';

export class CreateAnalysisDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;

  // promptOverride foi REMOVIDO do contrato público de propósito: o prompt é
  // segredo de backend e jamais deve ser controlável pelo cliente. O controller
  // também força undefined; manter fora do DTO documenta e reforça a decisão.

  @IsOptional()
  @IsIn(['quick', 'deep'])
  analysisType?: AnalysisType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  userLanguage?: string;

  // Gráficos de timeframe maior (top-down) — opcionais.
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  htfBase64Image1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  htfBase64Image2?: string;

  // De onde veio a analise (06/10/2026). O site nao manda: ausente = site.
  // Simbolo e tempo grafico lidos da pagina pela extensao so sao GUARDADOS
  // (Analysis.clientContext); o motor nao os usa. Listas fechadas e regex
  // estreita: nada de texto livre do usuario chega ao banco por aqui.
  @IsOptional()
  @IsIn(['web', 'extension'])
  source?: 'web' | 'extension';

  @IsOptional()
  @IsIn(['tradingview', 'other'])
  platform?: 'tradingview' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9:._/!-]+$/)
  chartSymbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^[A-Za-z0-9]+$/)
  chartTimeframe?: string;
}
