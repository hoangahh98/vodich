import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { isRootAdmin } from '../common/admin-scope';
import { idList, notFound, parseBigId, requireAnyFeature } from '../common/controller-utils';
import { AdminOnly } from '../common/feature.decorator';
import { render } from '../common/view';
import { PlayerAccessService } from './player-access.service';
import { PlayersService } from './players.service';

/**
 * Danh sách thành viên + quyền xem của từng người (xem docs/bao-mat.md, mục 3b).
 *
 * Không khai `@FeatureAccess` ở class vì trang này phục vụ CẢ HAI module: admin chỉ có TEAMS
 * vẫn cần vào để cấp quyền xem đội. Điều kiện "có ít nhất một trong hai feature" kiểm ở
 * `requireAnyFeature`; `@AdminOnly` vẫn chặn vai CLIENT ngay từ guard.
 */
@AdminOnly()
@Controller()
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly access: PlayerAccessService,
    private readonly auth: AuthService,
  ) {}

  @Get('/players')
  async players(@Req() req: Request, @Res() res: Response) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const featureSet = this.featureSet(res);
    const players = await this.playersService.listWithAccess(this.access.countFilters(user, featureSet));
    return render(res, 'players/index', { players });
  }

  @Post('/players')
  async createPlayer(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS'])) return;
    await this.playersService.upsert(body);
    return res.redirect('/players');
  }

  @Post('/players/bulk')
  async updatePlayers(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS'])) return;
    await this.playersService.bulkUpdate(body);
    return res.redirect('/players');
  }

  @Get('/players/:id/access')
  async accessPage(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const playerId = parseBigId(id);
    const player = playerId ? await this.playersService.find(playerId) : null;
    if (!player) return notFound(res, 'Không tìm thấy thành viên');
    const targets = await this.access.targetsFor(user, this.featureSet(res), player.id);
    return render(res, 'players/access', { player, ...targets, isRoot: isRootAdmin(user) });
  }

  @Post('/players/:id/access')
  async saveAccess(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[] | undefined>) {
    const user = requireAnyFeature(req, res, this.auth, ['TOURNAMENTS', 'TEAMS']);
    if (!user) return;
    const playerId = parseBigId(id);
    const player = playerId ? await this.playersService.find(playerId) : null;
    if (!player) return notFound(res, 'Không tìm thấy thành viên');
    await this.access.save(user, this.featureSet(res), player.id, idList(body.tournamentIds), idList(body.teamIds));
    return res.redirect('/players');
  }

  private featureSet(res: Response): Set<string> {
    return (res.locals.featureSet as Set<string>) || new Set();
  }

}
