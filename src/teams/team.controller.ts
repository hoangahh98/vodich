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
  async teamIndex(@Req() req: Request, @Res() res: Response) {
    return render(res, 'teams/index', { teams: await this.teams.list(req.session.user!) });
  }

  @Post('/teams')
  @AdminOnly()
  async createTeam(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const team = await this.teams.create(req.session.user!, body.name, body.description);
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
    if (req.session.user?.role === 'ADMIN' && !(await this.teams.canManage(req.session.user, BigInt(id)))) return forbidden(res);
    return render(res, 'teams/detail', { ...(await this.teams.detailForMonth(BigInt(id), month)), section: safeTeamSection(section) });
  }

  @Post('/teams/:id/settings')
  @AdminOnly()
  async updateTeamSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.teams.updateTeam(BigInt(id), body.name, body.description);
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'settings');
    return res.redirect(`/teams/${id}/settings?month=${body.month || currentMonth()}`);
  }

  @Post('/teams/:id/permissions')
  @AdminOnly()
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.teams.addPermission(BigInt(id), BigInt(adminId));
    this.matchGateway.emitTeamUpdated(id, 'permission-added');
    return res.redirect(`/teams/${id}/settings`);
  }

  @Post('/teams/:teamId/permissions/:permissionId/delete')
  @AdminOnly()
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('permissionId') permissionId: string) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(teamId)))) return forbidden(res);
    await this.teams.removePermission(BigInt(permissionId));
    this.matchGateway.emitTeamUpdated(teamId, 'permission-deleted');
    return res.redirect(`/teams/${teamId}/settings`);
  }
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
