import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { blankToNull, requireFeature } from '../common/controller-utils';
import { render } from '../common/view';
import { PrismaService } from '../prisma.service';

@Controller()
export class PlayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get('/players')
  async players(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const players = await this.prisma.player.findMany({ orderBy: { displayName: 'asc' } });
    return render(res, 'players/index', { players });
  }

  @Post('/players')
  async createPlayer(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.prisma.player.upsert({
      where: { email: body.email.trim().toLowerCase() },
      update: {
        displayName: body.displayName.trim(),
        skillLevel: blankToNull(body.skillLevel),
        notes: blankToNull(body.notes),
      },
      create: {
        displayName: body.displayName.trim(),
        email: body.email.trim().toLowerCase(),
        skillLevel: blankToNull(body.skillLevel),
        notes: blankToNull(body.notes),
      },
    });
    return res.redirect('/players');
  }
}
