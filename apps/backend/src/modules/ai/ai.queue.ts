import { Queue } from 'bullmq';

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

function isProductionRuntime(): boolean {
  const runtime = String(process.env.APP_ENV || process.env.NODE_ENV || 'development')
    .trim()
    .toLowerCase();
  return runtime === 'production';
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
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }
  
  return queueInstance;
}

export async function getAiQueueReadiness(): Promise<QueueReadiness> {
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
    await queue.waitUntilReady();
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

    return {
      required,
      configured,
      connected,
      workersCount,
      hasWorkers,
      ready,
      reason,
    };
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
