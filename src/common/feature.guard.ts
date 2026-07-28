import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { LogService } from '../logs/log.service';
import { AppFeature } from '../types';
import { wantsJson } from './controller-utils';
import { ADMIN_ONLY_KEY, FEATURE_ACCESS_KEY, PUBLIC_KEY, ROOT_ADMIN_ONLY_KEY } from './feature.decorator';

/**
 * Gác quyền TOÀN CỤC, mặc-định-chặn: mọi route đều phải đăng nhập trừ khi có `@Public()`.
 * Thêm route mới mà quên nghĩ tới quyền thì nó bị khoá, chứ không hở ra.
 *
 * Guard chạy TRƯỚC interceptor trong Nest, nên HttpLogInterceptor không nhìn thấy các
 * request bị chặn ở đây. Vì vậy guard tự ghi log truy cập bị từ chối — đúng loại sự kiện
 * đáng theo dõi nhất thì không được phép im lặng.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly logs: LogService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (this.metadata<boolean>(PUBLIC_KEY, context)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const user = request.session?.user;
    if (!user) return this.deny(request, response, 401, 'Chưa đăng nhập');

    const rootOnly = this.metadata<boolean>(ROOT_ADMIN_ONLY_KEY, context);
    if (rootOnly) {
      if (!this.auth.isRoot(user)) return this.deny(request, response, 403, 'Cần quyền admin gốc');
      return true;
    }

    const adminOnly = this.metadata<boolean>(ADMIN_ONLY_KEY, context);
    const feature = this.metadata<AppFeature>(FEATURE_ACCESS_KEY, context);
    const featureSet = response.locals.featureSet as Set<string> | undefined;
    if (adminOnly && user.role !== 'ADMIN') return this.deny(request, response, 403, 'Cần quyền admin');
    if (feature && !this.auth.can(user, feature, featureSet)) {
      return this.deny(request, response, 403, `Thiếu quyền ${feature}`);
    }

    return true;
  }

  private metadata<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
  }

  private deny(request: Request, response: Response, status: 401 | 403, reason: string): false {
    this.logs.recordDenied(request, status, reason);
    if (wantsJson(request)) {
      response.status(status).json({ error: status === 401 ? 'Cần đăng nhập' : 'Không có quyền' });
      return false;
    }
    if (status === 401) {
      response.redirect('/login');
      return false;
    }
    response.status(403).render('error', { message: 'Không có quyền' });
    return false;
  }
}
