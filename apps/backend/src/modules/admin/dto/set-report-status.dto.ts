import { IsIn, IsString } from 'class-validator';
import { REPORT_STATUSES, type ReportStatus } from '../../reports/reports.service';

export class SetReportStatusDto {
  /**
   * Máquina de estados fechada, validada em DOIS lugares de propósito: aqui
   * (devolve 400 legível) e por CHECK no banco (impede que qualquer outro
   * caminho de escrita crie um estado que nenhum filtro do painel encontra).
   */
  @IsString()
  @IsIn(REPORT_STATUSES as unknown as string[])
  status!: ReportStatus;
}
