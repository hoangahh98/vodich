import { MatchGame } from '@prisma/client';
import { WAITING_PARTNER, splitTeamName } from './team-name';

type GroupBoardMatch = Pick<MatchGame, 'groupName' | 'teamA' | 'teamB'>;
type RankingMatch = Pick<MatchGame, 'groupName' | 'teamA' | 'teamB' | 'scoreA' | 'scoreB' | 'status'>;

export interface RankingRow {
  teamName: string;
  played: number;
  won: number;
  lost: number;
  rankingPoints: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

/** Một dòng xếp hạng CÁ NHÂN — dùng cho thể thức đổi đội sau mỗi vòng (Americano). */
export interface PlayerRankingRow extends Omit<RankingRow, 'teamName'> {
  playerName: string;
}

export interface RankingGroup {
  groupName: string;
  rows: RankingRow[];
}

export interface GroupBoard {
  groupName: string;
  teams: string[];
}

export class TournamentRankingCalculator {
  groupBoards(matches: GroupBoardMatch[]): GroupBoard[] {
    const groups = new Map<string, Set<string>>();
    for (const match of matches) {
      const groupName = this.groupNameFor(match.groupName);
      const teams = groups.get(groupName) ?? new Set<string>();
      teams.add(match.teamA);
      teams.add(match.teamB);
      groups.set(groupName, teams);
    }
    return [...groups.entries()].map(([groupName, teams]) => ({ groupName, teams: [...teams] }));
  }

  rankings(matches: RankingMatch[]): RankingGroup[] {
    const groups = new Map<string, Map<string, RankingAccumulator>>();
    for (const match of matches) {
      const groupName = this.groupNameFor(match.groupName);
      const rows = groups.get(groupName) ?? new Map<string, RankingAccumulator>();
      groups.set(groupName, rows);
      this.applyRanking(rows, match.teamA, match.scoreA, match.scoreB, match.status === 'FINISHED');
      this.applyRanking(rows, match.teamB, match.scoreB, match.scoreA, match.status === 'FINISHED');
    }
    return [...groups.entries()].map(([groupName, rows]) => ({
      groupName,
      rows: [...rows.values()].map((row) => row.toRow()).sort(compareRankingRows),
    }));
  }

  /**
   * Xếp hạng CÁ NHÂN: cộng điểm cho từng người trong đội, thay vì cho cả cặp.
   *
   * Bắt buộc với thể thức Đôi xoay vòng — ở đó mỗi vòng lại là một cặp khác, nên xếp theo tên
   * đội sẽ ra một bảng toàn những "đội" đánh đúng một trận, không phân nổi thứ hạng.
   *
   * Xếp theo TỔNG ĐIỂM GHI ĐƯỢC trước tiên (đúng chuẩn Americano) chứ không theo số trận
   * thắng: số trận mỗi người đánh không bằng nhau tuyệt đối, nhưng thắng một trận 11-10 và
   * thắng 11-2 thì đóng góp khác hẳn nhau.
   */
  playerRankings(matches: RankingMatch[]): PlayerRankingRow[] {
    const rows = new Map<string, RankingAccumulator>();
    for (const match of matches) {
      const finished = match.status === 'FINISHED';
      for (const name of playerNamesOf(match.teamA)) this.applyRanking(rows, name, match.scoreA, match.scoreB, finished);
      for (const name of playerNamesOf(match.teamB)) this.applyRanking(rows, name, match.scoreB, match.scoreA, finished);
    }
    return [...rows.values()].map((row) => row.toPlayerRow()).sort(comparePlayerRankingRows);
  }

  private groupNameFor(groupName: string | null) {
    return groupName || 'A';
  }

  private applyRanking(
    rows: Map<string, RankingAccumulator>,
    name: string,
    pointsFor: number,
    pointsAgainst: number,
    finished: boolean,
  ) {
    const row = rows.get(name) ?? new RankingAccumulator(name);
    row.apply(pointsFor, pointsAgainst, finished);
    rows.set(name, row);
  }
}

export function compareRankingRows(a: RankingRow, b: RankingRow) {
  return b.won - a.won || b.pointDiff - a.pointDiff || b.pointsFor - a.pointsFor || a.teamName.localeCompare(b.teamName);
}

export function comparePlayerRankingRows(a: PlayerRankingRow, b: PlayerRankingRow) {
  return b.pointsFor - a.pointsFor || b.pointDiff - a.pointDiff || b.won - a.won || a.playerName.localeCompare(b.playerName);
}

/** Tên người thật trong một đội — bỏ chỗ trống "Chờ thành viên" để nó không thành một VĐV. */
function playerNamesOf(teamName: string): string[] {
  return splitTeamName(teamName).filter((name) => name !== WAITING_PARTNER);
}

class RankingAccumulator {
  private played = 0;
  private won = 0;
  private lost = 0;
  private rankingPoints = 0;
  private pointsFor = 0;
  private pointsAgainst = 0;

  constructor(private readonly teamName: string) {}

  apply(pointsFor: number, pointsAgainst: number, finished: boolean) {
    if (!finished) return;
    this.pointsFor += pointsFor;
    this.pointsAgainst += pointsAgainst;
    this.played++;
    if (pointsFor > pointsAgainst) {
      this.won++;
      this.rankingPoints++;
    }
    if (pointsFor < pointsAgainst) this.lost++;
  }

  toPlayerRow(): PlayerRankingRow {
    const { teamName, ...rest } = this.toRow();
    return { playerName: teamName, ...rest };
  }

  toRow(): RankingRow {
    return {
      teamName: this.teamName,
      played: this.played,
      won: this.won,
      lost: this.lost,
      rankingPoints: this.rankingPoints,
      pointsFor: this.pointsFor,
      pointsAgainst: this.pointsAgainst,
      pointDiff: this.pointsFor - this.pointsAgainst,
    };
  }
}
