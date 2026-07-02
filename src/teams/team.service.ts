import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseMoney } from '../common/money';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.teamClub.findMany({ orderBy: { id: 'desc' } });
  }

  create(name: string, description?: string) {
    return this.prisma.teamClub.create({ data: { name: name.trim(), description: description?.trim() || null } });
  }

  async detail(id: bigint) {
    const [team, members, players, fund] = await Promise.all([
      this.prisma.teamClub.findUniqueOrThrow({ where: { id } }),
      this.prisma.teamMember.findMany({ where: { teamId: id, active: true }, include: { player: true }, orderBy: { id: 'asc' } }),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.teamMonthFund.findFirst({ where: { teamId: id }, orderBy: { fundMonth: 'desc' } }),
    ]);
    return { team, members, players, fund };
  }

  addMember(teamId: bigint, playerId: bigint, memberType: string) {
    return this.prisma.teamMember.upsert({
      where: { teamId_playerId: { teamId, playerId } },
      update: { active: true, memberType },
      create: { teamId, playerId, memberType },
    });
  }

  setFund(teamId: bigint, month: string, monthlyFee: string, courtCost: string) {
    const fundMonth = new Date(`${month || new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
    return this.prisma.teamMonthFund.upsert({
      where: { teamId_fundMonth: { teamId, fundMonth } },
      update: { monthlyFee: parseMoney(monthlyFee), courtCost: parseMoney(courtCost) },
      create: { teamId, fundMonth, monthlyFee: parseMoney(monthlyFee), courtCost: parseMoney(courtCost) },
    });
  }
}
