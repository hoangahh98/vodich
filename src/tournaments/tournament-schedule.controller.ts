import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireFeature } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { MatchGateway } from './match.gateway';
import { MatchScoreService } from './match-score.service';
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
    private readonly scores: MatchScoreService,
  ) {}

  /**
   * Đường DỰ PHÒNG ghi điểm khi socket không ack (Render đang ngủ dậy, mạng chập, DB rớt đúng lúc).
   * Cùng luật, cùng `MatchScoreService` với gateway; lưu xong vẫn phát `scoreUpdated` cho phòng giải.
   * Client gọi bằng fetch keepalive, lúc đóng tab thì bằng sendBeacon (body dạng form) — nên nhận cả
   * JSON lẫn urlencoded, và trả JSON chứ không redirect. Guard của class đã chặn người không phải admin.
   */
  @Post('/tournaments/:id/matches/:matchId/score')
  async saveScore(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() body: Record<string, string | number | undefined>,
  ) {
    const result = await this.scores.save(req.session.user, {
      tournamentId: id,
      matchId,
      scoreA: Number(body.scoreA) || 0,
      scoreB: Number(body.scoreB) || 0,
      servingTeam: String(body.servingTeam || 'A'),
      scoreOrder: Number(body.scoreOrder) || 2,
      seq: Number(body.seq) || undefined,
    });
    if (!result.ok) return res.status(result.retryable ? 503 : 403).json({ ok: false, message: result.message, retryable: result.retryable });
    await this.matchGateway.broadcastScore(result, { origin: body.origin ? String(body.origin) : undefined, seq: Number(body.seq) || undefined });
    return res.json({ ok: true, match: result.match });
  }

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

  @Post('/tournaments/:id/wildcards')
  async selectWildcards(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    if (!(await this.tournaments.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    let teams: string[] = [];
    if (Array.isArray(body.teams)) {
      teams = body.teams.map(String).map((s) => s.trim()).filter(Boolean);
    } else if (typeof body.teams === 'string') {
      try {
        const parsed = JSON.parse(body.teams);
        if (Array.isArray(parsed)) teams = parsed.map(String).map((s) => s.trim()).filter(Boolean);
      } catch {
        teams = [body.teams.trim()].filter(Boolean);
      }
    } else {
      // Form check-box fields: e.g. team_TeamName = 'on'
      for (const [key, val] of Object.entries(body)) {
        if (key.startsWith('wildcard_') && val === 'on') {
          teams.push(key.replace('wildcard_', ''));
        }
      }
    }
    try {
      await this.tournaments.selectWildcards(BigInt(id), teams);
      req.session.flash = 'Đã cập nhật danh sách đội bổ sung vào vòng trong';
      this.matchGateway.emitTournamentUpdated(id, 'schedule');
    } catch (error) {
      req.session.flash = error instanceof Error ? error.message : 'Không chọn được đội bổ sung';
    }
    return res.redirect(`/tournaments/${id}/schedule`);
  }

  @Post('/tournaments/:id/stage-draw')
  async saveStageDraw(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    if (!(await this.tournaments.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const stage = String(body.stage || 'Tứ kết');
    let pairs: { teamA: string; teamB: string }[] = [];
    if (Array.isArray(body.pairs)) {
      pairs = body.pairs as { teamA: string; teamB: string }[];
    } else if (typeof body.pairs === 'string') {
      try {
        pairs = JSON.parse(body.pairs);
      } catch {}
    } else {
      const pairCount = Math.max(0, Number(body.pairCount || 0));
      for (let i = 1; i <= pairCount; i++) {
        const teamA = String(body[`teamA_${i}`] || '').trim();
        const teamB = String(body[`teamB_${i}`] || '').trim();
        if (teamA && teamB) pairs.push({ teamA, teamB });
      }
    }
    try {
      await this.tournaments.saveStageDraw(BigInt(id), stage, pairs);
      req.session.flash = `Đã lưu kết quả bốc thăm ${stage}`;
      this.matchGateway.emitTournamentUpdated(id, 'schedule');
      if (req.headers.accept?.includes('application/json') || req.xhr) {
        return res.json({ ok: true });
      }
    } catch (error) {
      if (req.headers.accept?.includes('application/json') || req.xhr) {
        return res.status(400).json({ ok: false, message: error instanceof Error ? error.message : 'Lỗi bốc thăm' });
      }
      req.session.flash = error instanceof Error ? error.message : 'Không lưu được kết quả bốc thăm';
    }
    return res.redirect(`/tournaments/${id}/schedule`);
  }

  @Post('/tournaments/:id/advance-semifinals')
  async advanceSemifinals(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!requireFeature(req, res, this.auth, 'TOURNAMENTS', true)) return;
    if (!(await this.tournaments.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const mode = body.mode === 'WHEEL' ? 'WHEEL' : 'FIXED';
    let wheelPairs: { teamA: string; teamB: string }[] | undefined;
    if (mode === 'WHEEL') {
      if (Array.isArray(body.pairs)) {
        wheelPairs = body.pairs as { teamA: string; teamB: string }[];
      } else if (typeof body.pairs === 'string') {
        try {
          wheelPairs = JSON.parse(body.pairs);
        } catch {}
      }
    }
    try {
      await this.tournaments.advanceSemifinals(BigInt(id), mode, wheelPairs);
      req.session.flash = mode === 'WHEEL' ? 'Đã bốc thăm ghép cặp bán kết' : 'Đã chia cặp bán kết theo nhánh cố định';
      this.matchGateway.emitTournamentUpdated(id, 'schedule');
      if (req.headers.accept?.includes('application/json') || req.xhr) {
        return res.json({ ok: true });
      }
    } catch (error) {
      if (req.headers.accept?.includes('application/json') || req.xhr) {
        return res.status(400).json({ ok: false, message: error instanceof Error ? error.message : 'Lỗi chuyển bán kết' });
      }
      req.session.flash = error instanceof Error ? error.message : 'Không chuyển được sang bán kết';
    }
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
