import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private ready = false;

  constructor() {
    super();
    this.normalizeDatabaseUrls();
  }

  async onModuleInit() {
    await this.connectWithRetry();
    this.ready = true;
  }

  async onModuleDestroy() {
    this.ready = false;
    await this.$disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.ready = true;
      return true;
    } catch (error) {
      this.ready = false;
      this.logger.error('Database readiness probe failed', error as Error);
      return false;
    }
  }

  private async connectWithRetry(maxAttempts = 10): Promise<void> {
    let attempt = 0;
    let delayMs = 500;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        await this.$connect();
        this.logger.log(`Database connected (attempt ${attempt}/${maxAttempts})`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Database connection failed (attempt ${attempt}/${maxAttempts}): ${message}`,
        );

        if (attempt >= maxAttempts) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 8000);
      }
    }

    throw new Error(
      `Unable to connect to database after ${maxAttempts} attempts. Check DATABASE_URL/DIRECT_URL.`,
    );
  }

  private normalizeDatabaseUrls() {
    const runtimeUrl = this.withRequiredSslMode(process.env.DATABASE_URL);
    const directUrl = this.withRequiredSslMode(process.env.DIRECT_URL);

    if (!runtimeUrl && directUrl) {
      process.env.DATABASE_URL = directUrl;
    } else if (runtimeUrl) {
      process.env.DATABASE_URL = runtimeUrl;
    }

    if (!directUrl && runtimeUrl) {
      process.env.DIRECT_URL = runtimeUrl;
    } else if (directUrl) {
      process.env.DIRECT_URL = directUrl;
    }
  }

  private withRequiredSslMode(value?: string): string | undefined {
    if (!value) {
      return value;
    }

    try {
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        return value;
      }

      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require');
      }

      return url.toString();
    } catch {
      return value;
    }
  }
}
