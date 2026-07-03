import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature, safeTournamentSection } from '../common/controller-utils';
import { render } from '../common/view';
import { TournamentDetailViewModelBuilder } from './tournament-detail-view-model';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class TournamentController {
  constructor(
    private readonly auth: AuthService,
    private readonly detailViewModel: TournamentDetailViewModelBuilder,
    private readonly tournaments: TournamentService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Get('/tournaments')
  async tournamentIndex(@Req() req: Request, @Res() res: Response) {
    const user = requireFeature(req, res, this.auth, 'TOURNAMENTS');
    if (!user) return;
    const tournaments = await this.tournaments.listFor(user);
    return render(res, 'tournaments/index', { tournaments });
  }

  @Get('/tournaments/new')
  newTournament(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    return render(res, 'tournaments/form', { tournament: null, action: '/tournaments', prizeTotalPaid: 0 });
  }

  @Post('/tournaments')
  async createTournament(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    try {
      const tournament = await this.tournaments.create(body, req.session.user!);
      return res.redirect(`/tournaments/${tournament.id}/players`);
    } catch (error) {
      return render(res, 'tournaments/form', {
        tournament: null,
        action: '/tournaments',
        prizeTotalPaid: 0,
        error: error instanceof Error ? error.message : 'Không lưu được giải đấu',
      });
    }
  }

  @Get('/tournaments/:id/edit')
  async editTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    const tournament = await this.tournaments.findTournament(tournamentId);
    const returnSection = String(req.query.returnSection || 'settings');
    const prizeTotalPaid = await this.tournaments.prizeTotalPaid(tournamentId);
    return render(res, 'tournaments/form', { tournament, action: `/tournaments/${id}/edit`, returnSection, prizeTotalPaid });
  }

  @Post('/tournaments/:id/edit')
  async updateTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    try {
      await this.tournaments.update(tournamentId, body);
      this.matchGateway.emitTournamentUpdated(id, 'tournament');
      return res.redirect(`/tournaments/${id}/${safeTournamentSection(body.returnSection)}`);
    } catch (error) {
      const existing = await this.tournaments.findTournament(tournamentId);
      const prizeTotalPaid = await this.tournaments.prizeTotalPaid(tournamentId);
      return render(res, 'tournaments/form', {
        tournament: { ...existing, ...body, id: existing.id },
        action: `/tournaments/${id}/edit`,
        returnSection: safeTournamentSection(body.returnSection),
        prizeTotalPaid,
        error: error instanceof Error ? error.message : 'Không lưu được giải đấu',
      });
    }
  }

  @Post('/tournaments/:id/delete')
  async deleteTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    await this.tournaments.delete(tournamentId);
    return res.redirect('/tournaments');
  }

  @Post('/tournaments/:id/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canManage(req.session.user!, tournamentId))) return forbidden(res);
    await this.tournaments.addPermission(tournamentId, BigInt(adminId));
    this.matchGateway.emitTournamentUpdated(id, 'permission-added');
    return res.redirect(`/tournaments/${id}/settings`);
  }

  @Post('/tournaments/:tournamentId/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('tournamentId') tournamentId: string, @Param('permissionId') permissionId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const id = BigInt(tournamentId);
    if (!(await this.tournaments.canManage(req.session.user!, id))) return forbidden(res);
    await this.tournaments.removePermission(BigInt(permissionId));
    this.matchGateway.emitTournamentUpdated(tournamentId, 'permission-deleted');
    return res.redirect(`/tournaments/${tournamentId}/settings`);
  }

  @Get('/tournaments/:id/:section')
  async tournamentDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const user = requireFeature(req, res, this.auth, 'TOURNAMENTS');
    if (!user) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canView(user, tournamentId))) return res.status(403).render('error', { message: 'Không có quyền' });
    const detail = await this.tournaments.detail(tournamentId);
    const minimumFee = this.tournaments.minimumFee(detail.tournament);
    const externalLink = `${req.protocol}://${req.get('host')}/external-register/${id}`;
    const tournamentLink = `${req.protocol}://${req.get('host')}/tournaments/${id}/players`;
    const viewModel = this.detailViewModel.build({ currentUser: user, detail, externalLink, minimumFee, tournamentLink });
    return render(res, 'tournaments/detail', {
      section,
      ...detail,
      ...viewModel,
      detailContext: viewModel,
      minimumFee,
    });
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
