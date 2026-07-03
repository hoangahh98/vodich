import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma.service';
import { httpAction } from './log-action';

@Injectable()
export class LogService implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (process.env.DISABLE_HTTP_LOGS === 'true') {
      next();
      return;
    }
    const started = Date.now();
    res.on('finish', () => {
      if (shouldSkipHttpLog(req, res)) return;
      this.record(req, res, Date.now() - started).catch(() => undefined);
    });
    next();
  }

  async record(req: Request, res: Response, durationMs: number, error?: Error) {
    const user = req.session.user;
    const status = res.statusCode;
    const level = error || status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    await this.prisma.appLog.create({
      data: {
        createdAt: new Date(),
        level,
        category: 'HTTP',
        action: httpAction(req),
        method: req.method,
        path: req.path,
        queryString: req.url.includes('?') ? req.url.split('?').slice(1).join('?') : null,
        statusCode: status,
        durationMs,
        userId: user ? BigInt(user.id) : null,
        username: user?.email,
        userRole: user?.role,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')?.slice(0, 500),
        details: safeParams(req.body),
        errorMessage: error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
      },
    });
  }
}

function shouldSkipHttpLog(req: Request, res: Response) {
  if (process.env.LOG_ALL_HTTP === 'true') return false;
  if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/favicon.ico' || req.path === '/manifest.json') return true;
  if (req.method !== 'GET' || res.statusCode >= 400) return false;
  return ['/css/', '/js/', '/icons/', '/uploads/'].some((prefix) => req.path.startsWith(prefix));
}

function safeParams(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  return Object.entries(body as Record<string, unknown>)
    .filter(([key]) => !key.toLowerCase().includes('password'))
    .map(([key, value]) => `${key}=${String(value).slice(0, 300)}`)
    .join('&')
    .slice(0, 2000);
}
