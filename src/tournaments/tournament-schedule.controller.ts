import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { MatchGateway } from './match.gateway';
import { formatTeamName } from './team-name';
import { ManualTeam, groupIndexOf, groupLetter } from './tournament-schedule';
import { TournamentService } from './tournament.service';

// Mọi route ở đây đều là thao tác ghi của admin, nên khai thẳng ở class (xem docs/bao-mat.md).
@FeatureAccess('TOURNAMENTS')
@AdminOnly()
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
    if (!(await this.tournaments.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.tournaments.generateSchedule(BigInt(id));
    this.matchGateway.emitTournamentUpdated(id, 'schedule');
    return res.redirect(`/tournaments/${id}/schedule`);
  }

  @Post('/tournaments/:id/manual-schedule')
  async manualSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    if (!(await this.tournaments.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const teams = normalizeManualTeams(body);
    await this.tournaments.generateManualSchedule(BigInt(id), teams);
    this.matchGateway.emitTournamentUpdated(id, 'schedule');
    return res.redirect(`/tournaments/${id}/schedule`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}

/**
 * Đọc form ghép tay / vòng quay: `teamA_i` (+ `teamB_i` khi thi đôi) là người, `group_i` là bảng
 * (tuỳ chọn, chỉ thể thức đánh bảng dùng). Tên trùng giữa các ô thì ô sau bị bỏ.
 */
function normalizeManualTeams(body: Record<string, string>): ManualTeam[] {
  const pairCount = Math.max(0, Number(body.pairCount || 0));
  const teams: ManualTeam[] = [];
  const usedNames = new Set<string>();
  for (let index = 1; index <= pairCount; index++) {
    const a = String(body[`teamA_${index}`] || '').trim();
    const b = String(body[`teamB_${index}`] || '').trim();
    if ((a && usedNames.has(a)) || (b && usedNames.has(b)) || (a && b && a === b)) continue;
    if (a) usedNames.add(a);
    if (b) usedNames.add(b);
    const groupIndex = groupIndexOf(body[`group_${index}`]);
    const group = groupIndex >= 0 ? groupLetter(groupIndex) : null;
    if (a && b) teams.push({ name: formatTeamName(a, b), group });
    else if (a) teams.push({ name: a, group });
    else if (b) teams.push({ name: b, group });
  }
  return teams;
}
