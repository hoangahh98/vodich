import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { cleanText } from './team-utils';

@Injectable()
export class TeamCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [teams, memberCounts] = await Promise.all([
      this.prisma.teamClub.findMany({ orderBy: { id: 'desc' } }),
      this.prisma.teamMember.groupBy({
        by: ['teamId'],
        where: { active: true },
        _count: { _all: true },
      }),
    ]);
    const countByTeamId = new Map(memberCounts.map((item) => [item.teamId.toString(), item._count._all]));
    return teams.map((team) => ({
      ...team,
      activeMemberCount: countByTeamId.get(team.id.toString()) || 0,
    }));
  }

  create(name: string, description?: string) {
    return this.prisma.teamClub.create({ data: { name: name.trim(), description: cleanText(description) } });
  }

  updateTeam(id: bigint, name: string, description?: string) {
    return this.prisma.teamClub.update({
      where: { id },
      data: { name: name.trim(), description: cleanText(description), updatedAt: new Date() },
    });
  }
}
