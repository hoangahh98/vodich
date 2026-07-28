import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LogService } from '../logs/log.service';

/**
 * Chống CSRF cho mọi request làm thay đổi dữ liệu.
 *
 * Vì sao không dùng token ẩn trong form: app render server-side với hàng chục form EJS,
 * gắn token vào từng form là nhiều chỗ để quên (quên một cái là hở). Kiểm ở đây nằm một
 * chỗ, áp cho mọi route hiện tại lẫn tương lai.
 *
 * Thứ tự tin cậy — CÓ LÝ DO, đừng rút gọn:
 *
 * 1. `Sec-Fetch-Site` (Fetch Metadata) — tín hiệu chuẩn nhất, do chính trình duyệt gắn và
 *    trang web không giả được. Đây là nguồn ưu tiên.
 * 2. `Origin` — chỉ dùng khi không có Sec-Fetch-Site, và phải BỎ QUA giá trị chuỗi "null".
 * 3. `Referer` — phương án cuối.
 * 4. Không có gì dùng được -> CHO QUA nhưng ghi log.
 *
 * CA THẬT (28/7/2026), lý do bước 1 và quy tắc "null": bản đầu chỉ kiểm Origin và chặn khi
 * thiếu. Ngay sau khi deploy, thao tác ghi đầu tiên từ iPhone (iOS 18.7, app mở từ màn hình
 * chính) bị chặn 403 vì Safari gửi đúng chữ `Origin: null` — hành vi đã biết của PWA
 * standalone trên iOS. Tức là bản đó làm hỏng app trên thiết bị chính của người dùng.
 *
 * Vì sao bước 4 cho qua thay vì chặn: cookie phiên đã đặt `sameSite: 'lax'`, nên một POST
 * từ site khác KHÔNG mang theo cookie -> request thành vô danh -> FeatureGuard chặn ngay.
 * Lớp này là phòng thủ chiều sâu cho trình duyệt cũ; đánh đổi để chặn thêm vài % rủi ro mà
 * làm người dùng thật không thao tác được là đánh đổi sai.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfCheck {
  ok: boolean;
  /** Vì sao kết luận như vậy — đi vào log để còn lần ra khi có sự cố. */
  reason: string;
}

/** Hàm thuần, không phụ thuộc Nest — để test được trực tiếp. */
export function checkSameOrigin(req: Pick<Request, 'method' | 'get' | 'hostname'>): CsrfCheck {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true, reason: 'method an toàn' };

  // 1) Fetch Metadata: trình duyệt tự khai request đến từ đâu, trang web không sửa được.
  const fetchSite = (req.get('sec-fetch-site') || '').trim().toLowerCase();
  if (fetchSite) {
    // `none` = người dùng tự mở (gõ URL, bookmark, mở app từ màn hình chính).
    if (fetchSite === 'same-origin' || fetchSite === 'none') return { ok: true, reason: `Sec-Fetch-Site: ${fetchSite}` };
    return { ok: false, reason: `Sec-Fetch-Site: ${fetchSite}` };
  }

  const allowed = allowedHosts(req);

  // 2) Origin — bỏ qua chuỗi "null" (iOS PWA, iframe sandbox) vì nó KHÔNG có nghĩa là
  //    "đến từ site lạ", chỉ là trình duyệt không muốn khai origin.
  const origin = (req.get('origin') || '').trim();
  if (origin && origin.toLowerCase() !== 'null') {
    return matchHost(origin, allowed, 'Origin');
  }

  // 3) Referer
  const referer = (req.get('referer') || '').trim();
  if (referer && referer.toLowerCase() !== 'null') {
    return matchHost(referer, allowed, 'Referer');
  }

  // 4) Không có tín hiệu nào dùng được.
  return { ok: true, reason: 'không có Sec-Fetch-Site/Origin/Referer — dựa vào cookie sameSite=lax' };
}

function matchHost(value: string, allowed: Set<string>, label: string): CsrfCheck {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `${label} không hợp lệ: ${value.slice(0, 120)}` };
  }
  if (allowed.has(url.host.toLowerCase()) || allowed.has(url.hostname.toLowerCase())) {
    return { ok: true, reason: `${label} cùng host` };
  }
  return { ok: false, reason: `${label} lạ: ${url.origin.slice(0, 120)}` };
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
