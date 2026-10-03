import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { idList, notFound, parseBigId, requireAnyFeature } from '../common/controller-utils';
import { AdminOnly } from '../common/feature.decorator';
import { render } from '../common/view';
import { PlayersService } from '../players/players.service';
import { currentMonth } from '../teams/team.controller';
import { GroupService } from './group.service';

/** Nhóm thành viên — phục vụ cả đội bóng lẫn giải đấu nên mở cho admin có TOURNAMENTS hoặc TEAMS. */
@AdminOnly()
@Controller()
export class GroupController {
  constructor(
    private readonly groups: GroupService,
    private readonly players: PlayersService,
    private readonly auth: AuthService,
  ) {}

  @Get('/groups')
  async index(@Req() req: Request, @Res() res: Response) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const [groups, players] = await Promise.all([this.groups.list(user), this.players.list()]);
    return render(res, 'groups/index', { groups, players });
  }

  @Get('/groups/:id')
  async detail(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const groupId = parseBigId(id);
    const group = groupId ? await this.groups.findScoped(user, groupId) : null;
    if (!group) return notFound(res, 'Không tìm thấy nhóm');
    return render(res, 'groups/detail', { group, players: await this.players.list(), currentMonth: currentMonth() });
  }

  @Post('/groups')
  async create(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const group = await this.groups.create(user, body.name);
    return res.redirect(`/groups/${group.id}`);
  }

  @Post('/groups/:id/members')
  async addMembers(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const groupId = parseBigId(id);
    if (!groupId) return notFound(res);
    await this.groups.addMembers(user, groupId, idList(body.playerIds), startMonth(body.startMonth));
    return res.redirect(`/groups/${id}`);
  }

  /** Trang soi trước: đưa ra khỏi nhóm thì rời đội nào, còn nợ gì. Nút xác nhận mới POST xoá thật. */
  @Get('/groups/:groupId/members/:playerId/remove')
  async removePreview(@Req() req: Request, @Res() res: Response, @Param('groupId') groupId: string, @Param('playerId') playerId: string) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const gid = parseBigId(groupId);
    const pid = parseBigId(playerId);
    if (!gid || !pid) return notFound(res);
    const preview = await this.groups.removalPreview(user, gid, pid, currentMonth());
    if (!preview) return notFound(res, 'Không tìm thấy nhóm hoặc thành viên');
    return render(res, 'groups/remove-member', { preview });
  }

  @Post('/groups/:groupId/members/:playerId/delete')
  async removeMember(@Req() req: Request, @Res() res: Response, @Param('groupId') groupId: string, @Param('playerId') playerId: string) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const gid = parseBigId(groupId);
    const pid = parseBigId(playerId);
    if (!gid || !pid) return notFound(res);
    await this.groups.removeMember(user, gid, pid, currentMonth());
    return res.redirect(`/groups/${groupId}`);
  }

  @Post('/groups/:id/delete')
  async remove(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const groupId = parseBigId(id);
    if (!groupId) return notFound(res);
    await this.groups.deleteWithTeams(user, groupId, currentMonth());
    return res.redirect('/groups');
  }
}

/**
 * Tháng bắt đầu tính phí khi thêm người vào nhóm có đội liên kết (chủ app 4/10/2026). Mặc định tháng hiện
 * tại; chỉ nhận tháng hiện tại trở đi. Ca thật: diu được thêm ngày 28/9 — tháng 9 đã thu đủ 405k của 13
 * người — mà app xếp luôn vào tháng 9, phí chia lại còn 377k cho 14 người trong khi diu chỉ chơi từ tháng 10.
 */
export function startMonth(value: unknown): string {
  const now = currentMonth();
  const month = typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : now;
  return month < now ? now : month;
}
