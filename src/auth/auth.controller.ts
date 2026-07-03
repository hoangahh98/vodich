import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { render } from '../common/view';
import { safeNext } from '../common/controller-utils';
import { UserRole } from '../types';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('/login')
  loginPage(@Req() req: Request, @Res() res: Response) {
    if (req.query.role === 'CLIENT') delete req.session.user;
    return render(res, 'login', { next: req.query.next || '', username: req.query.username || '', role: req.query.role || 'ADMIN' });
  }

  @Post('/login')
  async login(@Req() req: Request, @Res() res: Response, @Body() body: { username: string; password: string; role: UserRole; next?: string }) {
    try {
      req.session.user = await this.auth.login(body.username || '', body.password || '', body.role || 'ADMIN');
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
