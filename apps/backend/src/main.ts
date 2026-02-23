import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { isOriginAllowed, resolveAllowedOrigins } from './common/utils/cors';

/**
 * Bootstrap function for local development
 * This is used when running the server locally with `npm run dev` or `npm start`
 */
async function bootstrap() {
  try {
    console.log('🚀 Starting NestJS application...');
    
    const app = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: ['error', 'warn', 'log', 'debug'],
    });
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);

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

    const port = Number(process.env.PORT || 3001);
    await app.listen(port);
    
    console.log(`✅ Backend running on http://localhost:${port}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Only bootstrap if this file is run directly (not imported)
if (require.main === module) {
  bootstrap();
}
