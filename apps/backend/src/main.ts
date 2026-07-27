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

    // ── Outcome sweeper dentro da API (opcional, DESLIGADO por padrão) ──────
    //
    // Contexto (27/07/2026): o sweeper que alimenta a página /accuracy só é
    // ligado por `worker/ai.worker.ts`, e o serviço `tickrify-worker` do
    // render.yaml NUNCA foi criado no Render — o blueprint não foi aplicado.
    // Resultado: o outcome tracking está parado e a /accuracy congelada.
    //
    // Como o caminho de análise do usuário é streaming (SSE) e não passa pela
    // fila, um worker separado não é necessário — só o sweeper é. Rodá-lo aqui
    // dentro custa zero (a API já fica de pé pelo keep-warm de 10 em 10 min).
    //
    // SEGURANÇA: só liga com ENABLE_SWEEPER_IN_API === 'true'. Sem a variável,
    // este bloco não faz absolutamente nada e o comportamento é idêntico ao de
    // antes. Para desligar: apague a variável no Render e reinicie. Não há
    // rollback de código, migração nem serviço novo envolvido.
    //
    // ATENÇÃO: não ligue isto se algum dia o `tickrify-worker` voltar a
    // existir — os dois rodando ao mesmo tempo fariam varredura duplicada.
    if (String(process.env.ENABLE_SWEEPER_IN_API || '').trim() === 'true') {
      try {
        const { PrismaService } = await import('./modules/database/prisma.service');
        const { startOutcomeSweeper } = await import('../worker/outcome.sweeper');
        startOutcomeSweeper(app.get(PrismaService));
        console.log('[Outcome] Sweeper iniciado DENTRO da API (ENABLE_SWEEPER_IN_API=true).');
      } catch (err) {
        // Nunca derruba o boot da API por causa do sweeper.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Outcome] Falha ao iniciar o sweeper na API: ${message}`);
      }
    }
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
