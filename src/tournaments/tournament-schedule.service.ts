import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TournamentScheduleBuilder } from './tournament-schedule';

@Injectable()
export class TournamentScheduleService {
  private readonly scheduleBuilder = new TournamentScheduleBuilder();

  constructor(private readonly prisma: PrismaService) {}

  async generateSchedule(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'ACTIVE' },
      include: { player: true },
      orderBy: { id: 'asc' },
    });
    const matches = this.scheduleBuilder.fromRegistrations(tournament, registrations);
    await this.replaceMatches(tournamentId, matches);
  }

  async generateManualSchedule(tournamentId: bigint, pairNames: string[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const matches = this.scheduleBuilder.fromManualPairs(tournament, pairNames);
    await this.replaceMatches(tournamentId, matches);
  }

  private async replaceMatches(tournamentId: bigint, matches: ReturnType<TournamentScheduleBuilder['fromRegistrations']>) {
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { tournamentId } }),
      this.prisma.matchGame.createMany({ data: matches }),
    ]);
  }
}
