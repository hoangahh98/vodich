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
    // Phải dùng originalUrl chứ không phải req.path: Nest gắn middleware này theo kiểu
    // wildcard nên Express cắt tiền tố khỏi req.url, làm req.path luôn ra "/" ở mọi trang.
    // Hậu quả là menu theo từng mục ở bottom-menu.ejs không bao giờ khớp.
    res.locals.path = req.originalUrl.split('?')[0];
    // Thông báo một lần sau redirect (req.session.flash): đọc xong là xoá để lần tải sau không hiện lại.
    if (req.session?.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    }
    next();
  }
}
