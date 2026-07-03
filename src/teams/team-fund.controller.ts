import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { MatchGateway } from '../tournaments/match.gateway';
import { currentMonth } from './team.controller';
import { TeamService } from './team.service';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TEAMS')
@AdminOnly()
export class TeamFundController {
  constructor(
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Post('/teams/:id/fund')
  async setTeamFund(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'fund');
    return res.redirect(`/teams/${id}/overview?month=${body.month || currentMonth()}`);
  }

  @Post('/teams/:id/payments')
  async updateTeamPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const month = body.month || currentMonth();
    await this.teams.updatePayments(BigInt(id), month, body);
    this.matchGateway.emitTeamUpdated(id, 'payments');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
