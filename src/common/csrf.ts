import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LogService } from '../logs/log.service';

/**
 * Chống CSRF bằng kiểm tra Origin/Referer trên mọi request làm thay đổi dữ liệu.
 *
 * Vì sao không dùng token ẩn trong form: app render server-side với hàng chục form EJS,
 * gắn token vào từng form là nhiều chỗ để quên (quên một cái là hở). Kiểm tra Origin nằm
 * ở MỘT chỗ, áp cho mọi route hiện tại lẫn tương lai, không thể quên.
 *
 * Đây là lớp thứ hai chồng lên cookie `sameSite: 'lax'` (đã chặn phần lớn POST xuyên site).
 * Trình duyệt hiện đại luôn gửi Origin cho POST, kể cả same-origin — nên thiếu cả
 * Origin lẫn Referer thì coi là đáng ngờ và chặn, chứ không cho qua.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfCheck {
  ok: boolean;
  reason?: string;
}

/** Hàm thuần, không phụ thuộc Nest — để test được trực tiếp. */
export function checkSameOrigin(req: Pick<Request, 'method' | 'get' | 'hostname'>): CsrfCheck {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };

  const source = req.get('origin') || req.get('referer');
  if (!source) return { ok: false, reason: 'Thiếu cả Origin lẫn Referer' };

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return { ok: false, reason: `Origin/Referer không hợp lệ: ${source.slice(0, 120)}` };
  }

  const allowed = allowedHosts(req);
  if (allowed.has(sourceUrl.host.toLowerCase()) || allowed.has(sourceUrl.hostname.toLowerCase())) {
    return { ok: true };
  }
  return { ok: false, reason: `Origin lạ: ${sourceUrl.origin.slice(0, 120)}` };
}

function allowedHosts(req: Pick<Request, 'get' | 'hostname'>): Set<string> {
  const hosts = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = (value || '').trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  };
  // Với `trust proxy`, req.hostname đã là host thật sau reverse proxy của Render.
  add(req.get('host'));
  add(req.hostname);
  for (const entry of (process.env.CSRF_ALLOWED_ORIGINS || '').split(',')) {
    const value = entry.trim();
    if (!value) continue;
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      add(url.host);
      add(url.hostname);
    } catch {
      add(value);
    }
  }
  return hosts;
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly logs: LogService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const result = checkSameOrigin(req);
    if (result.ok) return next();

    this.logs.recordDenied(req, 403, `CSRF: ${result.reason}`);
    const accept = req.get('accept') || '';
    if (!accept.includes('text/html')) {
      res.status(403).json({ error: 'Yêu cầu bị từ chối' });
      return;
    }
    res.status(403).render('error', { message: 'Yêu cầu không hợp lệ, vui lòng tải lại trang và thử lại.' });
  }
}
