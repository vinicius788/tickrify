import { IsIn } from 'class-validator';

/** POST /api/admin/trial/reactivation. Validado pelo ValidationPipe global (whitelist). */
export class GrantTrialReactivationDto {
  /** Confirmacao explicita: sem ela nada e concedido. */
  @IsIn(['GRANT'])
  confirm!: 'GRANT';
}
