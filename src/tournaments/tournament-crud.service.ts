import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { isRootAdmin, rootAdminUsername } from '../common/admin-scope';
import { buildTournamentData, normalizePrizes, operatingCostFromForm } from './tournament-form';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async listFor(user: CurrentUser) {
    const tournaments =
      user.role === 'ADMIN'
        ? await this.prisma.tournament.findMany({
            where: isRootAdmin(user) ? {} : this.adminTournamentWhere(user),
            orderBy: { id: 'desc' },
          })
        : await this.clientTournaments(user.email);
    if (!tournaments.length) return [];

    const counts = await this.prisma.tournamentRegistration.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: tournaments.map((tournament) => tournament.id) }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const countByTournamentId = new Map(counts.map((item) => [item.tournamentId.toString(), item._count._all]));
    return tournaments.map((tournament) => ({
      tournament,
      activeCount: countByTournamentId.get(tournament.id.toString()) || 0,
      minimumFee: minimumFeeForTournament(tournament),
    }));
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
    if (user.role === 'ADMIN') return this.canManage(user, tournamentId);
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

  async canManage(user: CurrentUser, tournamentId: bigint) {
    if (user.role !== 'ADMIN') return false;
    if (isRootAdmin(user)) return true;
    return (
      (await this.prisma.tournament.count({
        where: { id: tournamentId, ...this.adminTournamentWhere(user) },
      })) > 0
    );
  }

  findTournament(tournamentId: bigint) {
    return this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  }

  delete(tournamentId: bigint) {
    return this.prisma.tournament.delete({ where: { id: tournamentId } });
  }

  create(form: Record<string, unknown>, user: CurrentUser) {
    return this.prisma.tournament.create({
      data: { ...buildTournamentData(form, normalizePrizes(form, 0)), ownerAdminId: BigInt(user.id) },
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

  async availableAdmins(tournamentId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: {
        role: 'ADMIN',
        username: { not: rootAdminUsername() },
        id: { notIn: [ownerAdminId || 0n] },
        tournamentPermissions: { none: { tournamentId } },
      },
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
    });
  }

  addPermission(tournamentId: bigint, adminId: bigint) {
    return this.prisma.tournamentPermission.create({ data: { tournamentId, adminId } });
  }

  removePermission(permissionId: bigint) {
    return this.prisma.tournamentPermission.delete({ where: { id: permissionId } });
  }

  private adminTournamentWhere(user: CurrentUser) {
    const adminId = BigInt(user.id);
    return { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] };
  }
}
