import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Bắt mọi lỗi chưa xử lý ở tầng HTTP và render trang lỗi thân thiện.
 * - 4xx: hiển thị thông báo của lỗi (đã là tiếng Việt, hướng người dùng).
 * - 5xx: chỉ hiển thị thông báo chung, KHÔNG lộ stack/chi tiết nội bộ.
 * Bối cảnh không phải HTTP (vd websocket) được bỏ qua để Nest xử lý mặc định.
 */
@Catch()
export class ViewExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = status < 500 && exception instanceof HttpException ? exception.message : 'Có lỗi xảy ra, vui lòng thử lại.';

    if (status >= 500) {
      console.error('[unhandled]', req.method, req.originalUrl, exception instanceof Error ? exception.stack : exception);
    }

    // Đảm bảo các biến layout luôn tồn tại kể cả khi lỗi xảy ra sớm.
    res.locals.currentUser = res.locals.currentUser ?? req.session?.user;
    res.locals.featureSet = res.locals.featureSet ?? new Set<string>();
    res.locals.isRoot = res.locals.isRoot ?? false;
    res.locals.path = res.locals.path ?? req.originalUrl.split('?')[0];

    try {
      res.status(status).render('error', { message });
    } catch {
      res.status(status).type('text/plain').send(message);
    }
  }
}
