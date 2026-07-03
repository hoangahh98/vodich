import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature } from '../common/controller-utils';
import { render } from '../common/view';
import { PlayersService } from './players.service';

@Controller()
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly auth: AuthService,
  ) {}

  @Get('/players')
  async players(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const players = await this.playersService.list();
    return render(res, 'players/index', { players });
  }

  @Post('/players')
  async createPlayer(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.playersService.upsert(body);
    return res.redirect('/players');
  }

  @Post('/players/bulk')
  async updatePlayers(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.playersService.bulkUpdate(body);
    return res.redirect('/players');
  }
}
