import { MatchGame } from '@prisma/client';

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
