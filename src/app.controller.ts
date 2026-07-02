import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { TournamentService } from './tournaments/tournament.service';
import { TeamService } from './teams/team.service';
import { render, redirectBack } from './common/view';
import { parseMoney } from './common/money';
import { AppFeature, CurrentUser, UserRole } from './types';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tournaments: TournamentService,
    private readonly teams: TeamService,
  ) {}

  @Get('/login')
  loginPage(@Res() res: Response) {
    return render(res, 'login');
  }

  @Post('/login')
  async login(@Req() req: Request, @Res() res: Response, @Body() body: { username: string; password: string; role: UserRole }) {
    try {
      req.session.user = await this.auth.login(body.username || '', body.password || '', body.role || 'ADMIN');
      return res.redirect('/');
    } catch (error) {
      return render(res, 'login', { error: error instanceof Error ? error.message : 'Đăng nhập thất bại' });
    }
  }

  @Post('/logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.session.destroy(() => res.redirect('/login'));
  }

  @Get('/')
  async home(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'home');
  }

  @Get('/players')
  async players(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const players = await this.prisma.player.findMany({ orderBy: { displayName: 'asc' } });
    return render(res, 'players/index', { players });
  }

  @Post('/players')
  async createPlayer(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.prisma.player.upsert({
      where: { email: body.email.trim().toLowerCase() },
      update: {
        displayName: body.displayName.trim(),
        skillLevel: blankToNull(body.skillLevel),
        notes: blankToNull(body.notes),
      },
      create: {
        displayName: body.displayName.trim(),
        email: body.email.trim().toLowerCase(),
        skillLevel: blankToNull(body.skillLevel),
        notes: blankToNull(body.notes),
      },
    });
    return res.redirect('/players');
  }

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
    return render(res, 'tournaments/form', { tournament: null, action: '/tournaments' });
  }

  @Post('/tournaments')
  async createTournament(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournament = await this.tournaments.create(body);
    return res.redirect(`/tournaments/${tournament.id}/players`);
  }

  @Get('/tournaments/:id/edit')
  async editTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    return render(res, 'tournaments/form', { tournament, action: `/tournaments/${id}/edit` });
  }

  @Post('/tournaments/:id/edit')
  async updateTournament(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.update(BigInt(id), body);
    return res.redirect(`/tournaments/${id}/players`);
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
    });
  }

  @Post('/tournaments/:id/registrations')
  async addRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('playerId') playerId: string | string[]) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const ids = Array.isArray(playerId) ? playerId : playerId ? [playerId] : [];
    await this.tournaments.registerPlayers(BigInt(id), ids.map((item) => BigInt(item)));
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/withdraw')
  async withdraw(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.withdraw(BigInt(id));
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/registrations/:id/restore')
  async restore(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.restore(BigInt(id));
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/registrations/:id/delete')
  async deleteRegistration(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('tournamentId') tournamentId: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.deleteRegistration(BigInt(id));
    return res.redirect(`/tournaments/${tournamentId}/players`);
  }

  @Post('/tournaments/:id/registrations/bulk')
  async bulkRegistrations(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    const selected = Array.isArray(body.registrationIds) ? body.registrationIds : body.registrationIds ? [body.registrationIds] : [];
    const action = String(body.bulkAction || '');
    await this.tournaments.bulkRegistrations(selected.map((item) => BigInt(item)), action);
    return res.redirect(`/tournaments/${id}/players`);
  }

  @Post('/registrations/:id/payment')
  async payment(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: { tournamentId: string; amount: string; status: string }) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.updatePayment(BigInt(id), body.amount, body.status);
    return res.redirect(`/tournaments/${body.tournamentId}/fees`);
  }

  @Post('/tournaments/:id/payments')
  async tournamentPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.updatePayments(body);
    return res.redirect(`/tournaments/${id}/fees`);
  }

  @Post('/tournaments/:id/generate-schedule')
  async generateSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    await this.tournaments.generateSchedule(BigInt(id));
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
    return render(res, 'external-success', { registration: { ...registration, tournamentId: id } });
  }

  @Get('/teams')
  async teamIndex(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TEAMS')) return;
    return render(res, 'teams/index', { teams: await this.teams.list() });
  }

  @Post('/teams')
  async createTeam(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const team = await this.teams.create(body.name, body.description);
    return res.redirect(`/teams/${team.id}`);
  }

  @Get('/teams/:id')
  async teamDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS')) return;
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    return render(res, 'teams/detail', await this.teams.detailForMonth(BigInt(id), month));
  }

  @Post('/teams/:id/members')
  async addTeamMember(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.addMember(BigInt(id), BigInt(body.playerId), body.memberType || 'FIXED');
    return redirectBack(res, `/teams/${id}`);
  }

  @Post('/teams/:id/fund')
  async setTeamFund(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.setFund(BigInt(id), body.month, body.monthlyFee, body.courtCost, body.previousBalance, body.notes);
    return res.redirect(`/teams/${id}?month=${body.month || new Date().toISOString().slice(0, 7)}`);
  }

  @Post('/teams/:id/payments')
  async updateTeamPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const month = body.month || new Date().toISOString().slice(0, 7);
    await this.teams.updatePayments(month, body);
    return res.redirect(`/teams/${id}?month=${month}`);
  }

  @Post('/teams/:id/expenses')
  async addTeamExpense(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    const month = body.month || new Date().toISOString().slice(0, 7);
    await this.teams.addExpense(BigInt(id), month, body.expenseDate, body.content, body.amount, body.notes);
    return res.redirect(`/teams/${id}?month=${month}`);
  }

  @Post('/teams/:teamId/expenses/:expenseId/delete')
  async deleteTeamExpense(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('expenseId') expenseId: string, @Body('month') month: string) {
    if (!requireFeature(req, res, this.auth, 'TEAMS', true)) return;
    await this.teams.deleteExpense(BigInt(expenseId));
    return res.redirect(`/teams/${teamId}?month=${month || new Date().toISOString().slice(0, 7)}`);
  }

  @Get('/permissions')
  async permissions(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    if (!this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const admins = await this.prisma.appUser.findMany({ where: { role: 'ADMIN' }, include: { permissions: true }, orderBy: { id: 'asc' } });
    return render(res, 'permissions', { admins, features: ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS'] });
  }

  @Post('/permissions')
  async savePermissions(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string | string[]>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const adminId = BigInt(String(body.adminId));
    const features = Array.isArray(body.features) ? body.features : body.features ? [body.features] : [];
    await this.prisma.$transaction([
      this.prisma.adminFeaturePermission.deleteMany({ where: { adminId } }),
      this.prisma.adminFeaturePermission.createMany({
        data: features.map((feature) => ({ adminId, feature })),
        skipDuplicates: true,
      }),
    ]);
    return res.redirect('/permissions');
  }

  @Post('/admins')
  async createAdmin(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    await this.prisma.appUser.upsert({
      where: { username: body.username.trim().toLowerCase() },
      update: { displayName: body.displayName || body.username, passwordHash: await bcrypt.hash(body.password || '123456789', 10) },
      create: {
        username: body.username.trim().toLowerCase(),
        displayName: body.displayName || body.username,
        passwordHash: await bcrypt.hash(body.password || '123456789', 10),
        role: 'ADMIN',
      },
    });
    return res.redirect('/permissions');
  }

  @Get('/logs')
  async logs(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Chỉ admin gốc được xem log' });
    const level = String(req.query.level || 'ERROR');
    const where = level === 'ALL' ? {} : { level };
    const logs = await this.prisma.appLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return render(res, 'logs/index', { logs, level, levels: ['ERROR', 'WARN', 'INFO', 'ALL'] });
  }

  @Get('/travel')
  travel(@Req() req: Request, @Res() res: Response) {
    if (!requireFeature(req, res, this.auth, 'TRAVEL')) return;
    return render(res, 'travel/index');
  }
}

function requireUser(req: Request, res: Response): CurrentUser | undefined {
  if (!req.session.user) {
    res.redirect('/login');
    return undefined;
  }
  return req.session.user;
}

function requireFeature(req: Request, res: Response, auth: AuthService, feature: AppFeature, adminOnly = false): CurrentUser | undefined {
  const user = requireUser(req, res);
  if (!user) return undefined;
  const featureSet = res.locals.featureSet as Set<string>;
  if ((adminOnly && user.role !== 'ADMIN') || !auth.can(user, feature, featureSet)) {
    res.status(403).render('error', { message: 'Không có quyền' });
    return undefined;
  }
  return user;
}

function blankToNull(value?: string) {
  return value && value.trim() ? value.trim() : null;
}
