import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { isOriginAllowed, resolveAllowedOrigins } from './common/utils/cors';
import { attachRequestContext } from './common/middleware/request-context.middleware';
import { validateStartupEnv } from './common/utils/env-validation';
import { isProductionRuntime } from './common/utils/runtime-env';
import { buildHelmetConfig } from './common/utils/security-headers';

type GlobalWithNestApp = typeof globalThis & {
  __tickrifyNestApp?: INestApplication;
};

/**
 * Bootstrap function for local development
 * This is used when running the server locally with `npm run dev` or `npm start`
 */
async function bootstrap() {
  try {
    const globalRef = globalThis as GlobalWithNestApp;

    // In watch mode, Nest can re-run bootstrap before the old app is fully released.
    // Close the previous instance first to avoid intermittent EADDRINUSE on :3001.
    if (globalRef.__tickrifyNestApp) {
      await globalRef.__tickrifyNestApp.close();
      globalRef.__tickrifyNestApp = undefined;
    }

    validateStartupEnv();
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    console.log('🚀 Starting NestJS application...');
    
    const app = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: isProd ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
    });
    app.use(attachRequestContext);
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
    app.use(helmet(buildHelmetConfig()));

    const allowedOrigins = resolveAllowedOrigins();

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    });

    // Set global prefix
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    const legacyFallback = String(process.env.ALLOW_LEGACY_AUTH_FALLBACK || '').trim();
    if (legacyFallback.toLowerCase() === 'true' && isProductionRuntime()) {
      throw new Error(
        '[SECURITY] ALLOW_LEGACY_AUTH_FALLBACK=true is forbidden in production runtime. Unset this variable and redeploy.',
      );
    }
    if (legacyFallback.toLowerCase() === 'true') {
      console.warn(
        '[SECURITY] ALLOW_LEGACY_AUTH_FALLBACK is enabled — NEVER deploy to production with this flag.',
      );
    }

    const port = Number(process.env.PORT || 3001);
    await app.listen(port);
    globalRef.__tickrifyNestApp = app;
    
    console.log(`✅ Backend running on http://localhost:${port}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to start application: ${message}`);
    process.exit(1);
  }
}

// Only bootstrap if this file is run directly (not imported)
if (require.main === module) {
  bootstrap();
}
