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
export class TeamMemberController {
  constructor(
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Post('/teams/:id/members')
  async addTeamMember(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const selected = Array.isArray(body.playerIds) ? body.playerIds : body.playerIds ? [body.playerIds] : body.playerId ? [String(body.playerId)] : [];
    const month = String(body.month || currentMonth());
    await this.teams.addMembers(BigInt(id), selected.map((playerId) => BigInt(playerId)), String(body.memberType || 'FIXED'), String(body.notes || ''), month);
    this.matchGateway.emitTeamUpdated(id, 'members');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }

  @Post('/teams/:teamId/members/:memberId/edit')
  async editTeamMember(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('memberId') memberId: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(teamId)))) return forbidden(res);
    await this.teams.updateMember(BigInt(teamId), BigInt(memberId), body.memberType || 'FIXED', body.notes);
    this.matchGateway.emitTeamUpdated(teamId, 'members');
    return res.redirect(`/teams/${teamId}/members?month=${body.month || currentMonth()}`);
  }

  @Post('/teams/:teamId/members/:memberId/delete')
  async deleteTeamMember(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('memberId') memberId: string, @Body('month') month: string) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(teamId)))) return forbidden(res);
    await this.teams.removeMember(BigInt(teamId), BigInt(memberId));
    this.matchGateway.emitTeamUpdated(teamId, 'members');
    return res.redirect(`/teams/${teamId}/members?month=${month || currentMonth()}`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
