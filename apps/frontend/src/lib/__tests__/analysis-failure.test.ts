import { describe, expect, it } from 'vitest';
import { AnalysisProcessingError, analysisFailureTelemetry } from '../analysis-failure';

describe('analysisFailureTelemetry', () => {
  it('classifica falha concluída pelo worker sem inventar causa', () => {
    expect(analysisFailureTelemetry(new AnalysisProcessingError('Mensagem privada'))).toEqual({
      code: 'processing_failed_unclassified',
      stage: 'processing',
    });
  });

  it('preserva apenas códigos estruturados e status HTTP válidos', () => {
    expect(analysisFailureTelemetry({ status: 429, code: 'quota_exceeded', message: 'não enviar' })).toEqual({
      code: 'quota_exceeded',
      stage: 'request',
      httpStatus: 429,
    });
    expect(analysisFailureTelemetry({ status: 500, code: 'Internal Server Error' })).toEqual({
      code: 'http_500',
      stage: 'request',
      httpStatus: 500,
    });
  });

  it('não envia mensagem livre de erros inesperados nem código suspeito', () => {
    expect(analysisFailureTelemetry(new Error('prompt, imagem ou detalhe privado'))).toEqual({
      code: 'client_unexpected',
      stage: 'client',
    });
    expect(analysisFailureTelemetry(new AnalysisProcessingError('falhou', 'email=user@example.com'))).toEqual({
      code: 'processing_failed_unclassified',
      stage: 'processing',
    });
  });
});
