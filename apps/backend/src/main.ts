import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { isOriginAllowed, resolveAllowedOrigins } from './common/utils/cors';
import { attachRequestContext } from './common/middleware/request-context.middleware';
import { validateStartupEnv } from './common/utils/env-validation';
import { isProductionRuntime } from './common/utils/runtime-env';

/**
 * Bootstrap function for local development
 * This is used when running the server locally with `npm run dev` or `npm start`
 */
async function bootstrap() {
  try {
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
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
        hsts: isProductionRuntime()
          ? {
              maxAge: 31_536_000,
              includeSubDomains: true,
              preload: true,
            }
          : false,
        frameguard: { action: 'deny' },
        noSniff: true,
      }),
    );

    const allowedOrigins = resolveAllowedOrigins();

    app.enableCors({
      origin: (origin, callback) => {
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
