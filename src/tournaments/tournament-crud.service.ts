import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentCrudService {
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
        minimumFee: minimumFeeForTournament(tournament),
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

  findTournament(tournamentId: bigint) {
    return this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  }

  delete(tournamentId: bigint) {
    return this.prisma.tournament.delete({ where: { id: tournamentId } });
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

  async prizeTotalPaid(tournamentId: bigint): Promise<number> {
    const result = await this.prisma.tournamentRegistration.aggregate({
      where: { tournamentId, status: 'ACTIVE' },
      _sum: { paidAmount: true },
    });
    return Number(result._sum.paidAmount || 0);
  }

  async prizeFundForForm(tournamentId: bigint, form: Record<string, unknown>): Promise<number> {
    const totalPaid = await this.prizeTotalPaid(tournamentId);
    const operatingCost = parseMoney(form.courtCost) + parseMoney(form.foodCost) + parseMoney(form.otherCost);
    return Math.max(0, totalPaid - operatingCost);
  }
}

function normalizeQualifierCount(value: number, expectedPlayers = 16, playType = 'SINGLES') {
  const estimatedTeams = playType === 'DOUBLES' ? Math.floor(expectedPlayers / 2) : expectedPlayers;
  if (value >= 8 && estimatedTeams >= 16) return 8;
  if (value >= 4 && estimatedTeams >= 8) return 4;
  return 2;
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
