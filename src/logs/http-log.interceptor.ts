import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { LogService, shouldSkipHttpLog } from './log.service';

@Injectable()
export class HttpLogInterceptor implements NestInterceptor {
  constructor(private readonly logs: LogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.DISABLE_HTTP_LOGS === 'true' || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const started = Date.now();

    return next.handle().pipe(
      tap(() => this.record(request, response, Date.now() - started)),
      catchError((error: unknown) => {
        this.record(request, response, Date.now() - started, toError(error), statusFromError(error, response));
        return throwError(() => error);
      }),
    );
  }

  private record(request: Request, response: Response, durationMs: number, error?: Error, statusCode = response.statusCode) {
    if (shouldSkipHttpLog(request, statusCode)) return;
    this.logs.record(request, response, durationMs, error, statusCode).catch(() => undefined);
  }
}

function statusFromError(error: unknown, response: Response) {
  if (error && typeof error === 'object' && 'getStatus' in error && typeof error.getStatus === 'function') {
    return error.getStatus();
  }
  return response.statusCode >= 400 ? response.statusCode : 500;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
