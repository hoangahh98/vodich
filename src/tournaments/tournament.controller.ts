import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature, safeTournamentSection } from '../common/controller-utils';
import { render } from '../common/view';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class TournamentController {
  constructor(
    private readonly auth: AuthService,
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
      const tournament = await this.tournaments.create(body);
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
    const tournament = await this.tournaments.findTournament(tournamentId);
    const returnSection = String(req.query.returnSection || 'settings');
    const prizeTotalPaid = await this.tournaments.prizeTotalPaid(tournamentId);
    return render(res, 'tournaments/form', { tournament, action: `/tournaments/${id}/edit`, returnSection, prizeTotalPaid });
  }

  @Post('/tournaments/:id/edit')
  async updateTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournamentId = BigInt(id);
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
    await this.tournaments.delete(BigInt(id));
    return res.redirect('/tournaments');
  }

  @Get('/tournaments/:id/:section')
  async tournamentDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const user = requireFeature(req, res, this.auth, 'TOURNAMENTS');
    if (!user) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canView(user, tournamentId))) return res.status(403).render('error', { message: 'Không có quyền' });
    const detail = await this.tournaments.detail(tournamentId);
    return render(res, 'tournaments/detail', {
      section,
      ...detail,
      minimumFee: this.tournaments.minimumFee(detail.tournament),
      externalLink: `${req.protocol}://${req.get('host')}/external-register/${id}`,
      tournamentLink: `${req.protocol}://${req.get('host')}/tournaments/${id}/players`,
    });
  }
}
