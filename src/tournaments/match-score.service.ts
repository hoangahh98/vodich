import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma.service';
import { ScorePayload } from '../realtime/socket-events';
import { CurrentUser } from '../types';
import { isKnockoutStage } from './tournament-schedule';
import { TournamentService } from './tournament.service';

/**
 * Lưu điểm một trận — dùng chung cho HAI đường vào: socket (`MatchGateway`) và HTTP dự phòng
 * (`POST /tournaments/:id/matches/:matchId/score`). Trước 28/9/2026 luật này nằm thẳng trong
 * gateway, không có đường nào khác, và exception trong handler socket bị Nest nuốt im lặng — điểm
 * 11-5 kết thúc trận mà máy nào refresh cũng không thấy, đúng ca chủ app báo. Giờ mọi lỗi đều đi
 * ra thành `{ ok: false, message, retryable }` để client biết mà thử lại hoặc đi đường khác.
 */

export interface ScoreRules {
  touchScore: number;
  maxScore: number;
}

export interface ComputedScore {
  scoreA: number;
  scoreB: number;
  status: 'PLAYING' | 'FINISHED';
  servingTeam: 'A' | 'B';
  scoreOrder: 1 | 2;
}

type TournamentRules = {
  touchScore?: number | null;
  maxScore?: number | null;
  knockoutTouchScore?: number | null;
  knockoutMaxScore?: number | null;
};

/** Điểm chạm / điểm tối đa theo vòng: vòng trong dùng bộ knockout, vòng bảng dùng bộ thường. */
export function scoreRulesFor(tournament: TournamentRules, stage: string | null | undefined): ScoreRules {
  const knockout = isKnockoutStage(stage || '');
  return {
    touchScore: Math.max(1, (knockout ? tournament.knockoutTouchScore || 15 : tournament.touchScore || 11) || 1),
    maxScore: Math.max(1, (knockout ? tournament.knockoutMaxScore || 19 : tournament.maxScore || 15) || 1),
  };
}

/**
 * Chuẩn hoá điểm gửi lên: không âm, không vượt trần (chạm điểm thì phải hơn 2, tối đa `maxScore`),
 * rồi suy trạng thái. Thuần, không đụng DB — `test/match-score.test.js` khoá.
 */
export function computeScore(body: Pick<ScorePayload, 'scoreA' | 'scoreB' | 'servingTeam' | 'scoreOrder'>, rules: ScoreRules): ComputedScore {
  let scoreA = Math.max(0, Number(body.scoreA) || 0);
  let scoreB = Math.max(0, Number(body.scoreB) || 0);
  const maxAllowed = (opponentScore: number) => {
    if (opponentScore >= rules.touchScore - 1) return Math.min(opponentScore + 2, rules.maxScore);
    return Math.min(rules.touchScore, rules.maxScore);
  };
  scoreA = Math.min(scoreA, maxAllowed(scoreB));
  scoreB = Math.min(scoreB, maxAllowed(scoreA));
  const high = Math.max(scoreA, scoreB);
  const diff = Math.abs(scoreA - scoreB);
  const status = high >= rules.maxScore || (high >= rules.touchScore && diff >= 2) ? 'FINISHED' : 'PLAYING';
  return {
    scoreA,
    scoreB,
    status,
    servingTeam: body.servingTeam === 'B' ? 'B' : 'A',
    scoreOrder: Number(body.scoreOrder) === 1 ? 1 : 2,
  };
}

export type SaveScoreOk = {
  ok: true;
  /** Bản ghi sau khi lưu, BigInt đã đổi thành chuỗi để gửi thẳng qua socket / JSON. */
  match: Record<string, unknown>;
  tournamentId: bigint;
  finished: boolean;
};

export type SaveScoreFail = {
  ok: false;
  message: string;
  /** true = lỗi tạm (DB, mạng) — client nên thử lại; false = sai quyền / sai trận, thử lại vô ích. */
  retryable: boolean;
};

export type SaveScoreResult = SaveScoreOk | SaveScoreFail;

@Injectable()
export class MatchScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tournaments: TournamentService,
  ) {}

  async save(user: CurrentUser | undefined, body: ScorePayload): Promise<SaveScoreResult> {
    if (!user || user.role !== 'ADMIN') return { ok: false, message: 'Không có quyền ghi điểm', retryable: false };
    let matchId: bigint;
    try {
      matchId = BigInt(String(body.matchId));
    } catch {
      return { ok: false, message: 'Trận không hợp lệ', retryable: false };
    }
    try {
      const featureSet = await this.auth.featureSet(user);
      if (!this.auth.can(user, 'TOURNAMENTS', featureSet)) return { ok: false, message: 'Không có quyền ghi điểm', retryable: false };
      const match = await this.prisma.matchGame.findUnique({ where: { id: matchId }, include: { tournament: true } });
      if (!match) return { ok: false, message: 'Trận không còn tồn tại', retryable: false };
      // Đường HTTP mang id giải trên URL — trận phải thuộc đúng giải ấy, kẻo ghi nhầm trận giải khác.
      if (body.tournamentId && String(body.tournamentId) !== String(match.tournamentId)) {
        return { ok: false, message: 'Trận không thuộc giải này', retryable: false };
      }
      if (!(await this.tournaments.canManage(user, match.tournamentId))) return { ok: false, message: 'Không có quyền ghi điểm', retryable: false };
      const computed = computeScore(body, scoreRulesFor(match.tournament, match.stage));
      const updated = await this.prisma.matchGame.update({ where: { id: match.id }, data: { ...computed, updatedAt: new Date() } });
      return { ok: true, match: stringifyBigInt(updated), tournamentId: match.tournamentId, finished: computed.status === 'FINISHED' };
    } catch (error) {
      // DB rớt / pool hết chỗ: nói rõ cho client là lỗi TẠM để nó thử lại, đừng để im như trước.
      console.error('[score] không lưu được điểm', { matchId: String(body.matchId), scoreA: body.scoreA, scoreB: body.scoreB }, error);
      return { ok: false, message: 'Máy chủ chưa lưu được điểm, đang thử lại…', retryable: true };
    }
  }
}

export function stringifyBigInt<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
