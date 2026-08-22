import { Injectable } from '@nestjs/common';
import { normalizePairingRule } from '../common/enums';
import { PrismaService } from '../prisma.service';
import { TournamentScheduleBuilder, completeManualTeams } from './tournament-schedule';

@Injectable()
export class TournamentScheduleService {
  private readonly scheduleBuilder = new TournamentScheduleBuilder();

  constructor(private readonly prisma: PrismaService) {}

  async generateSchedule(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const registrations = await this.activeRegistrations(tournamentId);
    const matches = this.scheduleBuilder.fromRegistrations(tournament, registrations);
    await this.replaceMatches(tournamentId, matches);
  }

  /**
   * Ghép đội thủ công. Chỉ những đội chọn đủ hai người mới là đội cố định; ai chưa được xếp
   * vào đội nào thì máy ghép nốt theo `pairingRule` của giải (xem `completeManualTeams`).
   *
   * Giải đơn không có chuyện "ghép cặp", nên giữ nguyên danh sách gửi lên.
   */
  async generateManualSchedule(tournamentId: bigint, pairNames: string[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const teams =
      tournament.playType === 'DOUBLES'
        ? completeManualTeams(pairNames, await this.activeRegistrations(tournamentId), normalizePairingRule(tournament.pairingRule))
        : pairNames;
    const matches = this.scheduleBuilder.fromManualPairs(tournament, teams);
    await this.replaceMatches(tournamentId, matches);
  }

  private activeRegistrations(tournamentId: bigint) {
    return this.prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'ACTIVE' },
      include: { player: true },
      orderBy: { id: 'asc' },
    });
  }

  private async replaceMatches(tournamentId: bigint, matches: ReturnType<TournamentScheduleBuilder['fromRegistrations']>) {
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: matches }),
    ]);
  }
}
