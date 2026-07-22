import { MatchGame, Tournament, TournamentRegistration } from '@prisma/client';
import { RankingGroup, compareRankingRows } from './tournament-ranking';

export type MatchCreate = {
  tournamentId: bigint;
  teamA: string;
  teamB: string;
  courtNumber: number;
  roundNumber: number;
  stage: string;
  groupName?: string | null;
};

type RegisteredPlayer = TournamentRegistration & { player: { displayName: string } | null };

export class TournamentScheduleBuilder {
  fromRegistrations(tournament: Tournament, registrations: RegisteredPlayer[]): MatchCreate[] {
    // Đơn: mỗi người một "đội", chỉ cần xáo thứ tự. Đôi: GHÉP CÂN BẰNG theo trình (xem
    // buildBalancedDoublesTeams) rồi mới xáo thứ tự đội để rải sân/vòng.
    const teams =
      tournament.playType === 'DOUBLES'
        ? shuffle(buildBalancedDoublesTeams(registrations))
        : shuffle(registrations.map(displayRegistrationName));
    return this.fromTeams(tournament, teams);
  }

  fromManualPairs(tournament: Tournament, pairNames: string[]): MatchCreate[] {
    return this.fromTeams(
      tournament,
      pairNames.map((name) => name.trim()).filter(Boolean),
    );
  }

  private fromTeams(tournament: Tournament, teams: string[]): MatchCreate[] {
    const groupMatches = buildGroupMatches(tournament, teams);
    const knockout = tournament.format === 'GROUP_KNOCKOUT' ? buildKnockout(tournament) : [];
    return [...groupMatches, ...knockout];
  }
}

export function knockoutSeeds(qualifierCount: number, rankingGroups: RankingGroup[]) {
  const byGroup = new Map(rankingGroups.map((group) => [group.groupName, group.rows]));
  if (qualifierCount >= 8) {
    return [
      byGroup.get('A')?.[0]?.teamName,
      byGroup.get('B')?.[1]?.teamName,
      byGroup.get('B')?.[0]?.teamName,
      byGroup.get('A')?.[1]?.teamName,
      byGroup.get('C')?.[0]?.teamName,
      byGroup.get('D')?.[1]?.teamName,
      byGroup.get('D')?.[0]?.teamName,
      byGroup.get('C')?.[1]?.teamName,
    ].filter(Boolean) as string[];
  }
  if (qualifierCount >= 4) {
    return [
      byGroup.get('A')?.[0]?.teamName,
      byGroup.get('B')?.[1]?.teamName,
      byGroup.get('B')?.[0]?.teamName,
      byGroup.get('A')?.[1]?.teamName,
    ].filter(Boolean) as string[];
  }
  return rankingGroups.flatMap((group) => group.rows).sort(compareRankingRows).slice(0, 2).map((row) => row.teamName);
}

export function finishedStageWinners(matches: MatchGame[], stage: string): string[] | null {
  const stageMatches = matches.filter((match) => match.stage === stage).sort((a, b) => a.courtNumber - b.courtNumber || Number(a.id - b.id));
  if (!stageMatches.length || stageMatches.some((match) => match.status !== 'FINISHED')) return null;
  return stageMatches.map((match) => (match.scoreA > match.scoreB ? match.teamA : match.teamB));
}

function displayRegistrationName(reg: RegisteredPlayer) {
  return reg.player?.displayName || reg.externalName || reg.externalEmail || 'Chưa đặt tên';
}

/**
 * Ghép đội đôi CÂN BẰNG theo trình. Gom người theo trình, sắp các mức trình mạnh→yếu rồi
 * "gấp đôi" hai đầu vào nhau: mức mạnh nhất đấu chung đội với mức yếu nhất, cứ thế vào giữa.
 *
 *   1 mức trình         -> ghép random trong mức đó (ví dụ chỉ có C).
 *   2 mức (vd C, D)      -> C ghép D (cao ghép thấp).
 *   3 mức (vd A, B, C)   -> A(cao nhất) ghép C(thấp nhất), B(giữa) ghép với nhau.
 *   4 mức (A, B, C, D)   -> A ghép D, B ghép C.
 *
 * Trình rỗng/không rõ gom thành một mức, xếp yếu nhất. Số người trong hai mức ghép chéo
 * lệch nhau, hoặc mức giữa lẻ người, thì phần dư dồn lại ghép với nhau ở cuối; lẻ đúng 1
 * người cả giải thì để "Chờ thành viên".
 */
