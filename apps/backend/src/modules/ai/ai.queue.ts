import { Queue } from 'bullmq';
import { isProductionRuntime } from '../../common/utils/runtime-env';

let queueInstance: Queue | null = null;

function getRedisConnection() {
  if (process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      return {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379', 10),
        password: redisUrl.password || undefined,
        tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      return null;
    }
  }

  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };
  }

  return null;
}

export interface QueueReadiness {
  required: boolean;
  configured: boolean;
  connected: boolean;
  workersCount: number;
  hasWorkers: boolean;
  ready: boolean;
  reason: 'ok' | 'queue_required' | 'queue_unavailable' | 'worker_unavailable';
}

export function isQueueConfigured(): boolean {
  return Boolean(getRedisConnection());
}

/**
 * Get or create the AI queue instance.
 * Only creates a queue if Redis is configured.
 * Returns null in serverless environments without Redis.
 */
export function getAiQueue(): Queue | null {
  const redisConnection = getRedisConnection();
  if (!redisConnection) {
    return null;
  }

  // Lazy initialization
  if (!queueInstance) {
    queueInstance = new Queue('ai-analysis', {
      connection: redisConnection as any,
      defaultJobOptions: {
        attempts: 3,
        // Backoff: attempt 1=5s, attempt 2=30s, attempt 3=120s
        backoff: {
          type: 'custom',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }
  
  return queueInstance;
}

/**
 * Cache curto do resultado do readiness, OPT-IN.
 *
 * `getAiQueueReadiness` e chamado em TODA criacao de analise e faz tres
 * round-trips no Redis (waitUntilReady + ping + getWorkersCount) antes de a
 * analise sequer comecar. A resposta praticamente nunca muda entre duas
 * analises seguidas: worker cai ou sobe na escala de minutos, nao de segundos.
 *
 * O cache e opt-in de proposito. Quem pergunta para DECIDIR O CAMINHO da
 * analise (`ai.service`) aceita um dado de ate 15s, porque o pior caso e cair
 * no processamento sincrono, que e o fallback que ja existe. Quem pergunta
 * para RESPONDER SE O SERVICO ESTA SAO (`health.controller`) nao aceita: um
 * health check que responde com estado velho e um health check quebrado.
 *
 * Um resultado NEGATIVO nunca e cacheado, para que a volta do worker seja
 * percebida na hora e ninguem fique preso no caminho lento.
 */
const READINESS_CACHE_TTL_MS = 15_000;
let readinessCache: { value: QueueReadiness; at: number } | null = null;

export async function getAiQueueReadiness(
  options: { useCache?: boolean } = {},
): Promise<QueueReadiness> {
  if (options.useCache && readinessCache && Date.now() - readinessCache.at < READINESS_CACHE_TTL_MS) {
    return readinessCache.value;
  }

  const required = isProductionRuntime();
  const configured = isQueueConfigured();

  if (!configured) {
    return {
      required,
      configured,
      connected: false,
      workersCount: 0,
      hasWorkers: false,
      ready: !required,
      reason: required ? 'queue_required' : 'ok',
    };
  }

  const queue = getAiQueue();
  if (!queue) {
    return {
      required,
      configured,
      connected: false,
      workersCount: 0,
      hasWorkers: false,
      ready: false,
      reason: 'queue_unavailable',
    };
  }

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Queue connection timeout after 30s')), 30_000),
      ),
    ]);
    const client = await queue.client;
    const pong = await client.ping();
    const connected = String(pong).toUpperCase() === 'PONG';
    const workersCount = await queue.getWorkersCount();
    const hasWorkers = workersCount > 0;
    const ready = connected && (!required || hasWorkers);

    let reason: QueueReadiness['reason'] = 'ok';
    if (!connected) {
      reason = 'queue_unavailable';
    } else if (required && !hasWorkers) {
      reason = 'worker_unavailable';
    }

    const result: QueueReadiness = {
      required,
      configured,
      connected,
      workersCount,
      hasWorkers,
      ready,
      reason,
    };

    // So o estado saudavel entra no cache. Guardar "sem worker" faria o app
    // insistir no caminho sincrono por 15s depois de o worker ja ter voltado.
    if (result.ready) {
      readinessCache = { value: result, at: Date.now() };
    }

    return result;
  } catch {
    return {
      required,
      configured,
      connected: false,
      workersCount: 0,
      hasWorkers: false,
      ready: false,
      reason: 'queue_unavailable',
    };
  }
}
