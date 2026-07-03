import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth/auth.service';
import { requireFeature, requireUser } from './common/controller-utils';
import { render } from './common/view';

@Controller()
export class HomeController {
  constructor(private readonly auth: AuthService) {}

  @Get('/')
  home(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'home');
  }

  @Get('/travel')
  travel(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TRAVEL')) return;
    return render(res, 'travel/index');
  }
}
