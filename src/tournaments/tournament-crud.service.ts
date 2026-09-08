import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere, isRootAdmin, ownedOrSharedWhere } from '../common/admin-scope';
import { clientTournamentWhere } from '../common/player-scope';
import { buildTournamentData, normalizePrizes, operatingCostFromForm } from './tournament-form';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async listFor(user: CurrentUser) {
    const tournaments =
      user.role === 'ADMIN'
        ? await this.prisma.tournament.findMany({
            where: isRootAdmin(user) ? {} : ownedOrSharedWhere(user),
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

  /** Giải mà vận động viên này được XEM: theo bảng quyền xem, xem src/common/player-scope.ts. */
  clientTournaments(email: string): Promise<Tournament[]> {
    return this.prisma.tournament.findMany({ where: clientTournamentWhere({ email }), orderBy: { id: 'desc' } });
  }

  async canView(user: CurrentUser, tournamentId: bigint) {
    if (user.role === 'ADMIN') return this.canManage(user, tournamentId);
    return (await this.prisma.tournament.count({ where: { id: tournamentId, ...clientTournamentWhere(user) } })) > 0;
  }

  async canManage(user: CurrentUser, tournamentId: bigint) {
    if (user.role !== 'ADMIN') return false;
    if (isRootAdmin(user)) return true;
    return (
      (await this.prisma.tournament.count({
        where: { id: tournamentId, ...ownedOrSharedWhere(user) },
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
      data: { ...buildTournamentData(form, normalizePrizes(form)), ownerAdminId: BigInt(user.id) },
    });
  }

  async update(id: bigint, form: Record<string, unknown>) {
    return this.prisma.tournament.update({
      where: { id },
      data: {
        ...buildTournamentData(form, normalizePrizes(form)),
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
      where: availableAdminsWhere(ownerAdminId, { tournamentPermissions: { none: { tournamentId } } }),
      orderBy: AVAILABLE_ADMINS_ORDER,
    });
  }

  addPermission(tournamentId: bigint, adminId: bigint) {
    return this.prisma.tournamentPermission.create({ data: { tournamentId, adminId } });
  }

  removePermission(tournamentId: bigint, permissionId: bigint) {
    // deleteMany cho phép ràng buộc theo tournamentId; xoá 0 dòng nếu permission thuộc giải khác.
    return this.prisma.tournamentPermission.deleteMany({ where: { id: permissionId, tournamentId } });
  }
}
