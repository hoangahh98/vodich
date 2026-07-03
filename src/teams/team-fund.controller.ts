import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
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
  async setTeamFund(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'fund');
    return res.redirect(`/teams/${id}/overview?month=${body.month || currentMonth()}`);
  }

  @Post('/teams/:id/payments')
  async updateTeamPayments(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const month = body.month || currentMonth();
    await this.teams.updatePayments(BigInt(id), month, body);
    this.matchGateway.emitTeamUpdated(id, 'payments');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }
}
