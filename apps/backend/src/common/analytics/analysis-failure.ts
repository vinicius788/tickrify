/** Evento server-side de falha definitiva. Não envia mensagem, prompt ou imagem. */
import { captureServer } from './posthog';

type PrismaLike = {
  user: {
    findUnique: (args: { where: { id: string }; select: { clerkUserId: true } }) => Promise<{ clerkUserId: string } | null>;
  };
};

const CODES = new Set([
  'validation_failed',
  'openai_empty_content',
  'openai_invalid_json',
  'openai_truncated_response',
  'openai_refusal',
  'openai_billing',
  'openai_rate_limit',
  'openai_request_failed',
  'non_chart_image',
  'processing_unclassified',
]);

/** Nunca persiste ou envia uma mensagem de exceção como código analítico. */
export function safeAnalysisFailureCode(code: unknown): string {
  return typeof code === 'string' && CODES.has(code)
    ? code
    : 'processing_unclassified';
}

export function analysisFailureCodeForResponse(status: string, code: unknown): string | null {
  return status.toLowerCase() === 'failed' && typeof code === 'string' && code.length > 0
    ? safeAnalysisFailureCode(code)
    : null;
}

export async function trackAnalysisExecutionFailed(
  prisma: PrismaLike,
  params: {
    userId?: string;
    analysisId: string;
    analysisType: 'quick' | 'deep';
    code: unknown;
    createdAt: Date;
  },
): Promise<void> {
  if (!params.userId) return;
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { clerkUserId: true },
    });
    if (!user?.clerkUserId) return;
    captureServer(
      user.clerkUserId,
      'analysis_execution_failed',
      {
        analysisType: params.analysisType,
        code: safeAnalysisFailureCode(params.code),
      },
      {
        dedupeKey: `analysis_execution_failed:${params.analysisId}`,
        // Estável mesmo se o mesmo job for entregue de novo.
        timestamp: params.createdAt,
      },
    );
  } catch {
    /* analytics nunca interrompe análise nem reembolso */
  }
}
