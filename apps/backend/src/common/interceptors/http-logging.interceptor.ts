import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest(request, response, Date.now() - start);
        },
        error: () => {
          this.logRequest(request, response, Date.now() - start);
        },
      }),
    );
  }

  private logRequest(request: any, response: any, durationMs: number): void {
    const method = String(request?.method || 'UNKNOWN').toUpperCase();
    const url = String(request?.originalUrl || request?.url || '');
    const statusCode = Number(response?.statusCode || 0);
    const requestId = String(request?.requestId || '-');
    const userId = String(request?.user?.id || '');
    const ip = String(request?.ip || request?.socket?.remoteAddress || 'unknown');

    const base = `${method} ${url} ${statusCode} ${durationMs}ms rid=${requestId} ip=${ip}`;
    const message = userId ? `${base} uid=${userId}` : base;

    if (statusCode >= 500) {
      this.logger.error(message);
      return;
    }

    if (statusCode >= 400) {
      this.logger.warn(message);
      return;
    }

    this.logger.log(message);
  }
}

