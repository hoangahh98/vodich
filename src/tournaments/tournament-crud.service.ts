import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { buildTournamentData, normalizePrizes, operatingCostFromForm } from './tournament-form';
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

  create(form: Record<string, unknown>) {
    return this.prisma.tournament.create({
      data: buildTournamentData(form, normalizePrizes(form, 0)),
    });
  }

  async update(id: bigint, form: Record<string, unknown>) {
    const prizeFund = await this.prizeFundForForm(id, form);
    return this.prisma.tournament.update({
      where: { id },
      data: {
        ...buildTournamentData(form, normalizePrizes(form, prizeFund)),
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
    return Math.max(0, totalPaid - operatingCostFromForm(form));
  }
}
