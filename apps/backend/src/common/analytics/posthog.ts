/**
 * Wrapper de PostHog para o backend (eventos server-side).
 *
 * BLINDADO: se a chave não existir OU o pacote `posthog-node` não estiver
 * instalado, vira no-op silencioso. O carregamento é PREGUIÇOSO (lazy require),
 * então a ausência do pacote NUNCA derruba o boot da aplicação — só na primeira
 * captura (quando um webhook chega), e mesmo aí qualquer erro é engolido.
 */
type PostHogLike = {
  capture: (args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
};

let client: PostHogLike | null | undefined;

function getClient(): PostHogLike | null {
  if (client !== undefined) return client;

  const key = String(process.env.POSTHOG_KEY || '').trim();
  if (!key) {
    client = null;
    return null;
  }

  try {
    // require dinâmico: se posthog-node não estiver instalado, cai no catch
    // e vira no-op — sem quebrar o boot nem o fluxo de negócio.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
): void {
  try {
    const c = getClient();
    if (!c || !distinctId) return;
    c.capture({ distinctId, event, properties });
  } catch {
    /* analytics nunca pode quebrar o fluxo de negócio */
  }
}
