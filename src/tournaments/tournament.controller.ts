import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature, safeTournamentSection } from '../common/controller-utils';
import { render } from '../common/view';
import { PrismaService } from '../prisma.service';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class TournamentController {
  constructor(
    private readonly prisma: PrismaService,
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
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    const returnSection = String(req.query.returnSection || 'settings');
    const prizeTotalPaid = await this.tournaments.prizeTotalPaid(BigInt(id));
    return render(res, 'tournaments/form', { tournament, action: `/tournaments/${id}/edit`, returnSection, prizeTotalPaid });
  }

  @Post('/tournaments/:id/edit')
  async updateTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    try {
      await this.tournaments.update(BigInt(id), body);
      this.matchGateway.emitTournamentUpdated(id, 'tournament');
      return res.redirect(`/tournaments/${id}/${safeTournamentSection(body.returnSection)}`);
    } catch (error) {
      const existing = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
      const prizeTotalPaid = await this.tournaments.prizeTotalPaid(BigInt(id));
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
    await this.prisma.tournament.delete({ where: { id: BigInt(id) } });
    return res.redirect('/tournaments');
  }

  @Get('/tournaments/:id/:section')
  async tournamentDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const user = requireFeature(req, res, this.auth, 'TOURNAMENTS');
    if (!user) return;
    const tournamentId = BigInt(id);
    if (!(await this.tournaments.canView(user, tournamentId))) return res.status(403).render('error', { message: 'Không có quyền' });
    const [tournament, registrations, reserveRegistrations, withdrawnRegistrations, players, matches, rankingGroups, groupBoards] = await Promise.all([
      this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } }),
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'ACTIVE' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'RESERVE' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'WITHDRAWN' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.matchGame.findMany({ where: { tournamentId }, orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }] }),
      this.tournaments.rankings(tournamentId),
      this.tournaments.groupBoards(tournamentId),
    ]);
    return render(res, 'tournaments/detail', {
      section,
      tournament,
      registrations,
      reserveRegistrations,
      withdrawnRegistrations,
      players,
      matches,
      rankingGroups,
      groupBoards,
      minimumFee: this.tournaments.minimumFee(tournament),
      externalLink: `${req.protocol}://${req.get('host')}/external-register/${id}`,
      tournamentLink: `${req.protocol}://${req.get('host')}/tournaments/${id}/players`,
    });
  }

  @Post('/tournaments/:id/registrations')
  async addRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('playerId') playerId: string | string[]) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const ids = Array.isArray(playerId) ? playerId : playerId ? [playerId] : [];
    await this.tournaments.registerPlayers(BigInt(id), ids.map((item) => BigInt(item)));
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/withdraw')
  async withdraw(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.withdraw(BigInt(id));
    this.matchGateway.emitTournamentUpdated(tournamentId, 'registrations');
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/registrations/:id/restore')
  async restore(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.restore(BigInt(id));
    this.matchGateway.emitTournamentUpdated(tournamentId, 'registrations');
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/registrations/:id/delete')
  async deleteRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.deleteRegistration(BigInt(id));
    this.matchGateway.emitTournamentUpdated(tournamentId, 'registrations');
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/registrations/:id/skill')
  async updateRegistrationSkill(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: { tournamentId: string; skillLevel?: string }) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.updateRegistrationSkill(BigInt(id), body.skillLevel || '');
    this.matchGateway.emitTournamentUpdated(body.tournamentId, 'registrations');
    return res.redirect(`/tournaments/${body.tournamentId}/players`);
  }

  @Post('/tournaments/:id/registrations/bulk')
  async bulkRegistrations(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const selected = Array.isArray(body.registrationIds) ? body.registrationIds : body.registrationIds ? [body.registrationIds] : [];
    const action = String(body.bulkAction || '');
    await this.tournaments.bulkRegistrations(selected.map((item) => BigInt(item)), action);
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/payment')
  async payment(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: { tournamentId: string; amount: string; status: string }) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.updatePayment(BigInt(id), body.amount, body.status);
    this.matchGateway.emitTournamentUpdated(body.tournamentId, 'payments');
    return res.redirect(`/tournaments/${body.tournamentId}/fees`);
  }

  @Post('/tournaments/:id/payments')
  async tournamentPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.updatePayments(body);
    this.matchGateway.emitTournamentUpdated(id, 'payments');
    return res.redirect(`/tournaments/${id}/fees`);
  }

  @Post('/tournaments/:id/generate-schedule')
  async generateSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.generateSchedule(BigInt(id));
    this.matchGateway.emitTournamentUpdated(id, 'schedule');
    return res.redirect(`/tournaments/${id}/schedule`);
  }

  @Post('/tournaments/:id/manual-schedule')
  async manualSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const pairCount = Math.max(0, Number(body.pairCount || 0));
    const teams: string[] = [];
    const usedNames = new Set<string>();
    for (let index = 1; index <= pairCount; index++) {
      const a = String(body[`teamA_${index}`] || '').trim();
      const b = String(body[`teamB_${index}`] || '').trim();
      if ((a && usedNames.has(a)) || (b && usedNames.has(b)) || (a && b && a === b)) continue;
      if (a) usedNames.add(a);
      if (b) usedNames.add(b);
      if (a && b) teams.push(`${a} / ${b}`);
      else if (a) teams.push(a);
      else if (b) teams.push(b);
    }
    await this.tournaments.generateManualSchedule(BigInt(id), teams);
    this.matchGateway.emitTournamentUpdated(id, 'schedule');
    return res.redirect(`/tournaments/${id}/schedule`);
  }

  @Get('/external-register/:id')
  async externalRegister(@Res() res: Response, @Param('id') id: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    return render(res, 'external-register', { tournament });
  }

  @Post('/external-register/:id')
  async externalRegisterSubmit(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const registration = await this.tournaments.registerExternal(BigInt(id), body.displayName, body.email, body.skillLevel);
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return render(res, 'external-success', { registration: { ...registration, tournamentId: id } });
  }
}
