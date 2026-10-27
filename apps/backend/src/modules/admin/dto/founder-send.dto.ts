import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional } from 'class-validator';
import { FOUNDER_MAX_PER_SEND } from '../../mail/founder-campaign';

/**
 * Disparo da campanha Founding Member. SEM `confirm: "SEND"` a chamada e uma
 * simulacao (so conta quem receberia): um POST por engano nao envia nada.
 * Decorator em TODO campo (ValidationPipe com `forbidNonWhitelisted`).
 */
export class FounderSendDto {
  @IsOptional()
  @IsIn(['SEND'])
  confirm?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FOUNDER_MAX_PER_SEND)
  @IsEmail({}, { each: true })
  emails!: string[];
}
