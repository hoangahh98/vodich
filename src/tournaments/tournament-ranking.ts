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

export interface FinishedMatchSummary {
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  status?: string;
  groupName?: string | null;
  stage?: string;
}

export interface CrossGroupResult {
  directlyQualified: string[];
  shortage: number;
  targetCount: number;
  suggested: RankingRow[];
  candidates: RankingRow[];
  crossGroupStandings: RankingRow[];
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

  rankingsWithHeadToHead(matches: RankingMatch[]): RankingGroup[] {
    const baseRankings = this.rankings(matches);
    return baseRankings.map((g) => ({
      groupName: g.groupName,
      rows: sortGroupRowsWithHeadToHead(g.rows, matches as FinishedMatchSummary[]),
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

export function pairKey(a: string, b: string): string {
  const normA = (a || '').trim();
  const normB = (b || '').trim();
  return normA < normB ? `${normA}:::${normB}` : `${normB}:::${normA}`;
}

export function buildHeadToHeadMap(
  matches: FinishedMatchSummary[] = [],
): Map<string, FinishedMatchSummary[]> {
  const map = new Map<string, FinishedMatchSummary[]>();
  if (!Array.isArray(matches)) return map;
  for (const m of matches) {
    if (!m) continue;
    if (m.status !== undefined && m.status !== 'FINISHED') continue;
    if (!m.teamA || !m.teamB) continue;
    const key = pairKey(m.teamA, m.teamB);
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }
  return map;
}

export function directHeadToHead(
  teamA: string,
  teamB: string,
  matchesOrMap?: FinishedMatchSummary[] | Map<string, FinishedMatchSummary[]> | null,
): number {
  if (!teamA || !teamB || !matchesOrMap) return 0;
  const normA = teamA.trim();
  const normB = teamB.trim();
  if (!normA || !normB || normA === normB) return 0;

  let directMatches: FinishedMatchSummary[];
  if (matchesOrMap instanceof Map) {
    const key = pairKey(normA, normB);
    directMatches = matchesOrMap.get(key) || [];
  } else if (Array.isArray(matchesOrMap)) {
    directMatches = matchesOrMap.filter((m) => {
      if (!m) return false;
      const isFinished = m.status === undefined || m.status === 'FINISHED';
      if (!isFinished) return false;
      const ma = (m.teamA || '').trim();
      const mb = (m.teamB || '').trim();
      return (ma === normA && mb === normB) || (ma === normB && mb === normA);
    });
  } else {
    return 0;
  }

  if (!directMatches.length) return 0;

  let winsA = 0;
  let winsB = 0;
  let pointsForA = 0;
  let pointsForB = 0;

  for (const m of directMatches) {
    const isTeamAFirst = (m.teamA || '').trim() === normA;
    const scoreA = isTeamAFirst ? m.scoreA : m.scoreB;
    const scoreB = isTeamAFirst ? m.scoreB : m.scoreA;

    pointsForA += scoreA;
    pointsForB += scoreB;
    if (scoreA > scoreB) winsA++;
    else if (scoreB > scoreA) winsB++;
  }

  // 1. Số trận thắng đối đầu
  if (winsA > winsB) return -1;
  if (winsB > winsA) return 1;

  // 2. Hiệu số điểm đối đầu trực tiếp
  const diffA = pointsForA - pointsForB;
  if (diffA > 0) return -1;
  if (diffA < 0) return 1;

  // 3. Tổng điểm ghi được trong các trận đối đầu
  if (pointsForA > pointsForB) return -1;
  if (pointsForA < pointsForB) return 1;

  return 0;
}

export function compareWithHeadToHead(
  a: RankingRow,
  b: RankingRow,
  matchesOrMap?: FinishedMatchSummary[] | Map<string, FinishedMatchSummary[]> | null,
): number {
  return (
    b.won - a.won ||
    (matchesOrMap ? directHeadToHead(a.teamName, b.teamName, matchesOrMap) : 0) ||
    b.pointDiff - a.pointDiff ||
    b.pointsFor - a.pointsFor ||
    a.teamName.localeCompare(b.teamName)
  );
}

export function sortGroupRowsWithHeadToHead(
  rows: RankingRow[],
  matches: FinishedMatchSummary[] | Map<string, FinishedMatchSummary[]> = [],
): RankingRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const matchMap = matches instanceof Map ? matches : buildHeadToHeadMap(matches || []);

  // 1. Nhóm theo số trận thắng tổng thể
  const buckets = new Map<number, RankingRow[]>();
  for (const row of rows) {
    const list = buckets.get(row.won) ?? [];
    list.push(row);
    buckets.set(row.won, list);
  }

  const sortedWons = [...buckets.keys()].sort((a, b) => b - a);
  const result: RankingRow[] = [];

  for (const won of sortedWons) {
    const tiedRows = buckets.get(won)!;
    if (tiedRows.length === 1) {
      result.push(tiedRows[0]);
    } else if (tiedRows.length === 2) {
      const sorted2 = [...tiedRows].sort((a, b) => compareWithHeadToHead(a, b, matchMap));
      result.push(...sorted2);
    } else {
      // 3 hoặc nhiều đội bằng số trận thắng: tính bảng phụ (mini-table) giữa các đội này
      type MiniStats = {
        row: RankingRow;
        miniWon: number;
        miniPointsFor: number;
        miniPointsAgainst: number;
        miniDiff: number;
      };
      const statsMap = new Map<string, MiniStats>();
      for (const row of tiedRows) {
        statsMap.set(row.teamName.trim(), {
          row,
          miniWon: 0,
          miniPointsFor: 0,
          miniPointsAgainst: 0,
          miniDiff: 0,
        });
      }

      for (let i = 0; i < tiedRows.length; i++) {
        for (let j = i + 1; j < tiedRows.length; j++) {
          const normTA = tiedRows[i].teamName.trim();
          const normTB = tiedRows[j].teamName.trim();
          const key = pairKey(normTA, normTB);
          const direct = matchMap.get(key) || [];
          for (const m of direct) {
            const isAFirst = (m.teamA || '').trim() === normTA;
            const sA = isAFirst ? m.scoreA : m.scoreB;
            const sB = isAFirst ? m.scoreB : m.scoreA;
            const statA = statsMap.get(normTA)!;
            const statB = statsMap.get(normTB)!;
            statA.miniPointsFor += sA;
            statA.miniPointsAgainst += sB;
            statB.miniPointsFor += sB;
            statB.miniPointsAgainst += sA;
            if (sA > sB) statA.miniWon++;
            else if (sB > sA) statB.miniWon++;
          }
        }
      }

      for (const stat of statsMap.values()) {
        stat.miniDiff = stat.miniPointsFor - stat.miniPointsAgainst;
      }

      // Phân nhóm theo miniWon
      const miniWonBuckets = new Map<number, MiniStats[]>();
      for (const stat of statsMap.values()) {
        const list = miniWonBuckets.get(stat.miniWon) ?? [];
        list.push(stat);
        miniWonBuckets.set(stat.miniWon, list);
      }
      const sortedMiniWons = [...miniWonBuckets.keys()].sort((a, b) => b - a);

      for (const mw of sortedMiniWons) {
        const mwStats = miniWonBuckets.get(mw)!;
        if (mwStats.length === 1) {
          result.push(mwStats[0].row);
        } else if (mwStats.length === 2) {
          // Đúng 2 đội bằng miniWon: đối đầu trực tiếp giữa 2 đội phân định
          const sorted2 = mwStats.map((s) => s.row).sort((a, b) => compareWithHeadToHead(a, b, matchMap));
          result.push(...sorted2);
        } else {
          // 3+ đội bằng miniWon: phân nhóm theo miniDiff
          const diffBuckets = new Map<number, MiniStats[]>();
          for (const s of mwStats) {
            const list = diffBuckets.get(s.miniDiff) ?? [];
            list.push(s);
            diffBuckets.set(s.miniDiff, list);
          }
          const sortedDiffs = [...diffBuckets.keys()].sort((a, b) => b - a);

          for (const md of sortedDiffs) {
            const diffStats = diffBuckets.get(md)!;
            if (diffStats.length === 1) {
              result.push(diffStats[0].row);
            } else if (diffStats.length === 2) {
              // 2 đội còn lại có cùng miniDiff: đối đầu trực tiếp giữa 2 đội
              const sorted2 = diffStats.map((s) => s.row).sort((a, b) => compareWithHeadToHead(a, b, matchMap));
              result.push(...sorted2);
            } else {
              // 3+ đội bằng cả miniWon lẫn miniDiff: điểm ghi được mini-table -> điểm toàn bảng -> chữ cái
              const sortedMulti = [...diffStats].sort((a, b) => {
                if (b.miniPointsFor !== a.miniPointsFor) return b.miniPointsFor - a.miniPointsFor;
                if (b.row.pointDiff !== a.row.pointDiff) return b.row.pointDiff - a.row.pointDiff;
                if (b.row.pointsFor !== a.row.pointsFor) return b.row.pointsFor - a.row.pointsFor;
                return a.row.teamName.localeCompare(b.row.teamName);
              });
              result.push(...sortedMulti.map((s) => s.row));
            }
          }
        }
      }
    }
  }

  return result;
}

export function aggregateCrossGroupStandings(
  rankingGroups: RankingGroup[],
  finishedMatches: FinishedMatchSummary[] = [],
  advancePerGroup: number,
  targetKnockoutCount: number,
): CrossGroupResult {
  const normAdvance = Math.max(1, Number(advancePerGroup) || 1);
  const normTarget = Math.max(0, Number(targetKnockoutCount) || 0);
  const matchesList = finishedMatches || [];
  const safeGroups = Array.isArray(rankingGroups) ? rankingGroups : [];

  const directlyQualified: string[] = [];
  const qualifiedSet = new Set<string>();

  for (const group of safeGroups) {
    if (!group || !Array.isArray(group.rows)) continue;
    const advancing = group.rows.slice(0, normAdvance);
    for (const row of advancing) {
      directlyQualified.push(row.teamName);
      qualifiedSet.add(row.teamName);
    }
  }

  const shortage = Math.max(0, normTarget - directlyQualified.length);

  interface EnrichedRow extends RankingRow {
    groupRank: number;
    groupName: string;
  }

  const allRows: EnrichedRow[] = [];
  for (const group of safeGroups) {
    if (!group || !Array.isArray(group.rows)) continue;
    group.rows.forEach((row, index) => {
      allRows.push({
        ...row,
        groupRank: index + 1,
        groupName: group.groupName,
      });
    });
  }

  allRows.sort((a, b) => {
    if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
    if (b.won !== a.won) return b.won - a.won;
    const h2h = directHeadToHead(a.teamName, b.teamName, matchesList);
    if (h2h !== 0) return h2h;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamName.localeCompare(b.teamName);
  });

  const crossGroupStandings: RankingRow[] = allRows.map(({ groupRank, groupName, ...rest }) => rest);
  const candidates = crossGroupStandings.filter((row) => !qualifiedSet.has(row.teamName));
  const suggested = shortage > 0 ? candidates.slice(0, shortage) : [];

  return {
    directlyQualified,
    shortage,
    targetCount: normTarget,
    suggested,
    candidates,
    crossGroupStandings,
  };
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
