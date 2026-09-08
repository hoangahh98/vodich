import { Injectable } from '@nestjs/common';
import { normalizePaymentStatus } from '../common/enums';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { TeamDetailService } from './team-detail.service';
import { TeamMonthService } from './team-month.service';
import { cleanText, hasMoneyValue, monthDate, normalizeMemberType } from './team-utils';

// Dữ liệu thô từ form (mọi ô đều có thể vắng mặt), parseMoney tự quy về 0.
export type TeamFundForm = {
  feeMode?: string;
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
    private readonly months: TeamMonthService,
  ) {}

  /**
   * Lưu Cài đặt quỹ của một tháng. Chế độ AUTO thì mức phí gõ tay bị bỏ qua — TeamMonthService tính
   * lại từ chi phí và số cố định của tháng; MANUAL thì giữ đúng số admin gõ.
   */
  async setFund(teamId: bigint, month: string, input: TeamFundForm) {
    const fundMonth = monthDate(month);
    const feeMode = input.feeMode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const resolvedPreviousBalance = hasMoneyValue(input.previousBalance)
      ? parseMoney(input.previousBalance)
      : await this.detail.previousMonthBalance(teamId, fundMonth);
    const values = {
      feeMode,
      monthlyFee: feeMode === 'MANUAL' ? parseMoney(input.monthlyFee) : 0,
      courtCost: parseMoney(input.courtCost),
      otherCost: parseMoney(input.otherCost),
      previousBalance: resolvedPreviousBalance,
      notes: cleanText(input.notes),
    };
    await this.prisma.teamMonthFund.upsert({
      where: { teamId_fundMonth: { teamId, fundMonth } },
      update: values,
      create: { teamId, fundMonth, ...values },
    });
    await this.months.ensureMonth(teamId, month);
    return this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
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
        // Đổi loại ở bảng phí: ghi vào ảnh chụp của THÁNG NÀY và làm loại mặc định cho các tháng sau
        // (cột trên team_member); tháng cũ đã chụp riêng nên không đổi.
        const snapshot = memberType ? { memberType: normalizeMemberType(memberType) } : {};
        return [
          ...(memberType ? [this.prisma.teamMember.update({ where: { id: memberId }, data: { memberType: normalizeMemberType(memberType) } })] : []),
          this.prisma.teamMemberPayment.upsert({
            where: { memberId_fundMonth: { memberId, fundMonth } },
            update: { ...snapshot, paidAmount: parseMoney(amount), paymentStatus: normalizePaymentStatus(body[`status_${memberId}`]), notes: cleanText(body[`notes_${memberId}`]) },
            create: { memberId, fundMonth, ...snapshot, paidAmount: parseMoney(amount), paymentStatus: normalizePaymentStatus(body[`status_${memberId}`]), notes: cleanText(body[`notes_${memberId}`]) },
          }),
        ];
      });
    const result = await this.prisma.$transaction(updates);
    await this.months.ensureMonth(teamId, month);
    return result;
  }
}
