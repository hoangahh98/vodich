import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class LocalsMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    res.locals.currentUser = req.session.user;
    res.locals.featureSet = await this.auth.featureSet(req.session.user);
    res.locals.isRoot = this.auth.isRoot(req.session.user);
    res.locals.path = req.path;
    next();
  }
}
