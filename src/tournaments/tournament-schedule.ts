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
    const names = shuffle(registrations.map(displayRegistrationName));
    const teams = tournament.playType === 'DOUBLES' ? shuffle(doublesTeams(names)) : names;
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

function doublesTeams(names: string[]) {
  const teams: string[] = [];
  for (let i = 0; i < names.length; i += 2) {
    teams.push(`${names[i]} / ${names[i + 1] || 'Chờ thành viên'}`);
  }
  return teams;
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
