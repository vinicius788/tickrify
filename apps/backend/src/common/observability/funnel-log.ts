/**
 * Log do funil de compra: UMA linha por etapa, sempre no mesmo formato, para
 * responder "onde este usuario parou?" sem adivinhar.
 *
 *   [funnel] stage=checkout_session_created user=cm... session=cs_live_... plan=starter
 *
 * Duas saidas:
 * 1. Log do Render: buscar por `[funnel]` ou por `user=<id>`.
 * 2. Banco (AdminAudit, action `funnel:<etapa>`), so para etapas de um usuario
 *    conhecido. O log do Render expira em dias; o banco nao. Consulta:
 *      SELECT "createdAt", action, details FROM tickrify."AdminAudit"
 *      WHERE "targetUserId" = '<id>' AND action LIKE 'funnel:%' ORDER BY "createdAt";
 *
 * SEGURANCA: so entram os campos da lista ALLOWED_FIELDS. Valor que parecer
 * chave (sk_, rk_, pk_, whsec_, Bearer) ou e-mail vira [redacted]. Nada de
 * cartao passa por aqui: a Tickrify nunca recebe dado de cartao (Checkout
 * hospedado da Stripe), e nenhum campo daqui carrega objeto de pagamento cru.
 */
import { Logger } from '@nestjs/common';

export type FunnelStage =
  | 'checkout_requested'
  | 'checkout_session_created'
  | 'checkout_session_reused'
  | 'checkout_failed'
  | 'checkout_returned'
  | 'webhook_received'
  | 'webhook_failed'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_created'
  | 'subscription_canceled';

const ALLOWED_FIELDS = [
  'user',
  'plan',
  'cycle',
  'source',
  'session',
  'subscription',
  'invoice',
  'event',
  'eventType',
  'status',
  'paymentStatus',
  'amount',
  'currency',
  'code',
  'declineCode',
  'attempt',
  'billingReason',
  'outcome',
  'paid',
  'reason',
  'requestId',
  'durationMs',
  'cancelAtPeriodEnd',
  // Metodos que a Stripe liberou na sessao (`card,link`) e a configuracao de
  // metodos do painel que ela usou (`pmc_...`): configuracao da conta, nao do
  // cliente.
  'paymentMethodTypes',
  'paymentMethodConfig',
  'message',
] as const;

export type FunnelFields = Partial<Record<(typeof ALLOWED_FIELDS)[number], string | number | boolean | null | undefined>>;

const SECRET_RE = /(sk|rk|pk)_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._-]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function sanitizeValue(value: unknown): string {
  return String(value)
    .replace(SECRET_RE, '[redacted]')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export function formatFunnelLine(stage: FunnelStage, fields: FunnelFields): string {
  const parts = [`stage=${stage}`];
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    const clean = sanitizeValue(value);
    parts.push(`${key}=${/\s/.test(clean) ? JSON.stringify(clean) : clean}`);
  }
  return `[funnel] ${parts.join(' ')}`;
}

/** Campos filtrados, para gravar no banco sem nada fora da lista. */
export function safeFunnelDetails(fields: FunnelFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = typeof value === 'string' ? sanitizeValue(value) : value;
  }
  return out;
}

type AuditWriter = {
  adminAudit: {
    create: (args: {
      data: { action: string; targetUserId: string; details: Record<string, string | number | boolean> };
    }) => PromiseLike<unknown>;
  };
};

const logger = new Logger('Funnel');

/**
 * Loga a etapa e, se `persist` vier com o banco e houver usuario, grava no
 * AdminAudit. Nunca lanca: observabilidade nao pode derrubar a compra.
 */
export function funnelLog(
  stage: FunnelStage,
  fields: FunnelFields,
  options: { level?: 'log' | 'warn' | 'error'; persist?: AuditWriter } = {},
): void {
  try {
    const line = formatFunnelLine(stage, fields);
    if (options.level === 'error') logger.error(line);
    else if (options.level === 'warn') logger.warn(line);
    else logger.log(line);

    const userId = typeof fields.user === 'string' ? fields.user : null;
    if (options.persist && userId) {
      void Promise.resolve(
        options.persist.adminAudit.create({
          data: { action: `funnel:${stage}`, targetUserId: userId, details: safeFunnelDetails(fields) },
        }),
      ).catch(() => undefined);
    }
  } catch {
    /* noop */
  }
}

/** Mensagem segura de um erro qualquer (Stripe, rede, Prisma). */
export function safeErrorFields(error: unknown): FunnelFields {
  const e = error as { type?: string; code?: string; decline_code?: string; message?: string; requestId?: string; statusCode?: number };
  return {
    code: e?.code ?? e?.type ?? (e?.statusCode ? String(e.statusCode) : undefined),
    declineCode: e?.decline_code,
    requestId: e?.requestId,
    message: e?.message,
  };
}
