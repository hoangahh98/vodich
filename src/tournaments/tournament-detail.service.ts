import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { rootAdminUsername } from '../common/admin-scope';
import { GroupBoard, RankingGroup, TournamentRankingCalculator } from './tournament-ranking';

@Injectable()
export class TournamentDetailService {
  private readonly rankingCalculator = new TournamentRankingCalculator();

  constructor(private readonly prisma: PrismaService) {}

  async detail(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { ownerAdmin: true, permissions: { include: { admin: true }, orderBy: { id: 'asc' } } },
    });
    const [registrations, reserveRegistrations, withdrawnRegistrations, players, matches, rankingGroups, groupBoards, admins] = await Promise.all([
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'ACTIVE' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'RESERVE' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { tournamentId, status: 'WITHDRAWN' },
        include: { player: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.matchGame.findMany({ where: { tournamentId }, orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }] }),
      this.rankings(tournamentId),
      this.groupBoards(tournamentId),
      this.availableAdmins(tournamentId, tournament.ownerAdminId),
    ]);
    return { tournament, registrations, reserveRegistrations, withdrawnRegistrations, players, matches, rankingGroups, groupBoards, admins };
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

  private availableAdmins(tournamentId: bigint, ownerAdminId?: bigint | null) {
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
}
