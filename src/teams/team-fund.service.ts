import { Injectable } from '@nestjs/common';
import { normalizePaymentStatus } from '../common/enums';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { TeamDetailService } from './team-detail.service';
import { cleanText, hasMoneyValue, monthDate, normalizeMemberType } from './team-utils';

// Dữ liệu thô từ form (mọi ô đều có thể vắng mặt), parseMoney tự quy về 0.
export type TeamFundForm = {
  monthlyFee?: string;
  courtCost?: string;
  otherCost?: string;
  previousBalance?: string;
  notes?: string;
};

@Injectable()
export class TeamFundService {
  constructor(
    private readonly detail: TeamDetailService,
    private readonly prisma: PrismaService,
  ) {}

  async setFund(teamId: bigint, month: string, input: TeamFundForm) {
    const fundMonth = monthDate(month);
    const fee = parseMoney(input.monthlyFee);
    const resolvedPreviousBalance = hasMoneyValue(input.previousBalance)
      ? parseMoney(input.previousBalance)
      : await this.detail.previousMonthBalance(teamId, fundMonth);
    const values = {
      monthlyFee: fee,
      courtCost: parseMoney(input.courtCost),
      otherCost: parseMoney(input.otherCost),
      previousBalance: resolvedPreviousBalance,
      notes: cleanText(input.notes),
    };
    const fund = await this.prisma.teamMonthFund.upsert({
      where: { teamId_fundMonth: { teamId, fundMonth } },
      update: values,
      create: { teamId, fundMonth, ...values },
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
