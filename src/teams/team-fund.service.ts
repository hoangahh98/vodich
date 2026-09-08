import { Injectable } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { parseBigId } from '../common/controller-utils';
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

  /**
   * Lưu số ĐÃ THU của từng thành viên cố định trong tháng. Không có ô tích: trạng thái ghi xuống DB
   * (để báo cáo/khách xem) suy từ đã thu ≥ mức phí của tháng.
   */
  async updatePayments(teamId: bigint, month: string, body: Record<string, string>) {
    const fundMonth = monthDate(month);
    // Nút "Tất cả đã đóng": mọi ô gửi lên được nâng lên đủ mức phí tháng (ai đã đóng hơn thì giữ).
    // Chốt tháng TRƯỚC khi đọc mức phí, vì tháng chưa chốt thì chưa có dòng quỹ để lấy phí.
    const markAllPaid = body.markAllPaid === '1';
    if (markAllPaid) await this.months.ensureMonth(teamId, month);
    const fund = await this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
    const fee = Number(fund?.monthlyFee || 0);
    const statusFor = (amount: number) => (amount > 0 && amount >= fee ? 'PAID' : 'UNPAID');
    const amountFor = (raw: string) => (markAllPaid ? Math.max(parseMoney(raw), fee) : parseMoney(raw));
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
            update: { ...snapshot, paidAmount: amountFor(amount), paymentStatus: statusFor(amountFor(amount)) },
            create: { memberId, fundMonth, ...snapshot, paidAmount: amountFor(amount), paymentStatus: statusFor(amountFor(amount)) },
          }),
        ];
      });
    const result = await this.prisma.$transaction(updates);
    await this.months.ensureMonth(teamId, month);
    return result;
  }

  /** Ghi một buổi vãng lai: chọn người trong danh sách chung hoặc gõ tên; ngày chơi; số tiền. */
  async addGuestReceipt(teamId: bigint, month: string, body: Record<string, string | undefined>) {
    const receiptMonth = monthDate(month);
    const amount = parseMoney(body.amount);
    // Ô "Người chơi" là ô gõ tìm: trùng đúng tên một thành viên trong danh sách chung thì gắn vào
    // người đó, không thì lưu làm tên khách. Vẫn nhận playerId nếu form nào gửi thẳng id.
    const typed = cleanText(body.guest) || cleanText(body.guestName);
    let playerId = parseBigId(body.playerId);
    if (!playerId && typed) {
      const matched = await this.prisma.player.findFirst({ where: { displayName: { equals: typed, mode: 'insensitive' } }, select: { id: true } });
      playerId = matched?.id ?? null;
    }
    const guestName = typed;
    if (amount <= 0 || (!playerId && !guestName)) throw new Error('Cần gõ tên người chơi và số tiền lớn hơn 0');
    const parsedDate = body.receiptDate ? new Date(`${body.receiptDate}T00:00:00Z`) : receiptMonth;
    const receiptDate = Number.isNaN(parsedDate.getTime()) ? receiptMonth : parsedDate;
    const receipt = await this.prisma.teamGuestReceipt.create({
      data: { teamId, playerId, guestName: playerId ? null : guestName, receiptMonth, receiptDate, amount },
    });
    // Tiền vãng lai đổi số dư mang sang tháng sau → chốt tháng để lan số dư.
    await this.months.ensureMonth(teamId, month);
    return receipt;
  }

  async deleteGuestReceipt(teamId: bigint, receiptId: bigint) {
    const receipt = await this.prisma.teamGuestReceipt.findFirst({ where: { id: receiptId, teamId } });
    if (!receipt) return;
    await this.prisma.teamGuestReceipt.deleteMany({ where: { id: receiptId, teamId } });
    await this.months.recompute(teamId, receipt.receiptMonth);
  }
}
