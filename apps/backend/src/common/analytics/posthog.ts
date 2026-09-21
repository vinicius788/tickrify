/**
 * Wrapper de PostHog para o backend (eventos server-side).
 *
 * BLINDADO: se a chave não existir OU o pacote `posthog-node` não estiver
 * instalado, vira no-op silencioso. O carregamento é PREGUIÇOSO (lazy require),
 * então a ausência do pacote NUNCA derruba o boot da aplicação — só na primeira
 * captura (quando um webhook chega), e mesmo aí qualquer erro é engolido.
 */
import { createHash } from 'crypto';

type PostHogLike = {
  capture: (args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    uuid?: string;
    timestamp?: Date;
  }) => void;
};

export type CaptureOptions = {
  /**
   * Identifica o FATO, nao a chamada (ex.: `payment_succeeded:in_123`). Vira o
   * uuid do evento. O PostHog descarta evento repetido com o mesmo uuid e o
   * mesmo timestamp, entao webhook reenviado ou worker que roda duas vezes
   * nao conta em dobro. Sem isto, 20 `subscription_activated` viraram 4
   * assinaturas no painel (medido em 21/09/2026).
   */
  dedupeKey?: string;
  /** Momento do fato. Obrigatorio para a deduplicacao valer: tem de ser estavel. */
  timestamp?: Date;
};

/** UUID deterministico (formato v5) a partir de uma chave de texto. */
export function uuidFromKey(key: string): string {
  const hex = createHash('sha1').update(`tickrify:${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

let client: PostHogLike | null | undefined;

function getClient(): PostHogLike | null {
  if (client !== undefined) return client;

  if (process.env.NODE_ENV === 'test' && process.env.POSTHOG_ENABLE_IN_TEST !== 'true') {
    client = null;
    return null;
  }

  const key = String(process.env.POSTHOG_KEY || '').trim();
  if (!key) {
    client = null;
    return null;
  }

  try {
    // require dinâmico: se posthog-node não estiver instalado, cai no catch
    // e vira no-op — sem quebrar o boot nem o fluxo de negócio.
     
    const mod = require('posthog-node') as {
      PostHog: new (key: string, options: Record<string, unknown>) => PostHogLike;
    };
    const host = String(process.env.POSTHOG_HOST || 'https://us.i.posthog.com').trim();
    // flushAt: 1 garante entrega imediata de eventos raros (ex.: receita).
    client = new mod.PostHog(key, { host, flushAt: 1, flushInterval: 0 });
  } catch {
    client = null;
  }

  return client;
}

/**
 * Captura um evento server-side. `distinctId` deve ser o MESMO id usado no
 * identify do frontend (o id do Clerk), para casar com o funil.
 */
export function captureServer(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
  options: CaptureOptions = {},
): void {
  try {
    const c = getClient();
    if (!c || !distinctId) return;
    c.capture({
      distinctId,
      event,
      properties: { ...properties, tracked_by: 'server' },
      ...(options.dedupeKey ? { uuid: uuidFromKey(options.dedupeKey) } : {}),
      ...(options.timestamp ? { timestamp: options.timestamp } : {}),
    });
  } catch {
    /* analytics nunca pode quebrar o fluxo de negócio */
  }
}
