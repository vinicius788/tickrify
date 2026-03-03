import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getAiQueueReadiness } from '../ai/ai.queue';
import { hasValidOpenAiKey } from '../../common/utils/ai-runtime';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { OpsTokenGuard } from './ops-token.guard';

type ReadinessItem = {
  required: boolean;
  configured: boolean;
  ready: boolean;
};

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  getLiveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @UseGuards(OpsTokenGuard)
  async getReadiness() {
    const databaseReady = this.prisma.isReady() && (await this.prisma.checkConnection());
    const queue = await getAiQueueReadiness();
    const runtimeProduction = isProductionRuntime();
    const queueReady = queue.ready;
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const authConfigured = Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY);
    const storageConfigured = Boolean(process.env.SUPABASE_URL && supabaseServiceKey);
    const aiConfigured = hasValidOpenAiKey();

    const auth: ReadinessItem = {
      required: runtimeProduction,
      configured: authConfigured,
      ready: !runtimeProduction || authConfigured,
    };
    const storage: ReadinessItem = {
      required: runtimeProduction,
      configured: storageConfigured,
      ready: !runtimeProduction || storageConfigured,
    };
    const ai: ReadinessItem = {
      required: runtimeProduction,
      configured: aiConfigured,
      ready: !runtimeProduction || aiConfigured,
    };

    const fullyReady = databaseReady && queueReady && auth.ready && storage.ready && ai.ready;

    if (!fullyReady) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        environment: runtimeProduction ? 'production' : 'non_production',
        database: databaseReady ? 'ok' : 'unavailable',
        queue: {
          required: queue.required,
          configured: queue.configured,
          connected: queue.connected,
          workersCount: queue.workersCount,
          reason: queue.reason,
        },
        auth,
        storage,
        ai,
        message: !databaseReady
          ? 'Database is not connected'
          : !queueReady
            ? 'Queue/worker is not ready for processing analyses'
            : !auth.ready
              ? 'Auth provider is not configured for production'
              : !storage.ready
                ? 'Image storage is not configured for production'
                : 'OpenAI key is missing/invalid for production',
      });
    }

    return {
      status: 'ok',
      environment: runtimeProduction ? 'production' : 'non_production',
      database: 'ok',
      queue: {
        required: queue.required,
        configured: queue.configured,
        connected: queue.connected,
        workersCount: queue.workersCount,
        reason: queue.reason,
      },
      auth,
      storage,
      ai,
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  @UseGuards(OpsTokenGuard)
  async getHealth() {
    const ready = this.prisma.isReady() && (await this.prisma.checkConnection());
    const queue = await getAiQueueReadiness();
    const runtimeProduction = isProductionRuntime();
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const authConfigured = Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY);
    const storageConfigured = Boolean(process.env.SUPABASE_URL && supabaseServiceKey);
    const aiConfigured = hasValidOpenAiKey();
    const authReady = !runtimeProduction || authConfigured;
    const storageReady = !runtimeProduction || storageConfigured;
    const aiReady = !runtimeProduction || aiConfigured;
    const status = ready && queue.ready && authReady && storageReady && aiReady ? 'ok' : 'degraded';

    return {
      status,
      service: 'tickrify-backend',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      appEnv: process.env.APP_ENV || '',
      database: ready ? 'ok' : 'error',
      queue: {
        required: queue.required,
        configured: queue.configured,
        connected: queue.connected,
        workersCount: queue.workersCount,
        ready: queue.ready,
        reason: queue.reason,
      },
      auth: {
        required: runtimeProduction,
        configured: authConfigured,
        ready: authReady,
        clerkIssuer: process.env.CLERK_ISSUER ? 'configured' : 'missing',
        clerkSecretOrJwtKey: authConfigured ? 'configured' : 'missing',
      },
      ai: {
        required: runtimeProduction,
        configured: aiConfigured,
        ready: aiReady,
        model: process.env.AI_MODEL || 'gpt-4o',
      },
      storage: {
        required: runtimeProduction,
        configured: storageConfigured,
        ready: storageReady,
        supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
        supabaseServiceKey: supabaseServiceKey ? 'configured' : 'missing',
        supabaseStorageBucket:
          process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images',
      },
    };
  }
}
