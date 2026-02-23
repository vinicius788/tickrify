import serverlessExpress from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { isOriginAllowed, resolveAllowedOrigins } from './common/utils/cors';

let cachedServer: any;

/**
 * Bootstrap the NestJS application for serverless execution
 * This function caches the server instance to improve cold start performance
 */
async function bootstrap() {
  try {
    if (!cachedServer) {
      console.log('🚀 Initializing NestJS application for serverless...');
      
      const expressApp = express();
      expressApp.set('trust proxy', 1);
      
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
        origin: (origin, callback) => {
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

      // Add global error handling
      app.useGlobalFilters();

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
        headers: event.headers,
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
    
    // Return a proper error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({
        statusCode: 500,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'production' 
          ? 'An error occurred while processing your request'
          : error.message,
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
