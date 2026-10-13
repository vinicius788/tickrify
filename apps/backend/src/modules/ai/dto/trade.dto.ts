import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';
import { CLOSE_REASONS, MARKABLE_STATUSES, type CloseReason, type MarkableStatus } from '../../../common/trade-state';

/**
 * Estado da operacao (13/10/2026). Campos fechados: nada de texto livre.
 * ⚠️ Todo campo com decorator (ValidationPipe com whitelist + forbidNonWhitelisted).
 */
export class MarkTradeDto {
  @IsIn([...MARKABLE_STATUSES])
  status!: MarkableStatus;

  /** Preco real de entrada (I'm in this trade). */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  entryPrice?: number;

  @IsOptional()
  @IsIn([...CLOSE_REASONS])
  closeReason?: CloseReason;
}

/** Checagem de gerenciamento: multipart (a imagem vem em `image`), campos chegam como texto. */
export class CheckTradeDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;

  /** Preco atual digitado pelo trader (vence o que a IA le no grafico). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}([.,]\d{1,10})?$/)
  currentPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  userLanguage?: string;
}

/** Grafico novo: so a imagem, para ler o simbolo e achar operacao aberta do mesmo ativo. */
export class MatchTradeDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;
}
