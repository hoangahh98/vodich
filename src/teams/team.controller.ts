import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { safeTeamSection } from '../common/controller-utils';
import { render } from '../common/view';
import { MatchGateway } from '../tournaments/match.gateway';
import { TeamService } from './team.service';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TEAMS')
export class TeamController {
  constructor(
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Get('/teams')
  async teamIndex(@Res() res: Response) {
    return render(res, 'teams/index', { teams: await this.teams.list() });
  }

  @Post('/teams')
  @AdminOnly()
  async createTeam(@Res() res: Response, @Body() body: Record<string, string>) {
    const team = await this.teams.create(body.name, body.description);
    this.matchGateway.emitTeamsUpdated('team-created');
    return res.redirect(`/teams/${team.id}`);
  }

  @Get('/teams/:id')
  teamDetailRedirect(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const query = req.query.month ? `?month=${req.query.month}` : '';
    return res.redirect(`/teams/${id}/overview${query}`);
  }

  @Get('/teams/:id/:section')
  async teamDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const month = String(req.query.month || currentMonth());
    return render(res, 'teams/detail', { ...(await this.teams.detailForMonth(BigInt(id), month)), section: safeTeamSection(section) });
  }

  @Post('/teams/:id/settings')
  @AdminOnly()
  async updateTeamSettings(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    await this.teams.updateTeam(BigInt(id), body.name, body.description);
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'settings');
    return res.redirect(`/teams/${id}/settings?month=${body.month || currentMonth()}`);
  }
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
