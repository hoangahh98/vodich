import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature } from '../common/controller-utils';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class TournamentScheduleController {
  constructor(
    private readonly auth: AuthService,
    private readonly tournaments: TournamentService,
    private readonly matchGateway: MatchGateway,
  ) {}

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
    const teams = normalizeManualTeams(body);
    await this.tournaments.generateManualSchedule(BigInt(id), teams);
    this.matchGateway.emitTournamentUpdated(id, 'schedule');
    return res.redirect(`/tournaments/${id}/schedule`);
  }
}

function normalizeManualTeams(body: Record<string, string>) {
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
  return teams;
}
