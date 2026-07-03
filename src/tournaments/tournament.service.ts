import { Injectable } from '@nestjs/common';
import { MatchGame, Tournament } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { parseMoney, roundUpToStep } from '../common/money';
import { GroupBoard, RankingGroup, TournamentRankingCalculator } from './tournament-ranking';
import { TournamentScheduleBuilder, finishedStageWinners, knockoutSeeds } from './tournament-schedule';

@Injectable()
export class TournamentService {
  private readonly rankingCalculator = new TournamentRankingCalculator();
  private readonly scheduleBuilder = new TournamentScheduleBuilder();

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
        knockoutTouchScore: Math.max(1, Number(form.knockoutTouchScore || 15)),
        knockoutMaxScore: Math.max(1, Number(form.knockoutMaxScore || 19)),
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
        knockoutTouchScore: Math.max(1, Number(form.knockoutTouchScore || 15)),
        knockoutMaxScore: Math.max(1, Number(form.knockoutMaxScore || 19)),
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
    const matches = this.scheduleBuilder.fromRegistrations(tournament, registrations);
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: matches }),
    ]);
  }

  async generateManualSchedule(tournamentId: bigint, pairNames: string[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const matches = this.scheduleBuilder.fromManualPairs(tournament, pairNames);
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: matches }),
    ]);
  }

  async groupBoards(tournamentId: bigint): Promise<GroupBoard[]> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: 'Vòng bảng', groupName: { not: null } },
      orderBy: [{ groupName: 'asc' }, { id: 'asc' }],
    });
    return this.rankingCalculator.groupBoards(matches);
  }

  async rankings(tournamentId: bigint): Promise<RankingGroup[]> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: { in: ['Vòng bảng', 'Vòng tròn'] } },
      orderBy: [{ groupName: 'asc' }, { roundNumber: 'asc' }, { courtNumber: 'asc' }],
    });
    return this.rankingCalculator.rankings(matches);
  }

  async syncKnockout(tournamentId: bigint): Promise<boolean> {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (tournament.format !== 'GROUP_KNOCKOUT') return false;

    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId },
      orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }],
    });
    const groupMatches = matches.filter((match) => match.stage === 'Vòng bảng');
    if (!groupMatches.length || groupMatches.some((match) => match.status !== 'FINISHED')) return false;

    let changed = false;
    const rankings = await this.rankings(tournamentId);
    const firstStage = tournament.knockoutQualifierCount >= 8 ? 'Tứ kết' : tournament.knockoutQualifierCount >= 4 ? 'Bán kết' : 'Chung kết';
    const seedTeams = knockoutSeeds(tournament.knockoutQualifierCount, rankings);
    changed = (await this.updateStageTeams(tournamentId, firstStage, seedTeams)) || changed;

    if (tournament.knockoutQualifierCount >= 8) {
      const quarterWinners = finishedStageWinners(matches, 'Tứ kết');
      if (quarterWinners) changed = (await this.updateStageTeams(tournamentId, 'Bán kết', quarterWinners)) || changed;
    }

    if (tournament.knockoutQualifierCount >= 4) {
      const semiWinners = finishedStageWinners(await this.matchesForTournament(tournamentId), 'Bán kết');
      if (semiWinners) changed = (await this.updateStageTeams(tournamentId, 'Chung kết', semiWinners)) || changed;
    }

    return changed;
  }

  private async matchesForTournament(tournamentId: bigint) {
    return this.prisma.matchGame.findMany({
      where: { tournamentId },
      orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }],
    });
  }

  private async updateStageTeams(tournamentId: bigint, stage: string, teams: string[]): Promise<boolean> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage },
      orderBy: [{ courtNumber: 'asc' }, { id: 'asc' }],
    });
    if (!matches.length || teams.length < matches.length * 2) return false;
    const updates: ReturnType<typeof this.prisma.matchGame.update>[] = [];
    for (const [index, match] of matches.entries()) {
      const teamA = teams[index * 2];
      const teamB = teams[index * 2 + 1];
      if (!teamA || !teamB || (match.teamA === teamA && match.teamB === teamB) || match.status === 'FINISHED') continue;
      updates.push(
        this.prisma.matchGame.update({
          where: { id: match.id },
          data: { teamA, teamB, scoreA: 0, scoreB: 0, status: 'SCHEDULED', servingTeam: 'A', scoreOrder: 2, updatedAt: new Date() },
        }),
      );
    }
    if (!updates.length) return false;
    await this.prisma.$transaction(updates);
    return true;
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
  const values = [prizeValue(form.prizeRate1, 50), prizeValue(form.prizeRate2, 30), prizeValue(form.prizeRate3, 20)];
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
