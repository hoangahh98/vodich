import { Injectable } from '@nestjs/common';
import { MatchGame, Tournament, TournamentRegistration } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { parseMoney, roundUpToStep } from '../common/money';

export interface RankingRow {
  teamName: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

export interface RankingGroup {
  groupName: string;
  rows: RankingRow[];
}

@Injectable()
export class TournamentService {
  constructor(private readonly prisma: PrismaService) {}

  async listFor(user: CurrentUser) {
    const tournaments =
      user.role === 'ADMIN'
        ? await this.prisma.tournament.findMany({ orderBy: { id: 'desc' } })
        : await this.clientTournaments(user.email);
    return Promise.all(
      tournaments.map(async (tournament) => ({
        tournament,
        activeCount: await this.prisma.tournamentRegistration.count({
          where: { tournamentId: tournament.id, status: 'ACTIVE' },
        }),
        minimumFee: this.minimumFee(tournament),
      })),
    );
  }

  async clientTournaments(email: string): Promise<Tournament[]> {
    const rows = await this.prisma.tournamentRegistration.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { externalEmail: { equals: email, mode: 'insensitive' } },
          { player: { email: { equals: email, mode: 'insensitive' } } },
        ],
      },
      include: { tournament: true },
      orderBy: { id: 'desc' },
    });
    const unique = new Map<string, Tournament>();
    rows.forEach((row) => unique.set(row.tournament.id.toString(), row.tournament));
    return [...unique.values()];
  }

  async canView(user: CurrentUser, tournamentId: bigint) {
    if (user.role === 'ADMIN') return true;
    return (
      (await this.prisma.tournamentRegistration.count({
        where: {
          tournamentId,
          status: 'ACTIVE',
          OR: [
            { externalEmail: { equals: user.email, mode: 'insensitive' } },
            { player: { email: { equals: user.email, mode: 'insensitive' } } },
          ],
        },
      })) > 0
    );
  }

  minimumFee(tournament: Tournament): number {
    const total =
      Number(tournament.courtCost) + Number(tournament.foodCost) + Number(tournament.prizeCost) + Number(tournament.otherCost);
    return roundUpToStep(total / Math.max(1, tournament.expectedPlayers));
  }

  async create(form: Record<string, unknown>) {
    return this.prisma.tournament.create({
      data: {
        name: String(form.name || '').trim(),
        venue: String(form.venue || '').trim(),
        startTime: form.startTime ? new Date(String(form.startTime)) : null,
        courtCount: Math.max(1, Number(form.courtCount || 1)),
        expectedPlayers: Math.max(1, Number(form.expectedPlayers || 1)),
        playType: String(form.playType || 'SINGLES'),
        format: String(form.format || 'ROUND_ROBIN'),
        knockoutQualifierCount: normalizeQualifierCount(Number(form.knockoutQualifierCount || 4)),
        touchScore: Math.max(1, Number(form.touchScore || 11)),
        maxScore: Math.max(1, Number(form.maxScore || 15)),
        courtCost: parseMoney(form.courtCost),
        foodCost: parseMoney(form.foodCost),
        prizeCost: parseMoney(form.prizeCost),
        otherCost: parseMoney(form.otherCost),
        externalRegistrationEnabled: form.externalRegistrationEnabled === 'on',
      },
    });
  }

  async registerPlayer(tournamentId: bigint, playerId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const player = await this.prisma.player.findUniqueOrThrow({ where: { id: playerId } });
    await this.prisma.tournamentRegistration.upsert({
      where: { tournamentId_playerId: { tournamentId, playerId } },
      update: { status: 'ACTIVE', withdrawnAt: null },
      create: {
        tournamentId,
        playerId,
        skillLevel: player.skillLevel,
        source: 'INTERNAL',
        paidAmount: this.minimumFee(tournament),
        paymentStatus: 'UNPAID',
      },
    });
  }

  async registerExternal(tournamentId: bigint, displayName: string, email: string, skillLevel?: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (!tournament.externalRegistrationEnabled) throw new Error('Giải chưa mở đăng ký ngoài');
    return this.prisma.tournamentRegistration.upsert({
      where: { tournamentId_externalEmail: { tournamentId, externalEmail: email.trim().toLowerCase() } },
      update: { status: 'ACTIVE', withdrawnAt: null, externalName: displayName.trim(), skillLevel: blankToNull(skillLevel) },
      create: {
        tournamentId,
        externalName: displayName.trim(),
        externalEmail: email.trim().toLowerCase(),
        skillLevel: blankToNull(skillLevel),
        source: 'EXTERNAL',
        paidAmount: this.minimumFee(tournament),
        paymentStatus: 'UNPAID',
      },
    });
  }

  async updatePayment(registrationId: bigint, amount: string, status: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { paidAmount: parseMoney(amount), paymentStatus: status },
    });
  }

  async withdraw(registrationId: bigint) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
    });
  }

  async restore(registrationId: bigint) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: 'ACTIVE', withdrawnAt: null },
    });
  }

  async generateSchedule(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'ACTIVE' },
      include: { player: true },
      orderBy: { id: 'asc' },
    });
    const names = registrations.map(displayRegistrationName);
    const teams = tournament.playType === 'DOUBLES' ? doublesTeams(names) : names;
    const groupMatches = buildGroupMatches(tournament, teams);
    const knockout = tournament.format === 'GROUP_KNOCKOUT' ? buildKnockout(tournament, lastRound(groupMatches) + 1) : [];
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: [...groupMatches, ...knockout] }),
    ]);
  }

  async rankings(tournamentId: bigint): Promise<RankingGroup[]> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: { in: ['Vòng bảng', 'Vòng tròn'] } },
      orderBy: [{ groupName: 'asc' }, { roundNumber: 'asc' }, { courtNumber: 'asc' }],
    });
    const groups = new Map<string, Map<string, RankingAccumulator>>();
    for (const match of matches) {
      const groupName = match.groupName || 'A';
      const rows = groups.get(groupName) ?? new Map<string, RankingAccumulator>();
      groups.set(groupName, rows);
      applyRanking(rows, match.teamA, match.scoreA, match.scoreB, match.status === 'FINISHED');
      applyRanking(rows, match.teamB, match.scoreB, match.scoreA, match.status === 'FINISHED');
    }
    return [...groups.entries()].map(([groupName, rows]) => ({
      groupName,
      rows: [...rows.values()]
        .map((row) => row.toRow())
        .sort((a, b) => b.won - a.won || b.pointDiff - a.pointDiff || b.pointsFor - a.pointsFor || a.teamName.localeCompare(b.teamName)),
    }));
  }
}

