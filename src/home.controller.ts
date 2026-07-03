import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { requireUser } from './common/controller-utils';
import { render } from './common/view';

@Controller()
export class HomeController {
  @Get('/')
  home(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'home');
  }
}
