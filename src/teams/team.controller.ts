import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature, safeTeamSection } from '../common/controller-utils';
import { render } from '../common/view';
import { MatchGateway } from '../tournaments/match.gateway';
import { TeamService } from './team.service';

@Controller()
export class TeamController {
  constructor(
    private readonly auth: AuthService,
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Get('/teams')
  async teamIndex(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TEAMS')) return;
    return render(res, 'teams/index', { teams: await this.teams.list() });
  }

  @Post('/teams')
  async createTeam(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const team = await this.teams.create(body.name, body.description);
    this.matchGateway.emitTeamsUpdated('team-created');
    return res.redirect(`/teams/${team.id}`);
  }

  @Get('/teams/:id')
  async teamDetailRedirect(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS')) return;
    const query = req.query.month ? `?month=${req.query.month}` : '';
    return res.redirect(`/teams/${id}/overview${query}`);
  }

  @Get('/teams/:id/:section')
  async teamDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS')) return;
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    return render(res, 'teams/detail', { ...(await this.teams.detailForMonth(BigInt(id), month)), section: safeTeamSection(section) });
  }

  @Post('/teams/:id/members')
  async addTeamMember(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const selected = Array.isArray(body.playerIds) ? body.playerIds : body.playerIds ? [body.playerIds] : body.playerId ? [String(body.playerId)] : [];
    const month = String(body.month || new Date().toISOString().slice(0, 7));
    await this.teams.addMembers(BigInt(id), selected.map((playerId) => BigInt(playerId)), String(body.memberType || 'FIXED'), String(body.notes || ''), month);
    this.matchGateway.emitTeamUpdated(id, 'members');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }

  @Post('/teams/:teamId/members/:memberId/edit')
  async editTeamMember(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('memberId') memberId: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.updateMember(BigInt(teamId), BigInt(memberId), body.memberType || 'FIXED', body.notes);
    this.matchGateway.emitTeamUpdated(teamId, 'members');
    return res.redirect(`/teams/${teamId}/members?month=${body.month || new Date().toISOString().slice(0, 7)}`);
  }

  @Post('/teams/:teamId/members/:memberId/delete')
  async deleteTeamMember(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('memberId') memberId: string, @Body('month') month: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.removeMember(BigInt(teamId), BigInt(memberId));
    this.matchGateway.emitTeamUpdated(teamId, 'members');
    return res.redirect(`/teams/${teamId}/members?month=${month || new Date().toISOString().slice(0, 7)}`);
  }

  @Post('/teams/:id/fund')
  async setTeamFund(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'fund');
    return res.redirect(`/teams/${id}/overview?month=${body.month || new Date().toISOString().slice(0, 7)}`);
  }

  @Post('/teams/:id/settings')
  async updateTeamSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.updateTeam(BigInt(id), body.name, body.description);
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'settings');
    return res.redirect(`/teams/${id}/settings?month=${body.month || new Date().toISOString().slice(0, 7)}`);
  }

  @Post('/teams/:id/payments')
  async updateTeamPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const month = body.month || new Date().toISOString().slice(0, 7);
    await this.teams.updatePayments(BigInt(id), month, body);
    this.matchGateway.emitTeamUpdated(id, 'payments');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }

  @Post('/teams/:id/expenses')
  async addTeamExpense(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const month = body.month || new Date().toISOString().slice(0, 7);
    await this.teams.addExpense(BigInt(id), month, body.expenseDate, body.content, body.amount, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'expenses');
    return res.redirect(`/teams/${id}/overview?month=${month}`);
  }

  @Post('/teams/:teamId/expenses/:expenseId/delete')
  async deleteTeamExpense(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('expenseId') expenseId: string, @Body('month') month: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.deleteExpense(BigInt(teamId), BigInt(expenseId));
    this.matchGateway.emitTeamUpdated(teamId, 'expenses');
    return res.redirect(`/teams/${teamId}/overview?month=${month || new Date().toISOString().slice(0, 7)}`);
  }
}
