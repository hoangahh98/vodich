import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { AppFeature } from '../types';
import { ADMIN_ONLY_KEY, FEATURE_ACCESS_KEY, ROOT_ADMIN_ONLY_KEY } from './feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const user = request.session.user;
    if (!user) {
      response.redirect('/login');
      return false;
    }

    const rootOnly = this.metadata<boolean>(ROOT_ADMIN_ONLY_KEY, context);
    if (rootOnly) {
      if (!this.auth.isRoot(user)) return forbidden(response, 'Không có quyền');
      return true;
    }

    const adminOnly = this.metadata<boolean>(ADMIN_ONLY_KEY, context);
    const feature = this.metadata<AppFeature>(FEATURE_ACCESS_KEY, context);
    const featureSet = response.locals.featureSet as Set<string> | undefined;
    if ((adminOnly && user.role !== 'ADMIN') || (feature && !this.auth.can(user, feature, featureSet))) {
      return forbidden(response, 'Không có quyền');
    }

    return true;
  }

  private metadata<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
  }
}

function forbidden(response: Response, message: string): false {
  response.status(403).render('error', { message });
  return false;
}
