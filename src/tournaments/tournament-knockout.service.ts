import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TournamentDetailService } from './tournament-detail.service';
import { finishedStageWinners, knockoutSeeds } from './tournament-schedule';

@Injectable()
export class TournamentKnockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detail: TournamentDetailService,
  ) {}

  async syncKnockout(tournamentId: bigint): Promise<boolean> {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (tournament.format !== 'GROUP_KNOCKOUT') return false;

    const matches = await this.matchesForTournament(tournamentId);
    const groupMatches = matches.filter((match) => match.stage === 'Vòng bảng');
    if (!groupMatches.length || groupMatches.some((match) => match.status !== 'FINISHED')) return false;

    let changed = false;
    const rankings = await this.detail.rankings(tournamentId);
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
}