type MatchCreate = {
  tournamentId: bigint;
  teamA: string;
  teamB: string;
  courtNumber: number;
  roundNumber: number;
  stage: string;
  groupName?: string | null;
};

function displayRegistrationName(reg: TournamentRegistration & { player: { displayName: string } | null }) {
  return reg.player?.displayName || reg.externalName || reg.externalEmail || 'Chưa đặt tên';
}

function doublesTeams(names: string[]) {
  const teams: string[] = [];
  for (let i = 0; i < names.length; i += 2) {
    teams.push(`${names[i]} / ${names[i + 1] || 'Chờ thành viên'}`);
  }
  return teams;
}

function buildGroupMatches(tournament: Tournament, teams: string[]): MatchCreate[] {
  const stage = tournament.format === 'GROUP_KNOCKOUT' ? 'Vòng bảng' : 'Vòng tròn';
  const groups = tournament.format === 'GROUP_KNOCKOUT' ? splitGroups(teams, groupCountFor(tournament, teams.length)) : [teams];
  const matches: MatchCreate[] = [];
  let court = 1;
  let round = 1;
  groups.forEach((groupTeams, groupIndex) => {
    const groupName = String.fromCharCode('A'.charCodeAt(0) + groupIndex);
    for (let i = 0; i < groupTeams.length; i++) {
      for (let j = i + 1; j < groupTeams.length; j++) {
        matches.push({ tournamentId: tournament.id, teamA: groupTeams[i], teamB: groupTeams[j], courtNumber: court, roundNumber: round, stage, groupName });
        court = court >= tournament.courtCount ? 1 : court + 1;
        if (court === 1) round++;
      }
    }
  });
  return matches;
}

function buildKnockout(tournament: Tournament, startRound: number): MatchCreate[] {
  const matches: MatchCreate[] = [];
  let round = startRound;
  let previous = '';
  if (tournament.knockoutQualifierCount >= 8) {
    matches.push(...stageMatches(tournament, 'Tứ kết', round, ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A', 'Nhất C', 'Nhì D', 'Nhất D', 'Nhì C']));
    previous = 'Tứ kết';
    round++;
  }
  if (tournament.knockoutQualifierCount >= 4) {
    matches.push(...stageMatches(tournament, 'Bán kết', round, previous ? winners(previous, 4) : ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A']));
    previous = 'Bán kết';
    round++;
  }
  matches.push(...stageMatches(tournament, 'Chung kết', round, previous ? winners(previous, 2) : ['Nhất A', 'Nhất B']));
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
  return Math.min(Math.max(1, tournament.knockoutQualifierCount / 2), Math.max(1, Math.floor(teamCount / 2)));
}

function splitGroups(teams: string[], groupCount: number) {
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  teams.forEach((team, index) => groups[index % groupCount].push(team));
  return groups;
}

function winners(stage: string, count: number) {
  return Array.from({ length: count }, (_, index) => `Thắng ${stage} ${index + 1}`);
}

function lastRound(matches: MatchCreate[]) {
  return matches.reduce((max, match) => Math.max(max, match.roundNumber), 0);
}

function normalizeQualifierCount(value: number) {
  if (value >= 8) return 8;
  if (value >= 4) return 4;
  return 2;
}

function blankToNull(value?: string) {
  return value && value.trim() ? value.trim() : null;
}

class RankingAccumulator {
  played = 0;
  won = 0;
  lost = 0;
  pointsFor = 0;
  pointsAgainst = 0;

  constructor(private readonly teamName: string) {}

  apply(pointsFor: number, pointsAgainst: number, finished: boolean) {
    this.pointsFor += pointsFor;
    this.pointsAgainst += pointsAgainst;
    if (!finished) return;
    this.played++;
    if (pointsFor > pointsAgainst) this.won++;
    if (pointsFor < pointsAgainst) this.lost++;
  }

  toRow(): RankingRow {
    return {
      teamName: this.teamName,
      played: this.played,
      won: this.won,
      lost: this.lost,
      pointsFor: this.pointsFor,
      pointsAgainst: this.pointsAgainst,
      pointDiff: this.pointsFor - this.pointsAgainst,
    };
  }
}

function applyRanking(rows: Map<string, RankingAccumulator>, name: string, pointsFor: number, pointsAgainst: number, finished: boolean) {
  const row = rows.get(name) ?? new RankingAccumulator(name);
  row.apply(pointsFor, pointsAgainst, finished);
  rows.set(name, row);
}
