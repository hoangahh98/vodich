import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { requireUser } from '../common/controller-utils';
import { render } from '../common/view';

@Controller()
export class GamesController {
  @Get('/games')
  hub(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/index');
  }

  @Get('/games/toan')
  math(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/math');
  }

  @Get('/games/tieng-anh')
  english(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/english');
  }
}
