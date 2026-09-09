import { Injectable } from '@nestjs/common';
import { normalizePairingRule } from '../common/enums';
import { PrismaService } from '../prisma.service';
import { ManualTeam, TournamentScheduleBuilder, completeManualSingles, completeManualTeams } from './tournament-schedule';

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
   * Chọn đội thủ công (ghép tay hoặc kết quả vòng quay). Chỉ những đội chọn đủ người mới là đội
   * cố định; ai chưa được xếp vào đội nào thì máy xếp nốt: đôi ghép theo `pairingRule` của giải
   * (`completeManualTeams`), đơn thì xếp tiếp phía sau (`completeManualSingles`). Bảng đã chọn
   * cho đội nào đi theo đội ấy (đối chiếu theo tên, vì phần tự ghép sinh ra tên mới).
   */
  async generateManualSchedule(tournamentId: bigint, manualTeams: ManualTeam[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const registrations = await this.activeRegistrations(tournamentId);
    const names = manualTeams.map((team) => team.name);
    const completed =
      tournament.playType === 'DOUBLES'
        ? completeManualTeams(names, registrations, normalizePairingRule(tournament.pairingRule))
        : completeManualSingles(names, registrations);
    const groupOf = new Map(manualTeams.map((team) => [team.name, team.group || null]));
    const teams: ManualTeam[] = completed.map((name) => ({ name, group: groupOf.get(name) || null }));
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
