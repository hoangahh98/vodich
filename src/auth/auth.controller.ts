import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { render } from '../common/view';
import { safeNext } from '../common/controller-utils';
import { RateLimitService } from '../common/rate-limit.service';
import { UserRole } from '../types';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('/login')
  loginPage(@Req() req: Request, @Res() res: Response) {
    if (req.query.role === 'CLIENT') delete req.session.user;
    return render(res, 'login', { next: req.query.next || '', username: req.query.username || '', role: req.query.role || 'ADMIN' });
  }

  @Post('/login')
  async login(@Req() req: Request, @Res() res: Response, @Body() body: { username: string; password: string; role: UserRole; next?: string }) {
    const limitKey = `login:${clientIp(req)}:${String(body.username || '').trim().toLowerCase()}`;
    const limit = this.rateLimit.consume(limitKey, { max: 8 });
    if (!limit.allowed) {
      return render(res.status(429), 'login', {
        error: `Thử lại sau ${limit.retryAfterSeconds} giây`,
        next: body.next || '',
        username: body.username || '',
        role: body.role || 'ADMIN',
      });
    }
    try {
      req.session.user = await this.auth.login(body.username || '', body.password || '', body.role || 'ADMIN');
      this.rateLimit.reset(limitKey);
      return res.redirect(safeNext(body.next) || '/');
    } catch (error) {
      return render(res, 'login', { error: error instanceof Error ? error.message : 'Đăng nhập thất bại', next: body.next || '', username: body.username || '', role: body.role || 'ADMIN' });
    }
  }

  @Post('/logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.session.destroy(() => res.redirect('/login'));
  }
}

function clientIp(req: Request) {
  // Với `trust proxy` bật, req.ip đã là IP client thật (Express tự đọc X-Forwarded-For
  // đáng tin), không parse header thô do client gửi để tránh giả mạo vượt rate-limit.
  return req.ip || 'unknown';
}
