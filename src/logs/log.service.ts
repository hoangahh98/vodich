import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { httpAction } from './log-action';

@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi một request đã chạy qua controller (mọi write action + mọi lỗi). */
  async record(req: Request, res: Response, durationMs: number, error?: Error, statusCode?: number) {
    const status = statusCode || res.statusCode;
    const level = error || status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    await this.write({
      level,
      category: 'HTTP',
      action: httpAction(req),
      statusCode: status,
      durationMs,
      details: safeParams(req.body),
      errorMessage: error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
      ...requestFacts(req),
    });
  }

  /**
   * Ghi một truy cập bị FeatureGuard từ chối. Guard chạy trước interceptor nên
   * HttpLogInterceptor không bao giờ thấy các request này — không ghi ở đây thì
   * chúng biến mất khỏi log hoàn toàn.
   *
   * Cố ý KHÔNG await: guard phải trả lời đồng bộ. Lỗi ghi log được báo ra console
   * chứ không nuốt im lặng.
   */
  recordDenied(req: Request, statusCode: 401 | 403, reason: string) {
    if (process.env.DISABLE_HTTP_LOGS === 'true') return; // chỉ bật ở e2e, production luôn ghi
    void this.write({
      level: 'WARN',
      category: 'ACCESS',
      action: `DENIED ${httpAction(req)}`.slice(0, 255),
      statusCode,
      durationMs: 0,
      details: safeParams(req.body),
      errorMessage: reason.slice(0, 2000),
      ...requestFacts(req),
    });
  }

  /** Không bao giờ ném ra ngoài: hỏng log không được phép làm hỏng request. */
  private async write(data: Prisma.AppLogUncheckedCreateInput) {
    try {
      await this.prisma.appLog.create({ data: { createdAt: new Date(), ...data } });
    } catch (error) {
      // Không nuốt im lặng — mất đường ghi log là sự cố hạ tầng cần thấy được.
      console.error('[log] không ghi được app_log', data.action, error);
    }
  }
}

function requestFacts(req: Request) {
  const user = req.session?.user;
  return {
    method: req.method,
    path: req.path.slice(0, 500),
    queryString: req.url.includes('?') ? req.url.split('?').slice(1).join('?') : null,
    userId: user ? safeBigInt(user.id) : null,
    username: user?.email,
    userRole: user?.role,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 500),
  };
}

function safeBigInt(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

export function shouldSkipHttpLog(req: Request, statusCode: number) {
  if (process.env.LOG_ALL_HTTP === 'true') return false;
  if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/favicon.ico' || req.path === '/manifest.json') return true;
  if (req.method !== 'GET' || statusCode >= 400) return false;
  return ['/css/', '/js/', '/icons/', '/uploads/'].some((prefix) => req.path.startsWith(prefix));
}

const SENSITIVE_KEY_PATTERN =
  /pass|pwd|secret|token|otp|cvv|card|authorization|cookie|api[-_]?key|apikey|credential|session|signature|csrf/i;
const MAX_VALUE_LENGTH = 300;

/**
 * Chuỗi hoá body để ghi log, che mọi trường nhạy cảm — kể cả nằm trong object/mảng lồng nhau.
 * Ảnh base64 (đơn thuốc) cũng bị cắt còn 300 ký tự nên log không phình.
 */
export function safeParams(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  return Object.entries(body as Record<string, unknown>)
    .map(([key, value]) => `${key}=${redact(key, value, 0)}`)
    .join('&')
    .slice(0, 2000);
}

function redact(key: string, value: unknown, depth: number): string {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '***';
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (depth >= 2) return '[...]';
    return `[${value.map((item) => redact(key, item, depth + 1)).join(',')}]`.slice(0, MAX_VALUE_LENGTH);
  }
  if (typeof value === 'object') {
    if (depth >= 2) return '{...}';
    const inner = Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => `${childKey}:${redact(childKey, childValue, depth + 1)}`)
      .join(',');
    return `{${inner}}`.slice(0, MAX_VALUE_LENGTH);
  }
  return String(value).slice(0, MAX_VALUE_LENGTH);
}
