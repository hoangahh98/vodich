import { Request } from 'express';

const UUID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;

export function httpAction(req: Request) {
  return `${req.method} ${normalizedPath(requestPath(req))}`;
}

/**
 * Đường dẫn thật của request.
 *
 * PHẢI dùng originalUrl chứ không phải req.path: middleware gắn kiểu wildcard bị Express
 * cắt tiền tố khỏi req.url, nên req.path luôn ra "/" ở mọi trang. Đúng cái bẫy mà
 * locals.middleware.ts đã ghi chú — log của CsrfMiddleware từng ghi mọi thứ thành
 * "POST /", làm mất luôn manh mối khi lần lỗi.
 */
export function requestPath(req: Pick<Request, 'originalUrl' | 'path'>) {
  return (req.originalUrl || req.path || '/').split('?')[0];
}

export function normalizedPath(path: string) {
  return path.replace(UUID_RE, '/:id').replace(NUMERIC_ID_RE, '/:id');
}
