import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere } from '../common/admin-scope';
import { GroupBoard, PlayerRankingRow, RankingGroup, TournamentRankingCalculator } from './tournament-ranking';
import { RANKED_STAGES } from './tournament-schedule';

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
    // Xếp hạng cá nhân tính lại từ `matches` đã lấy ở trên, không tốn thêm truy vấn nào.
    // Chỉ thể thức xoay vòng mới cần: các thể thức khác đội cố định nên bảng theo đội mới đúng.
    const playerRankings: PlayerRankingRow[] =
      tournament.format === 'AMERICANO'
        ? this.rankingCalculator.playerRankings(matches.filter((match) => RANKED_STAGES.includes(match.stage)))
        : [];
    return { tournament, registrations, reserveRegistrations, withdrawnRegistrations, players, matches, rankingGroups, playerRankings, groupBoards, admins };
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
      where: { tournamentId, stage: { in: RANKED_STAGES } },
      orderBy: [{ groupName: 'asc' }, { roundNumber: 'asc' }, { courtNumber: 'asc' }],
    });
    return this.rankingCalculator.rankings(matches);
  }

  private availableAdmins(tournamentId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: availableAdminsWhere(ownerAdminId, { tournamentPermissions: { none: { tournamentId } } }),
      orderBy: AVAILABLE_ADMINS_ORDER,
    });
  }
}
