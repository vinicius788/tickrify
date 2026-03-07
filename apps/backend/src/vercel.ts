import serverlessExpress from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { isOriginAllowed, resolveAllowedOrigins } from './common/utils/cors';
import { attachRequestContext } from './common/middleware/request-context.middleware';
import { validateStartupEnv } from './common/utils/env-validation';
import { buildHelmetConfig } from './common/utils/security-headers';

let cachedServer: any;

function sanitizeHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!headers) {
    return {};
  }

  const hidden = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'proxy-authorization',
  ]);

  return Object.entries(headers).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[key] = hidden.has(key.toLowerCase()) ? '[redacted]' : value;
    return acc;
  }, {});
}

/**
 * Bootstrap the NestJS application for serverless execution
 * This function caches the server instance to improve cold start performance
 */
async function bootstrap() {
  try {
    if (!cachedServer) {
      validateStartupEnv();
      console.log('🚀 Initializing NestJS application for serverless...');
      
      const expressApp = express();
      expressApp.use(attachRequestContext);
      expressApp.set('trust proxy', 1);
      expressApp.use(helmet(buildHelmetConfig()));
      
      const app = await NestFactory.create(
        AppModule,
        new ExpressAdapter(expressApp),
        {
          rawBody: true,
          logger: process.env.NODE_ENV === 'production' 
            ? ['error', 'warn', 'log'] 
            : ['error', 'warn', 'log', 'debug', 'verbose'],
        },
      );

      const allowedOrigins = resolveAllowedOrigins();

      app.enableCors({
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) => {
          // Allow requests with no origin (like mobile apps or curl)
          if (!origin) return callback(null, true);
          
          if (isOriginAllowed(origin, allowedOrigins)) {
            callback(null, true);
          } else {
            console.warn(`⚠️ Blocked CORS request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
          }
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

      await app.init();
      
      cachedServer = serverlessExpress({ app: expressApp });
      console.log('✅ NestJS application initialized successfully');
    }
    
    return cachedServer;
  } catch (error) {
    console.error('❌ Failed to initialize NestJS application:', error);
    throw error;
  }
}

/**
 * Serverless handler for Vercel
 * Exports a handler function that Vercel will call for each request
 */
export default async function handler(event: any, context: any) {
  try {
    // Set callbackWaitsForEmptyEventLoop to false to allow the function to return
    // immediately after the callback is called, even if there are events in the Node.js event loop
    context.callbackWaitsForEmptyEventLoop = false;

    // Log request info (helpful for debugging)
    if (process.env.NODE_ENV !== 'production') {
      console.log('📥 Incoming request:', {
        path: event.path || event.rawPath,
        method: event.httpMethod || event.requestContext?.http?.method,
        headers: sanitizeHeaders(event.headers),
      });
    }

    const server = await bootstrap();
    const result = await server(event, context);

    // Log response info (helpful for debugging)
    if (process.env.NODE_ENV !== 'production') {
      console.log('📤 Outgoing response:', {
        statusCode: result.statusCode,
      });
    }

    return result;
  } catch (error) {
    console.error('❌ Serverless handler error:', error);
    const frontendOrigin = String(process.env.FRONTEND_URL || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (frontendOrigin) {
      headers['Access-Control-Allow-Origin'] = frontendOrigin;
    }
    
    // Return a proper error response
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        statusCode: 500,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'production' 
          ? 'An error occurred while processing your request'
          : error instanceof Error
            ? error.message
            : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

/**
 * For local development, you can also export the bootstrap function
 * to start the server in a non-serverless environment
 */
export { bootstrap };
