import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getAiQueueReadiness } from '../ai/ai.queue';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  getLiveness() {
    return {
      status: 'ok',
      service: 'tickrify-backend',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('ready')
  async getReadiness() {
    const databaseReady = this.prisma.isReady() && (await this.prisma.checkConnection());
    const queue = await getAiQueueReadiness();
    const queueReady = queue.ready;

    if (!databaseReady || !queueReady) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: databaseReady ? 'ok' : 'unavailable',
        queue: {
          required: queue.required,
          configured: queue.configured,
          connected: queue.connected,
          workersCount: queue.workersCount,
          reason: queue.reason,
        },
        message: !databaseReady
          ? 'Database is not connected'
          : 'Queue/worker is not ready for processing analyses',
      });
    }

    return {
      status: 'ok',
      database: 'ok',
      queue: {
        required: queue.required,
        configured: queue.configured,
        connected: queue.connected,
        workersCount: queue.workersCount,
        reason: queue.reason,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async getHealth() {
    const ready = this.prisma.isReady() && (await this.prisma.checkConnection());
    const queue = await getAiQueueReadiness();
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const status = ready && queue.ready ? 'ok' : 'degraded';

    return {
      status,
      service: 'tickrify-backend',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
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
        clerkIssuer: process.env.CLERK_ISSUER ? 'configured' : 'missing',
        clerkJwksUrl: process.env.CLERK_JWKS_URL ? 'configured' : 'missing',
      },
      integrations: {
        supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
        supabaseServiceKey: supabaseServiceKey ? 'configured' : 'missing',
      },
    };
  }
}
