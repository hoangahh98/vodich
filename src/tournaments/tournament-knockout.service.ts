import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TournamentDetailService } from './tournament-detail.service';
import { finishedStageWinners, finishedStageLosers, knockoutSeeds, STAGE_THIRD_PLACE } from './tournament-schedule';
import { aggregateCrossGroupStandings } from './tournament-ranking';

@Injectable()
export class TournamentKnockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detail: TournamentDetailService,
  ) {}

  /**
   * Kiểm tra tình trạng thiếu suất & lấy danh sách gợi ý Wildcard cho vòng knockout.
   */
  async getWildcardStatus(tournamentId: bigint) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: 'Vòng bảng' },
      orderBy: [{ groupName: 'asc' }, { roundNumber: 'asc' }, { courtNumber: 'asc' }],
    });
    const finishedMatches = matches.filter((m) => m.status === 'FINISHED');
    const groupStageFinished = matches.length > 0 && matches.every((m) => m.status === 'FINISHED');
    const groupRankings = await this.detail.rankings(tournamentId);
    const advancePerGroup = tournament.advancePerGroup ?? 2;
    const targetCount = tournament.knockoutQualifierCount;

    const crossGroup = aggregateCrossGroupStandings(
      groupRankings,
      finishedMatches.map((m) => ({
        teamA: m.teamA,
        teamB: m.teamB,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        status: m.status,
        groupName: m.groupName,
        stage: m.stage,
      })),
      advancePerGroup,
      targetCount,
    );

    let currentWildcards: string[] = [];
    if (tournament.wildcardTeams) {
      try {
        currentWildcards = JSON.parse(tournament.wildcardTeams);
      } catch {}
    }

    return {
      ...crossGroup,
      groupStageFinished,
      currentWildcards,
      hasShortage: crossGroup.shortage > 0,
    };
  }

  /**
   * Xác nhận hoặc chọn thay thế danh sách Wildcards.
   */
  async selectWildcards(tournamentId: bigint, selectedTeams: string[]): Promise<boolean> {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const groupMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: 'Vòng bảng' },
    });
    if (!groupMatches.length || groupMatches.some((m) => m.status !== 'FINISHED')) {
      throw new Error('Không thể chọn wildcard khi vòng bảng chưa hoàn tất');
    }

    const status = await this.getWildcardStatus(tournamentId);
    if (selectedTeams.length !== status.shortage) {
      throw new Error(`Số lượng wildcard không khớp: cần chọn ${status.shortage} đội nhưng nhận ${selectedTeams.length}`);
    }

    for (const t of selectedTeams) {
      if (status.directlyQualified.includes(t)) {
        throw new Error(`Đội đã vào thẳng không thể chọn làm wildcard: ${t}`);
      }
    }

    const uniqueSelected = new Set(selectedTeams);
    if (uniqueSelected.size !== selectedTeams.length) {
      throw new Error('Danh sách wildcard có đội trùng lặp');
    }

    const candidateNames = status.candidates.map((c) => c.teamName);
    for (const t of selectedTeams) {
      if (!candidateNames.includes(t)) {
        throw new Error(`Đội không hợp lệ trong danh sách xét wildcard: ${t}`);
      }
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { wildcardTeams: JSON.stringify(selectedTeams) },
    });

    const allQualified = [...status.directlyQualified, ...selectedTeams];
    const firstStage = tournament.knockoutQualifierCount >= 8 ? 'Tứ kết' : 'Bán kết';
    await this.updateStageTeams(tournamentId, firstStage, allQualified);
    return true;
  }

  /**
   * Lưu kết quả bốc thăm vòng quay cho một vòng knockout ('Tứ kết' hoặc 'Bán kết').
   */
  async saveStageDraw(tournamentId: bigint, stage: string, pairs: { teamA: string; teamB: string }[]): Promise<boolean> {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage },
      orderBy: [{ courtNumber: 'asc' }, { id: 'asc' }],
    });
    if (matches.length !== pairs.length) {
      throw new Error(`Số lượng cặp đấu không khớp với số trận của ${stage}: cần ${matches.length}, nhận ${pairs.length}`);
    }
    const allTeams = pairs.flatMap((p) => [p.teamA, p.teamB]);
    const uniqueTeams = new Set(allTeams);
    if (uniqueTeams.size !== allTeams.length) {
      throw new Error('Các cặp đấu bốc thăm có đội bị trùng lặp');
    }
    const updates: ReturnType<typeof this.prisma.matchGame.update>[] = [];
    for (let i = 0; i < matches.length; i++) {
      updates.push(
        this.prisma.matchGame.update({
          where: { id: matches[i].id },
          data: {
            teamA: pairs[i].teamA,
            teamB: pairs[i].teamB,
            scoreA: 0,
            scoreB: 0,
            status: 'SCHEDULED',
            servingTeam: 'A',
            scoreOrder: 2,
            updatedAt: new Date(),
          },
        }),
      );
    }
    await this.prisma.$transaction(updates);
    return true;
  }

  /**
   * Tiến trình Bán kết: Tùy chọn Nhánh cố định (FIXED) hoặc Vòng quay (WHEEL).
   */
  async advanceSemifinals(
    tournamentId: bigint,
    mode: 'FIXED' | 'WHEEL',
    wheelPairs?: { teamA: string; teamB: string }[],
  ): Promise<boolean> {
    const qfMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId, stage: 'Tứ kết' },
      orderBy: [{ courtNumber: 'asc' }, { id: 'asc' }],
    });
    if (qfMatches.length !== 4) {
      throw new Error('Số trận tứ kết không hợp lệ để tiến sang bán kết');
    }
    if (qfMatches.some((m) => m.status !== 'FINISHED')) {
      throw new Error('Chưa hoàn tất các trận tứ kết');
    }

    const qfWinners = qfMatches.map((m) => (m.scoreA > m.scoreB ? m.teamA : m.teamB));
    let sfPairs: { teamA: string; teamB: string }[] = [];
    if (mode === 'FIXED') {
      sfPairs = [
        { teamA: qfWinners[0], teamB: qfWinners[1] },
        { teamA: qfWinners[2], teamB: qfWinners[3] },
      ];
    } else if (mode === 'WHEEL') {
      if (!wheelPairs || wheelPairs.length !== 2) {
        throw new Error('Bốc thăm bán kết yêu cầu đúng 2 cặp đấu');
      }
      const wheelTeams = wheelPairs.flatMap((p) => [p.teamA, p.teamB]);
      for (const w of qfWinners) {
        if (!wheelTeams.includes(w)) {
          throw new Error(`Đội thắng tứ kết ${w} không có trong kết quả bốc thăm bán kết`);
        }
      }
      sfPairs = wheelPairs;
    } else {
      throw new Error(`Chế độ bán kết không hợp lệ: ${mode}`);
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { semiDrawMethod: mode },
    });

    return this.saveStageDraw(tournamentId, 'Bán kết', sfPairs);
  }

  /**
   * Tự động đồng bộ các vòng knockout khi có trận đấu hoàn thành.
   */
  async syncKnockout(tournamentId: bigint): Promise<boolean> {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (tournament.format !== 'GROUP_KNOCKOUT') return false;

    const matches = await this.matchesForTournament(tournamentId);
    const groupMatches = matches.filter((match) => match.stage === 'Vòng bảng');
    if (!groupMatches.length || groupMatches.some((match) => match.status !== 'FINISHED')) return false;

    let changed = false;
    const rankings = await this.detail.rankings(tournamentId);
    const firstStage = tournament.knockoutQualifierCount >= 8 ? 'Tứ kết' : tournament.knockoutQualifierCount >= 4 ? 'Bán kết' : 'Chung kết';

    // Xác định các đội vào vòng đầu
    const status = await this.getWildcardStatus(tournamentId);
    let seedTeams: string[] = [];
    if (status.shortage > 0) {
      if (tournament.wildcardTeams) {
        try {
          const wcs: string[] = JSON.parse(tournament.wildcardTeams);
          if (wcs.length === status.shortage) {
            seedTeams = [...status.directlyQualified, ...wcs];
          }
        } catch {}
      }
    } else {
      seedTeams = knockoutSeeds(tournament.knockoutQualifierCount, rankings);
      if (!seedTeams.length || seedTeams.length < tournament.knockoutQualifierCount) {
        seedTeams = status.directlyQualified;
      }
    }

    if (seedTeams.length >= tournament.knockoutQualifierCount) {
      changed = (await this.updateStageTeams(tournamentId, firstStage, seedTeams)) || changed;
    }

    // Tứ kết hoàn tất -> Bán kết (nếu đang ở FIXED mode)
    if (tournament.knockoutQualifierCount >= 8) {
      const quarterWinners = finishedStageWinners(matches, 'Tứ kết');
      if (quarterWinners && quarterWinners.length === 4) {
        if (tournament.semiDrawMethod !== 'WHEEL') {
          changed = (await this.updateStageTeams(tournamentId, 'Bán kết', quarterWinners)) || changed;
        }
      }
    }

    // Bán kết hoàn tất -> Chung kết & Tranh hạng 3-4
    if (tournament.knockoutQualifierCount >= 4) {
      const currentMatches = await this.matchesForTournament(tournamentId);
      const semiWinners = finishedStageWinners(currentMatches, 'Bán kết');
      if (semiWinners && semiWinners.length === 2) {
        changed = (await this.updateStageTeams(tournamentId, 'Chung kết', semiWinners)) || changed;
      }
      if (tournament.hasThirdPlace !== false) {
        const semiLosers = finishedStageLosers(currentMatches, 'Bán kết');
        if (semiLosers && semiLosers.length === 2) {
          changed = (await this.updateStageTeams(tournamentId, STAGE_THIRD_PLACE, semiLosers)) || changed;
        }
      }
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
