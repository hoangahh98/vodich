import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TeamDetailService } from './team-detail.service';
import { suggestMonthlyFee } from './team-month-report';
import { monthDate } from './team-utils';

/**
 * "Chốt tháng" cho quỹ đội bóng (9/2026).
 *
 * Mỗi tháng là một ảnh chụp riêng: dòng quỹ (`team_month_fund`) + một dòng phí cho mỗi thành viên
 * (`team_member_payment`, cột `member_type` là loại CỐ ĐỊNH/VÃNG LAI tại tháng đó). Thành viên rời
 * đội hay đổi loại chỉ tác động từ tháng đang thao tác trở đi — tháng cũ giữ nguyên số, kể cả tiền
 * người đã rời đội từng đóng.
 *
 * Chế độ phí của tháng (`fee_mode`):
 * - AUTO: mức phí / người = (tiền sân + tiền khác − còn lại tháng trước) ÷ số cố định, làm tròn lên
 *   nghìn — tính lại mỗi khi đội đổi người, đổi loại hay đổi chi phí. Tháng mới mặc định AUTO.
 * - MANUAL: admin gõ tay, tool không đụng.
 *
 * Mọi thao tác ghi lên một tháng đều đi qua `ensureMonth` để tháng đó có đủ dòng, rồi `recompute`.
 * Xem thêm docs/bao-mat.md không liên quan; nghiệp vụ mô tả ở CLAUDE.md mục "Quỹ đội bóng".
 */
@Injectable()
export class TeamMonthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detail: TeamDetailService,
  ) {}

  /** Bảo đảm tháng có dòng quỹ và mỗi thành viên đang hoạt động có dòng phí, rồi tính lại mức phí. */
  async ensureMonth(teamId: bigint, month?: string) {
    const fundMonth = monthDate(month);
    let fund = await this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
    if (!fund) {
      // Tháng mới: tiền sân lấy theo tháng gần nhất trước đó (thường cố định), tiền khác bắt đầu từ 0.
      const carry = await this.prisma.teamMonthFund.findFirst({ where: { teamId, fundMonth: { lt: fundMonth } }, orderBy: { fundMonth: 'desc' } });
      fund = await this.prisma.teamMonthFund.create({
        data: {
          teamId,
          fundMonth,
          feeMode: 'AUTO',
          monthlyFee: 0,
          courtCost: carry ? Number(carry.courtCost) : 0,
          otherCost: 0,
          previousBalance: await this.detail.previousMonthBalance(teamId, fundMonth),
        },
      });
    }
    const members = await this.prisma.teamMember.findMany({ where: { teamId, active: true }, select: { id: true, memberType: true } });
    const existing = await this.prisma.teamMemberPayment.findMany({ where: { fundMonth, memberId: { in: members.map((m) => m.id) } }, select: { memberId: true } });
    const have = new Set(existing.map((row) => row.memberId.toString()));
    const missing = members.filter((member) => !have.has(member.id.toString()));
    if (missing.length) {
      await this.prisma.teamMemberPayment.createMany({
        data: missing.map((member) => ({ memberId: member.id, fundMonth, memberType: member.memberType, paidAmount: 0, paymentStatus: 'UNPAID' })),
        skipDuplicates: true,
      });
    }
    return this.recompute(teamId, fundMonth);
  }

  /**
   * Tính lại mức phí của tháng (chỉ khi AUTO), cập nhật số tiền mặc định cho dòng cố định CHƯA đóng
   * (dòng đã đóng giữ nguyên số thật), rồi lan sang tháng kế tiếp đã chốt ở chế độ AUTO vì số dư
   * mang sang của nó vừa đổi.
   */
  async recompute(teamId: bigint, fundMonth: Date): Promise<number | null> {
    const fund = await this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
    if (!fund) return null;
    let fee = Number(fund.monthlyFee);
    if (fund.feeMode === 'AUTO') {
      const fixedCount = await this.prisma.teamMemberPayment.count({ where: { fundMonth, memberType: 'FIXED', member: { teamId } } });
      fee = suggestMonthlyFee(Number(fund.courtCost), Number(fund.otherCost), Number(fund.previousBalance), fixedCount);
      if (fee !== Number(fund.monthlyFee)) {
        await this.prisma.teamMonthFund.update({ where: { id: fund.id }, data: { monthlyFee: fee } });
      }
    }
    await this.prisma.teamMemberPayment.updateMany({
      where: { fundMonth, memberType: 'FIXED', paymentStatus: { not: 'PAID' }, member: { teamId } },
      data: { paidAmount: fee },
    });
    const next = await this.prisma.teamMonthFund.findFirst({ where: { teamId, fundMonth: { gt: fundMonth } }, orderBy: { fundMonth: 'asc' } });
    if (next && next.feeMode === 'AUTO') {
      const previousBalance = await this.detail.previousMonthBalance(teamId, next.fundMonth);
      if (previousBalance !== Number(next.previousBalance)) {
        await this.prisma.teamMonthFund.update({ where: { id: next.id }, data: { previousBalance } });
      }
      await this.recompute(teamId, next.fundMonth);
    }
    return fee;
  }

  /** Ghi loại thành viên vào ảnh chụp của MỘT tháng (không đụng tháng khác). */
  async snapshotMemberType(memberId: bigint, month: string | undefined, memberType: string) {
    const fundMonth = monthDate(month);
    await this.prisma.teamMemberPayment.upsert({
      where: { memberId_fundMonth: { memberId, fundMonth } },
      update: { memberType },
      create: { memberId, fundMonth, memberType, paidAmount: 0, paymentStatus: 'UNPAID' },
    });
  }
}
