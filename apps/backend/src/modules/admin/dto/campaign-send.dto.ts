import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional } from 'class-validator';
import { CAMPAIGN_SEGMENTS } from '../../mail/reactivation-campaign';

/**
 * Disparo da campanha de reativacao. `confirm` tem que vir escrito "SEND":
 * um POST por engano (ou repetido do navegador) nao manda e-mail para a base.
 * Decorator em TODO campo (ValidationPipe com `forbidNonWhitelisted`).
 */
export class CampaignSendDto {
  @IsIn(['SEND'])
  confirm!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CAMPAIGN_SEGMENTS.length)
  @IsIn([...CAMPAIGN_SEGMENTS], { each: true })
  segments?: string[];
}
