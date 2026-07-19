import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma.service';
import { httpAction } from './log-action';

@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(req: Request, res: Response, durationMs: number, error?: Error, statusCode?: number) {
    const user = req.session.user;
    const status = statusCode || res.statusCode;
    const level = error || status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    await this.prisma.appLog.create({
      data: {
        createdAt: new Date(),
        level,
        category: 'HTTP',
        action: httpAction(req),
        method: req.method,
        path: maskSecretPath(req.path),
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

/**
 * Che token trong đường dẫn trước khi ghi log.
 *
 * URL feed lịch (/lich/<token>.ics) mang token bí mật thay cho đăng nhập — ai có URL là
 * đọc được lịch thuốc của bé. Điện thoại gọi nó vài chục lần mỗi ngày, để nguyên thì token
 * nằm vĩnh viễn trong bảng log và hiện ra ở trang xem log.
 *
 * Vẫn ghi lại dòng log (cần biết máy có thật sự kéo về không, và kéo lúc nào) — chỉ thay
 * phần token bằng dấu sao.
 */
export function maskSecretPath(path: string): string {
  return path.replace(/^\/lich\/[^/]+\.ics$/, '/lich/***.ics');
}

export function shouldSkipHttpLog(req: Request, statusCode: number) {
  if (process.env.LOG_ALL_HTTP === 'true') return false;
  if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/favicon.ico' || req.path === '/manifest.json') return true;
  if (req.method !== 'GET' || statusCode >= 400) return false;
  return ['/css/', '/js/', '/icons/', '/uploads/'].some((prefix) => req.path.startsWith(prefix));
}

const SENSITIVE_KEY_PATTERN = /password|passwd|pwd|secret|token|otp|cvv|card|authorization|cookie/i;

function safeParams(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  return Object.entries(body as Record<string, unknown>)
    .map(([key, value]) => (SENSITIVE_KEY_PATTERN.test(key) ? `${key}=***` : `${key}=${String(value).slice(0, 300)}`))
    .join('&')
    .slice(0, 2000);
}