export function buildBalancedDoublesTeams(registrations: RegisteredPlayer[]): string[] {
  const byLevel = new Map<string, RegisteredPlayer[]>();
  for (const reg of registrations) {
    const level = normalizeSkill(reg.skillLevel);
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(reg);
    else byLevel.set(level, [reg]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => skillRank(a) - skillRank(b) || a.localeCompare(b));
  const teams: string[] = [];
  const leftovers: RegisteredPlayer[] = [];
  let lo = 0;
  let hi = levels.length - 1;
  while (lo < hi) {
    leftovers.push(...pairAcross(byLevel.get(levels[lo]) || [], byLevel.get(levels[hi]) || [], teams));
    lo++;
    hi--;
  }
  // Số mức lẻ -> còn mức GIỮA đứng một mình (cũng là trường hợp "chỉ 1 mức trình"): ghép
  // random trong mức đó.
  if (lo === hi) leftovers.push(...pairWithin(byLevel.get(levels[lo]) || [], teams));
  // Dồn hết người lẻ (do lệch số lượng giữa các mức) ghép nốt với nhau.
  const last = pairWithin(leftovers, teams);
  if (last.length) teams.push(`${displayRegistrationName(last[0])} / Chờ thành viên`);
  return teams;
}

/** Ghép chéo hai mức trình: mỗi đội một người mức mạnh + một người mức yếu. Trả người dư. */
function pairAcross(strong: RegisteredPlayer[], weak: RegisteredPlayer[], teams: string[]): RegisteredPlayer[] {
  const s = shuffle(strong);
  const w = shuffle(weak);
  const paired = Math.min(s.length, w.length);
  for (let i = 0; i < paired; i++) teams.push(`${displayRegistrationName(s[i])} / ${displayRegistrationName(w[i])}`);
  return [...s.slice(paired), ...w.slice(paired)];
}

/** Ghép random trong cùng một nhóm (mức trình giữa, hoặc gom người lẻ). Trả người lẻ cuối. */
function pairWithin(list: RegisteredPlayer[], teams: string[]): RegisteredPlayer[] {
  const s = shuffle(list);
  for (let i = 0; i + 1 < s.length; i += 2) teams.push(`${displayRegistrationName(s[i])} / ${displayRegistrationName(s[i + 1])}`);
  return s.length % 2 ? [s[s.length - 1]] : [];
}

/** Trình chuẩn hoá về chữ hoa; rỗng/không rõ gom về '?'. */
function normalizeSkill(raw: string | null): string {
  return String(raw || '').trim().toUpperCase() || '?';
}

/** Thứ tự mạnh→yếu: A<B<C<D; trình lạ/không rõ xếp yếu nhất. */
function skillRank(level: string): number {
  const index = 'ABCD'.indexOf(level);
  return index >= 0 ? index : 100;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildGroupMatches(tournament: Tournament, teams: string[]): MatchCreate[] {
  const stage = tournament.format === 'GROUP_KNOCKOUT' ? 'Vòng bảng' : 'Vòng tròn';
  const groups = tournament.format === 'GROUP_KNOCKOUT' ? splitGroups(teams, groupCountFor(tournament, teams.length)) : [teams];
  const matches: MatchCreate[] = [];
  const groupRounds = groups.map((groupTeams, groupIndex) => {
    const groupName = String.fromCharCode('A'.charCodeAt(0) + groupIndex);
    return roundRobinRounds(groupTeams).map((roundMatches) =>
      roundMatches.map(([teamA, teamB]) => ({ tournamentId: tournament.id, teamA, teamB, stage, groupName })),
    );
  });
  const maxRound = groupRounds.reduce((max, rounds) => Math.max(max, rounds.length), 0);
  for (let roundIndex = 0; roundIndex < maxRound; roundIndex++) {
    let court = 1;
    for (const rounds of groupRounds) {
      const roundMatches = rounds[roundIndex] || [];
      for (const match of roundMatches) {
        matches.push({ ...match, courtNumber: court, roundNumber: roundIndex + 1 });
        court = court >= tournament.courtCount ? 1 : court + 1;
      }
    }
  }
  return matches;
}

function roundRobinRounds(teams: string[]): [string, string][][] {
  const rotated = teams.filter(Boolean);
  if (rotated.length < 2) return [];
  if (rotated.length % 2 === 1) rotated.push('');
  const rounds: [string, string][][] = [];
  const count = rotated.length;
  for (let round = 0; round < count - 1; round++) {
    const matches: [string, string][] = [];
    for (let index = 0; index < count / 2; index++) {
      const teamA = rotated[index];
      const teamB = rotated[count - 1 - index];
      if (teamA && teamB) matches.push(round % 2 === 0 ? [teamA, teamB] : [teamB, teamA]);
    }
    rounds.push(matches);
    rotated.splice(1, 0, rotated.pop() || '');
  }
  return rounds;
}

function buildKnockout(tournament: Tournament): MatchCreate[] {
  const matches: MatchCreate[] = [];
  let previous = '';
  if (tournament.knockoutQualifierCount >= 8) {
    matches.push(...stageMatches(tournament, 'Tứ kết', 100, ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A', 'Nhất C', 'Nhì D', 'Nhất D', 'Nhì C']));
    previous = 'Tứ kết';
  }
  if (tournament.knockoutQualifierCount >= 4) {
    matches.push(...stageMatches(tournament, 'Bán kết', 101, previous ? winners(previous, 4) : ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A']));
    previous = 'Bán kết';
  }
  matches.push(...stageMatches(tournament, 'Chung kết', 102, previous ? winners(previous, 2) : ['Nhất A', 'Nhất B']));
  return matches;
}

function stageMatches(tournament: Tournament, stage: string, round: number, teams: string[]): MatchCreate[] {
  const matches: MatchCreate[] = [];
  let court = 1;
  for (let i = 0; i < teams.length; i += 2) {
    matches.push({ tournamentId: tournament.id, teamA: teams[i], teamB: teams[i + 1] || 'Chờ đối thủ', courtNumber: court, roundNumber: round, stage, groupName: null });
    court = court >= tournament.courtCount ? 1 : court + 1;
  }
  return matches;
}

function groupCountFor(tournament: Tournament, teamCount: number) {
  if (tournament.format !== 'GROUP_KNOCKOUT') return 1;
  return Math.min(Math.max(1, Math.ceil(tournament.knockoutQualifierCount / 2)), Math.max(1, Math.floor(teamCount / 2)));
}

function splitGroups(teams: string[], groupCount: number) {
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  teams.forEach((team, index) => groups[index % groupCount].push(team));
  return groups;
}

function winners(stage: string, count: number) {
  return Array.from({ length: count }, (_, index) => `Thắng ${stage} ${index + 1}`);
}
