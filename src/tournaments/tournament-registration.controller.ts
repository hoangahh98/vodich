import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature } from '../common/controller-utils';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class TournamentRegistrationController {
  constructor(
    private readonly auth: AuthService,
    private readonly tournaments: TournamentService,
    private readonly matchGateway: MatchGateway,
  ) {}

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
}
