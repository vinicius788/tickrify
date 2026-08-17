import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getAiQueueReadiness } from '../ai/ai.queue';
import { hasValidOpenAiKey } from '../../common/utils/ai-runtime';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { Public } from '../../common/decorators/public.decorator';
import { OpsTokenGuard } from './ops-token.guard';

type ReadinessItem = {
  required: boolean;
  configured: boolean;
  ready: boolean;
};

/**
 * @Public() no nível da CLASSE porque nenhuma rota de health usa sessão do
 * Clerk — quem chama é infraestrutura, não usuário:
 *   - /health/live  → aberto de propósito (keep-warm do GitHub Actions).
 *   - /health/ready → fechado pelo OpsTokenGuard (INTERNAL_OPS_TOKEN).
 *   - /health       → fechado pelo OpsTokenGuard.
 *
 * @Public() dispensa APENAS o AuthGuard global. O OpsTokenGuard continua
 * rodando normalmente nas duas rotas que o declaram — não confundir "público"
 * com "sem proteção".
 */
@Public()
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
        model: process.env.AI_MODEL ? 'configured' : 'default',
        modelQuick: process.env.AI_MODEL_QUICK?.trim() || 'default',
        modelDeep: process.env.AI_MODEL_DEEP?.trim() || 'default',
        // `quickGrounding` é a única flag aqui que a VITRINE VENDE: o card de
        // preço lista "Live candle grounding" como feature paga. Se vier
        // 'disabled', o site está afirmando algo que a produção não faz —
        // trate como incidente de claim, não como config.
        quickGrounding: process.env.ENABLE_QUICK_GROUNDING === 'true' ? 'enabled' : 'disabled',
        abPromptV9Percent: Number(process.env.AB_PROMPT_V9_PERCENT) || 0,
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
