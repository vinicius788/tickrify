/** Categorias estáveis para analytics; nunca envia mensagem ou conteúdo do gráfico. */
export class AnalysisProcessingError extends Error {
  readonly code: string;
  readonly details?: import('./i18n/messages').DisplayMessage[] | null;

  constructor(message: string, code?: string | null, details?: import('./i18n/messages').DisplayMessage[] | null) {
    super(message);
    this.name = 'AnalysisProcessingError';
    this.code = safeCode(code) ?? 'processing_failed_unclassified';
    this.details = details;
  }
}

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/i.test(value)
    ? value
    : null;
}

export function analysisFailureTelemetry(error: unknown): {
  code: string;
  stage: 'processing' | 'request' | 'client';
  httpStatus?: number;
} {
  if (error instanceof AnalysisProcessingError) {
    return { code: error.code, stage: 'processing' };
  }

  if (error && typeof error === 'object' && 'status' in error &&
      typeof error.status === 'number') {
    const status = Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
      ? error.status
      : undefined;
    const code = 'code' in error ? safeCode(error.code) : null;
    return {
      code: code ?? (status ? `http_${status}` : 'request_failed_unclassified'),
      stage: 'request',
      ...(status ? { httpStatus: status } : {}),
    };
  }

  return { code: 'client_unexpected', stage: 'client' };
}
