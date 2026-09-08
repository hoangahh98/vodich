import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { forbidden, idList, notFound, parseBigId, safeTeamSection } from '../common/controller-utils';
import { render } from '../common/view';
import { GroupService } from '../groups/group.service';
import { MatchGateway } from '../tournaments/match.gateway';
import { TeamService } from './team.service';

@Controller()
@FeatureAccess('TEAMS')
export class TeamController {
  constructor(
    private readonly teams: TeamService,
    private readonly groups: GroupService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Get('/teams')
  async teamIndex(@Req() req: Request, @Res() res: Response) {
    const user = req.session.user!;
    const [teams, groups] = await Promise.all([this.teams.list(user), user.role === 'ADMIN' ? this.groups.list(user) : Promise.resolve([])]);
    return render(res, 'teams/index', { teams, groups });
  }

  @Post('/teams')
  @AdminOnly()
  async createTeam(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string | string[]>) {
    const user = req.session.user!;
    const team = await this.teams.create(user, String(body.name || ''), typeof body.description === 'string' ? body.description : undefined);
    // Chọn nhóm lúc tạo: liên kết + đưa cả nhóm vào đội ngay, người thêm vào nhóm sau này cũng tự vào.
    const groupIds = await this.groups.scopedIds(user, idList(body.groupIds));
    if (groupIds.length) await this.teams.linkGroups(team.id, groupIds, await this.groups.playerIdsOfGroups(user, groupIds), currentMonth());
    this.matchGateway.emitTeamsUpdated('team-created');
    return res.redirect(`/teams/${team.id}`);
  }

  @Post('/teams/:id/groups')
  @AdminOnly()
  async linkGroups(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    const user = req.session.user!;
    const teamId = parseBigId(id);
    if (!teamId) return notFound(res);
    if (!(await this.teams.canManage(user, teamId))) return forbidden(res);
    const month = String(body.month || currentMonth());
    const groupIds = await this.groups.scopedIds(user, idList(body.groupIds));
    if (groupIds.length) await this.teams.linkGroups(teamId, groupIds, await this.groups.playerIdsOfGroups(user, groupIds), month);
    this.matchGateway.emitTeamUpdated(id, 'members');
    return res.redirect(`/teams/${id}/members?month=${month}`);
  }

  @Post('/teams/:teamId/groups/:groupId/delete')
  @AdminOnly()
  async unlinkGroup(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('groupId') groupId: string, @Body('month') month: string) {
    const id = parseBigId(teamId);
    const gid = parseBigId(groupId);
    if (!id || !gid) return notFound(res);
    if (!(await this.teams.canManage(req.session.user!, id))) return forbidden(res);
    // Người chỉ thuộc nhóm này rời đội từ tháng đang chọn; GroupService tự gỡ dòng liên kết.
    await this.groups.detachTeamFromGroup(id, gid, month || currentMonth());
    this.matchGateway.emitTeamUpdated(teamId, 'members');
    return res.redirect(`/teams/${teamId}/members?month=${month || currentMonth()}`);
  }

  @Post('/teams/:id/delete')
  @AdminOnly()
  async deleteTeam(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const teamId = parseBigId(id);
    if (!teamId) return notFound(res);
    if (!(await this.teams.canManage(req.session.user!, teamId))) return forbidden(res);
    await this.teams.delete(teamId);
    this.matchGateway.emitTeamsUpdated('team-deleted');
    return res.redirect('/teams');
  }

  @Get('/teams/:id')
  teamDetailRedirect(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const query = req.query.month ? `?month=${req.query.month}` : '';
    return res.redirect(`/teams/${id}/overview${query}`);
  }

  @Get('/teams/:id/:section')
  async teamDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const month = String(req.query.month || currentMonth());
    const teamId = BigInt(id);
    if (!(await this.teams.canView(req.session.user!, teamId))) return forbidden(res);
    const teamLink = `${req.protocol}://${req.get('host')}/teams/${id}/members`;
    const user = req.session.user!;
    const groups = user.role === 'ADMIN' ? await this.groups.list(user) : [];
    return render(res, 'teams/detail', { ...(await this.teams.detailForMonth(teamId, month)), section: safeTeamSection(section), teamLink, groups });
  }

  @Post('/teams/:id/settings')
  @AdminOnly()
  async updateTeamSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.teams.updateTeam(BigInt(id), body.name, body.description);
    await this.teams.setFund(BigInt(id), body.month, body);
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
    const id = parseBigId(teamId);
    const permId = parseBigId(permissionId);
    if (!id || !permId) return notFound(res);
    if (!(await this.teams.canManage(req.session.user!, id))) return forbidden(res);
    await this.teams.removePermission(id, permId);
    this.matchGateway.emitTeamUpdated(teamId, 'permission-deleted');
    return res.redirect(`/teams/${teamId}/settings`);
  }
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
