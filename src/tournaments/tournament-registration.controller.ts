import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { forbidden, idList, notFound, parseBigId, requireFeature } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { GroupService } from '../groups/group.service';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

// Mọi route ở đây đều là thao tác ghi của admin, nên khai thẳng ở class (xem docs/bao-mat.md).
@FeatureAccess('TOURNAMENTS')
@AdminOnly()
@Controller()
export class TournamentRegistrationController {
  constructor(
    private readonly auth: AuthService,
    private readonly tournaments: TournamentService,
    private readonly matchGateway: MatchGateway,
    private readonly groups: GroupService,
  ) {}

  @Post('/tournaments/:id/registrations')
  async addRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    const user = requireFeature(req, res, this.auth, 'TOURNAMENTS', true);
    if (!user) return;
    const tournamentId = parseBigId(id);
    if (!tournamentId) return notFound(res);
    if (!(await this.tournaments.canManage(user, tournamentId))) return forbidden(res);
    // Người chọn lẻ + người của các nhóm đã tích, bỏ trùng (một người ở hai nhóm hoặc vừa ở nhóm vừa
    // được tích lẻ chỉ đăng ký một lần).
    const playerIds = mergeDistinct(idList(body.playerId), await this.groups.playerIdsOfGroups(user, idList(body.groupIds)));
    await this.tournaments.registerPlayers(tournamentId, playerIds);
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/withdraw')
  async withdraw(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const scope = await this.authorizeRegistration(req, res, id);
    if (!scope) return;
    await this.tournaments.withdraw(scope.registrationId);
    this.matchGateway.emitTournamentUpdated(scope.tournamentId, 'registrations');
    return res.redirect(`/tournaments/${scope.tournamentId}/players`);
  }

  @Post('/registrations/:id/restore')
  async restore(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const scope = await this.authorizeRegistration(req, res, id);
    if (!scope) return;
    await this.tournaments.restore(scope.registrationId);
    this.matchGateway.emitTournamentUpdated(scope.tournamentId, 'registrations');
    return res.redirect(`/tournaments/${scope.tournamentId}/players`);
  }

  @Post('/registrations/:id/delete')
  async deleteRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const scope = await this.authorizeRegistration(req, res, id);
    if (!scope) return;
    await this.tournaments.deleteRegistration(scope.registrationId);
    this.matchGateway.emitTournamentUpdated(scope.tournamentId, 'registrations');
    return res.redirect(`/tournaments/${scope.tournamentId}/players`);
  }

  @Post('/registrations/:id/skill')
  async updateRegistrationSkill(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: { skillLevel?: string }) {
    const scope = await this.authorizeRegistration(req, res, id);
    if (!scope) return;
    await this.tournaments.updateRegistrationSkill(scope.registrationId, body.skillLevel || '');
    this.matchGateway.emitTournamentUpdated(scope.tournamentId, 'registrations');
    return res.redirect(`/tournaments/${scope.tournamentId}/players`);
  }

  @Post('/tournaments/:id/registrations/bulk')
  async bulkRegistrations(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = parseBigId(id);
    if (!tournamentId) return notFound(res);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    const selected = Array.isArray(body.registrationIds) ? body.registrationIds : body.registrationIds ? [body.registrationIds] : [];
    const registrationIds = selected.map((item) => parseBigId(item)).filter((value): value is bigint => value !== null);
    const action = String(body.bulkAction || '');
    await this.tournaments.bulkRegistrations(tournamentId, registrationIds, action);
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/payment')
  async payment(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: { amount: string; status: string }) {
    const scope = await this.authorizeRegistration(req, res, id);
    if (!scope) return;
    await this.tournaments.updatePayment(scope.registrationId, body.amount, body.status);
    this.matchGateway.emitTournamentUpdated(scope.tournamentId, 'payments');
    return res.redirect(`/tournaments/${scope.tournamentId}/fees`);
  }

  @Post('/tournaments/:id/payments')
  async tournamentPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = parseBigId(id);
    if (!tournamentId) return notFound(res);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    await this.tournaments.updatePayments(tournamentId, body);
    this.matchGateway.emitTournamentUpdated(id, 'payments');
    return res.redirect(`/tournaments/${id}/fees`);
  }

  /**
   * Xác thực quyền dựa trên tournamentId THẬT của registration (lấy từ DB),
   * không tin tournamentId do client gửi trong body — chống IDOR chéo giải.
   */
  private async authorizeRegistration(req: Request, res: Response, id: string): Promise<{ registrationId: bigint; tournamentId: bigint } | null> {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return null;
    const registrationId = parseBigId(id);
    if (!registrationId) {
      notFound(res);
      return null;
    }
    const tournamentId = await this.tournaments.registrationTournamentId(registrationId);
    if (!tournamentId) {
      notFound(res);
      return null;
    }
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) {
      forbidden(res);
      return null;
    }
    return { registrationId, tournamentId };
  }
}

export function mergeDistinct(...lists: bigint[][]): bigint[] {
  return [...new Set(lists.flat().map(String))].map((id) => BigInt(id));
}
