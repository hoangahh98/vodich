import { Injectable } from '@nestjs/common';
import { normalizePaymentStatus } from '../common/enums';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { TeamDetailService } from './team-detail.service';
import { cleanText, hasMoneyValue, monthDate, normalizeMemberType } from './team-utils';

@Injectable()
export class TeamFundService {
  constructor(
    private readonly detail: TeamDetailService,
    private readonly prisma: PrismaService,
  ) {}

  async setFund(teamId: bigint, month: string, monthlyFee: string, courtCost: string, previousBalance?: string, notes?: string) {
    const fundMonth = monthDate(month);
    const fee = parseMoney(monthlyFee);
    const resolvedPreviousBalance = hasMoneyValue(previousBalance) ? parseMoney(previousBalance) : await this.detail.previousMonthBalance(teamId, fundMonth);
    const fund = await this.prisma.teamMonthFund.upsert({
      where: { teamId_fundMonth: { teamId, fundMonth } },
      update: { monthlyFee: fee, courtCost: parseMoney(courtCost), previousBalance: resolvedPreviousBalance, notes: cleanText(notes) },
      create: { teamId, fundMonth, monthlyFee: fee, courtCost: parseMoney(courtCost), previousBalance: resolvedPreviousBalance, notes: cleanText(notes) },
    });
    const fixedMembers = await this.prisma.teamMember.findMany({ where: { teamId, active: true, memberType: 'FIXED' } });
    await this.prisma.$transaction(
      fixedMembers.map((member) =>
        this.prisma.teamMemberPayment.upsert({
          where: { memberId_fundMonth: { memberId: member.id, fundMonth } },
          update: { paidAmount: fee },
          create: { memberId: member.id, fundMonth, paidAmount: fee, paymentStatus: 'UNPAID' },
        }),
      ),
    );
    return fund;
  }

  async updatePayments(teamId: bigint, month: string, body: Record<string, string>) {
    const fundMonth = monthDate(month);
    const memberIds = Object.keys(body)
      .filter((key) => key.startsWith('amount_'))
      .map((key) => BigInt(key.replace('amount_', '')));
    const validMembers = await this.prisma.teamMember.findMany({
      where: { teamId, id: { in: memberIds } },
      select: { id: true },
    });
    const validMemberIds = new Set(validMembers.map((member) => member.id.toString()));
    const updates = Object.entries(body)
      .filter(([key]) => key.startsWith('amount_'))
      .filter(([key]) => validMemberIds.has(key.replace('amount_', '')))
      .flatMap(([key, amount]) => {
        const memberId = BigInt(key.replace('amount_', ''));
        const memberType = body[`memberType_${memberId}`];
        return [
          ...(memberType ? [this.prisma.teamMember.update({ where: { id: memberId }, data: { memberType: normalizeMemberType(memberType) } })] : []),
          this.prisma.teamMemberPayment.upsert({
            where: { memberId_fundMonth: { memberId, fundMonth } },
            update: { paidAmount: parseMoney(amount), paymentStatus: normalizePaymentStatus(body[`status_${memberId}`]), notes: cleanText(body[`notes_${memberId}`]) },
            create: { memberId, fundMonth, paidAmount: parseMoney(amount), paymentStatus: normalizePaymentStatus(body[`status_${memberId}`]), notes: cleanText(body[`notes_${memberId}`]) },
          }),
        ];
      });
    return this.prisma.$transaction(updates);
  }
}
