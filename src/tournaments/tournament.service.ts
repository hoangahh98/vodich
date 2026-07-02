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
        status: { in: ['ACTIVE', 'RESERVE'] },
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
          status: { in: ['ACTIVE', 'RESERVE'] },
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
    const prizes = normalizePrizes(form, 0);
    return this.prisma.tournament.create({
      data: {
        name: String(form.name || '').trim(),
        venue: String(form.venue || '').trim(),
        startTime: form.startTime ? new Date(String(form.startTime)) : null,
        endTime: form.endTime ? new Date(String(form.endTime)) : null,
        courtCount: Math.max(1, Number(form.courtCount || 1)),
        expectedPlayers: Math.max(1, Number(form.expectedPlayers || 1)),
        playType: String(form.playType || 'SINGLES'),
        format: String(form.format || 'ROUND_ROBIN'),
        knockoutQualifierCount: normalizeQualifierCount(Number(form.knockoutQualifierCount || 4), Math.max(1, Number(form.expectedPlayers || 1)), String(form.playType || 'SINGLES')),
        touchScore: Math.max(1, Number(form.touchScore || 11)),
        maxScore: Math.max(1, Number(form.maxScore || 15)),
        courtCost: parseMoney(form.courtCost),
        foodCost: parseMoney(form.foodCost),
        prizeCost: parseMoney(form.prizeCost),
        otherCost: parseMoney(form.otherCost),
        prizeRate1: prizes[0],
        prizeRate2: prizes[1],
        prizeRate3: prizes[2],
        externalRegistrationEnabled: form.externalRegistrationEnabled === 'on',
      },
    });
  }

  async update(id: bigint, form: Record<string, unknown>) {
    const prizeFund = await this.prizeFundForForm(id, form);
    const prizes = normalizePrizes(form, prizeFund);
    return this.prisma.tournament.update({
      where: { id },
      data: {
        name: String(form.name || '').trim(),
        venue: String(form.venue || '').trim(),
        startTime: form.startTime ? new Date(String(form.startTime)) : null,
        endTime: form.endTime ? new Date(String(form.endTime)) : null,
        courtCount: Math.max(1, Number(form.courtCount || 1)),
        expectedPlayers: Math.max(1, Number(form.expectedPlayers || 1)),
        playType: String(form.playType || 'SINGLES'),
        format: String(form.format || 'ROUND_ROBIN'),
        knockoutQualifierCount: normalizeQualifierCount(Number(form.knockoutQualifierCount || 2), Math.max(1, Number(form.expectedPlayers || 1)), String(form.playType || 'SINGLES')),
        touchScore: Math.max(1, Number(form.touchScore || 11)),
        maxScore: Math.max(1, Number(form.maxScore || 15)),
        courtCost: parseMoney(form.courtCost),
        foodCost: parseMoney(form.foodCost),
        prizeCost: parseMoney(form.prizeCost),
        otherCost: parseMoney(form.otherCost),
        prizeRate1: prizes[0],
        prizeRate2: prizes[1],
        prizeRate3: prizes[2],
        externalRegistrationEnabled: form.externalRegistrationEnabled === 'on',
        updatedAt: new Date(),
      },
    });
  }

  async registerPlayer(tournamentId: bigint, playerId: bigint) {
    return this.registerPlayers(tournamentId, [playerId]);
  }

  async registerPlayers(tournamentId: bigint, playerIds: bigint[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const uniqueIds = [...new Set(playerIds.map((id) => id.toString()))].map((id) => BigInt(id));
    const players = await this.prisma.player.findMany({ where: { id: { in: uniqueIds } }, orderBy: { displayName: 'asc' } });
    const activeCount = await this.prisma.tournamentRegistration.count({ where: { tournamentId, status: 'ACTIVE' } });
    let slotsLeft = Math.max(0, tournament.expectedPlayers - activeCount);
    let reserveCount = 0;
    for (const player of players) {
      const status = slotsLeft > 0 ? 'ACTIVE' : 'RESERVE';
      if (status === 'ACTIVE') slotsLeft--;
      if (status === 'RESERVE') reserveCount++;
      await this.prisma.tournamentRegistration.upsert({
        where: { tournamentId_playerId: { tournamentId, playerId: player.id } },
        update: { status, withdrawnAt: null, paidAmount: this.minimumFee(tournament) },
        create: {
          tournamentId,
          playerId: player.id,
          skillLevel: player.skillLevel,
          source: 'INTERNAL',
          status,
          paidAmount: this.minimumFee(tournament),
          paymentStatus: 'UNPAID',
        },
      });
    }
    return { added: players.length, reserveCount };
  }

  async registerExternal(tournamentId: bigint, displayName: string, email: string, skillLevel?: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (!tournament.externalRegistrationEnabled) throw new Error('Giải chưa mở đăng ký ngoài');
    const normalizedEmail = email.trim().toLowerCase();
    const existingPlayer = await this.prisma.player.findUnique({ where: { email: normalizedEmail } });
    const activeCount = await this.prisma.tournamentRegistration.count({ where: { tournamentId, status: 'ACTIVE' } });
    const status = activeCount < tournament.expectedPlayers ? 'ACTIVE' : 'RESERVE';
    if (existingPlayer) {
      return this.prisma.tournamentRegistration.upsert({
        where: { tournamentId_playerId: { tournamentId, playerId: existingPlayer.id } },
        update: { status, withdrawnAt: null, skillLevel: blankToNull(skillLevel) || existingPlayer.skillLevel },
        create: {
          tournamentId,
          playerId: existingPlayer.id,
          skillLevel: blankToNull(skillLevel) || existingPlayer.skillLevel,
          source: 'INTERNAL',
          status,
          paidAmount: this.minimumFee(tournament),
          paymentStatus: 'UNPAID',
        },
        include: { player: true },
      });
    }
    return this.prisma.tournamentRegistration.upsert({
      where: { tournamentId_externalEmail: { tournamentId, externalEmail: normalizedEmail } },
      update: { status, withdrawnAt: null, externalName: displayName.trim(), skillLevel: blankToNull(skillLevel) },
      create: {
        tournamentId,
        externalName: displayName.trim(),
        externalEmail: normalizedEmail,
        skillLevel: blankToNull(skillLevel),
        source: 'EXTERNAL',
        status,
        paidAmount: this.minimumFee(tournament),
        paymentStatus: 'UNPAID',
      },
      include: { player: true },
    });
  }

  async updatePayment(registrationId: bigint, amount: string, status: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { paidAmount: parseMoney(amount), paymentStatus: status },
    });
  }

  async updatePayments(body: Record<string, string>) {
    const ids = Object.keys(body)
      .filter((key) => key.startsWith('amount_'))
      .map((key) => BigInt(key.replace('amount_', '')));
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { id: { in: ids } },
      include: { tournament: true },
    });
    const registrationMap = new Map(registrations.map((registration) => [registration.id.toString(), registration]));
    const updates = Object.entries(body)
      .filter(([key]) => key.startsWith('amount_'))
      .map(([key, amount]) => {
        const id = BigInt(key.replace('amount_', ''));
        const parsedAmount = parseMoney(amount);
        const registration = registrationMap.get(id.toString());
        return this.prisma.tournamentRegistration.update({
          where: { id },
          data: {
            paidAmount: parsedAmount || (registration ? this.minimumFee(registration.tournament) : 0),
            paymentStatus: body[`status_${id}`] || 'UNPAID',
          },
        });
      });
    if (!updates.length) return [];
    return this.prisma.$transaction(updates);
  }

  async withdraw(registrationId: bigint) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
    });
  }

  async restore(registrationId: bigint) {
    const registration = await this.prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { tournament: true },
    });
    const activeCount = await this.prisma.tournamentRegistration.count({
      where: { tournamentId: registration.tournamentId, status: 'ACTIVE' },
    });
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: {
        status: activeCount < registration.tournament.expectedPlayers ? 'ACTIVE' : 'RESERVE',
        withdrawnAt: null,
        paidAmount: Number(registration.paidAmount || 0) > 0 ? registration.paidAmount : this.minimumFee(registration.tournament),
      },
    });
  }

  async deleteRegistration(registrationId: bigint) {
    await this.prisma.tournamentRegistration.delete({ where: { id: registrationId } });
  }

  async updateRegistrationSkill(registrationId: bigint, skillLevel: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { skillLevel: blankToNull(skillLevel) },
    });
  }

  async bulkRegistrations(registrationIds: bigint[], action: string) {
    const ids = [...new Set(registrationIds.map((id) => id.toString()))].map((id) => BigInt(id));
    if (!ids.length) return;
    if (action === 'delete') {
      await this.prisma.tournamentRegistration.deleteMany({ where: { id: { in: ids } } });
      return;
    }
    if (action === 'withdraw') {
      await this.prisma.tournamentRegistration.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      return;
    }
    if (action === 'restore') {
      for (const id of ids) {
        await this.restore(id);
      }
    }
  }

  async generateSchedule(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'ACTIVE' },
      include: { player: true },
      orderBy: { id: 'asc' },
    });
    const names = shuffle(registrations.map(displayRegistrationName));
    const teams = tournament.playType === 'DOUBLES' ? shuffle(doublesTeams(names)) : names;
    const groupMatches = buildGroupMatches(tournament, teams);
    const knockout = tournament.format === 'GROUP_KNOCKOUT' ? buildKnockout(tournament, lastRound(groupMatches) + 1) : [];
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: [...groupMatches, ...knockout] }),
    ]);
  }

  async generateManualSchedule(tournamentId: bigint, pairNames: string[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const teams = pairNames.filter((name) => name.trim());
    const groupMatches = buildGroupMatches(tournament, teams);
    const knockout = tournament.format === 'GROUP_KNOCKOUT' ? buildKnockout(tournament, lastRound(groupMatches) + 1) : [];
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: [...groupMatches, ...knockout] }),
    ]);
  }

  async groupBoards(tournamentId: bigint): Promise<GroupBoard[]> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: 'Vòng bảng', groupName: { not: null } },
      orderBy: [{ groupName: 'asc' }, { id: 'asc' }],
    });
    const groups = new Map<string, Set<string>>();
    for (const match of matches) {
      const groupName = match.groupName || 'A';
      const teams = groups.get(groupName) ?? new Set<string>();
      teams.add(match.teamA);
      teams.add(match.teamB);
      groups.set(groupName, teams);
    }
    return [...groups.entries()].map(([groupName, teams]) => ({ groupName, teams: [...teams] }));
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

  async prizeTotalPaid(tournamentId: bigint): Promise<number> {
    const result = await this.prisma.tournamentRegistration.aggregate({
      where: { tournamentId, status: 'ACTIVE' },
      _sum: { paidAmount: true },
    });
    return Number(result._sum.paidAmount || 0);
  }

  async prizeFundForForm(tournamentId: bigint, form: Record<string, unknown>): Promise<number> {
    const totalPaid = await this.prizeTotalPaid(tournamentId);
    return prizeFundFromForm(totalPaid, form);
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

function buildKnockout(tournament: Tournament, _startRound: number): MatchCreate[] {
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

function lastRound(matches: MatchCreate[]) {
  return matches.reduce((max, match) => Math.max(max, match.roundNumber), 0);
}

function normalizeQualifierCount(value: number, expectedPlayers = 16, playType = 'SINGLES') {
  const estimatedTeams = playType === 'DOUBLES' ? Math.floor(expectedPlayers / 2) : expectedPlayers;
  if (value >= 8 && estimatedTeams >= 16) return 8;
  if (value >= 4 && estimatedTeams >= 8) return 4;
  return 2;
}

function prizeFundFromForm(totalPaid: number, form: Record<string, unknown>) {
  const operatingCost = parseMoney(form.courtCost) + parseMoney(form.foodCost) + parseMoney(form.otherCost);
  return Math.max(0, totalPaid - operatingCost);
}

function normalizePrizes(form: Record<string, unknown>, availablePrizeFund: number) {
  const values = [prizeValue(form.prizeRate1, 30), prizeValue(form.prizeRate2, 30), prizeValue(form.prizeRate3, 30)];
  if (String(form.prizeMode || 'percent') === 'manual') {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total > availablePrizeFund) {
      throw new Error(`Tổng tiền thưởng thủ công không được vượt quá quỹ thưởng hiện có (${availablePrizeFund.toLocaleString('en-US')}đ).`);
    }
    return values;
  }
  let remaining = 100;
  return values.map((value) => {
    const next = Math.min(Math.max(0, value), remaining);
    remaining -= next;
    return next;
  });
}

function prizeValue(value: unknown, fallback: number) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return parseMoney(value) || 0;
}

function blankToNull(value?: string) {
  return value && value.trim() ? value.trim() : null;
}

class RankingAccumulator {
  played = 0;
  won = 0;
  lost = 0;
  rankingPoints = 0;
  pointsFor = 0;
  pointsAgainst = 0;

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

function applyRanking(rows: Map<string, RankingAccumulator>, name: string, pointsFor: number, pointsAgainst: number, finished: boolean) {
  const row = rows.get(name) ?? new RankingAccumulator(name);
  row.apply(pointsFor, pointsAgainst, finished);
  rows.set(name, row);
}
