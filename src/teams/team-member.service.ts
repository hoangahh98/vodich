import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { cleanText, monthDate, normalizeMemberType } from './team-utils';

@Injectable()
export class TeamMemberService {
  constructor(private readonly prisma: PrismaService) {}

  async addMember(teamId: bigint, playerId: bigint, memberType: string, notes?: string, month?: string) {
    const normalizedMemberType = normalizeMemberType(memberType);
    const member = await this.prisma.teamMember.upsert({
      where: { teamId_playerId: { teamId, playerId } },
      update: { active: true, memberType: normalizedMemberType, notes: cleanText(notes) },
      create: { teamId, playerId, memberType: normalizedMemberType, notes: cleanText(notes) },
    });
    const fundMonth = monthDate(month);
    const fund = await this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
    if (fund && normalizedMemberType === 'FIXED') {
      await this.prisma.teamMemberPayment.upsert({
        where: { memberId_fundMonth: { memberId: member.id, fundMonth: fund.fundMonth } },
        update: { paidAmount: Number(fund.monthlyFee), paymentStatus: 'UNPAID' },
        create: { memberId: member.id, fundMonth: fund.fundMonth, paidAmount: Number(fund.monthlyFee), paymentStatus: 'UNPAID' },
      });
    }
    return member;
  }

  async addMembers(teamId: bigint, playerIds: bigint[], memberType: string, notes?: string, month?: string) {
    const uniqueIds = [...new Set(playerIds.map((id) => id.toString()))].map((id) => BigInt(id));
    for (const playerId of uniqueIds) {
      await this.addMember(teamId, playerId, memberType, notes, month);
    }
    return uniqueIds.length;
  }

  async updateMember(teamId: bigint, memberId: bigint, memberType: string, notes?: string) {
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { memberType: normalizeMemberType(memberType), notes: cleanText(notes) },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    return result;
  }

  async removeMember(teamId: bigint, memberId: bigint) {
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { active: false },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    return result;
  }
}
