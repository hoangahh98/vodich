import { Injectable } from '@nestjs/common';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere } from '../common/admin-scope';
import { PrismaService } from '../prisma.service';
import { TeamMonthReportBuilder, suggestMonthlyFee, TeamMemberWithPayment } from './team-month-report';
import { addMonths, monthDate } from './team-utils';

@Injectable()
export class TeamDetailService {
  private readonly monthReportBuilder = new TeamMonthReportBuilder();

  constructor(private readonly prisma: PrismaService) {}

  async detail(id: bigint) {
    return this.detailForMonth(id, new Date().toISOString().slice(0, 7));
  }

  async detailForMonth(id: bigint, month: string) {
    const fundMonth = monthDate(month);
    const previousMonthBalance = await this.previousMonthBalance(id, fundMonth);
    const team = await this.prisma.teamClub.findUniqueOrThrow({
      where: { id },
      include: { ownerAdmin: true, permissions: { include: { admin: true }, orderBy: { id: 'asc' } }, groups: { include: { group: true }, orderBy: { id: 'asc' } } },
    });
    const [members, players, storedFund, expenses, admins, guestReceipts] = await Promise.all([
      this.monthRoster(id, fundMonth),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId: id, fundMonth } } }),
      this.prisma.teamExpense.findMany({ where: { teamId: id, expenseMonth: fundMonth }, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }] }),
      this.availableAdmins(id, team.ownerAdminId),
      this.prisma.teamGuestReceipt.findMany({ where: { teamId: id, receiptMonth: fundMonth }, include: { player: true }, orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }] }),
    ]);
    // Tháng chưa chốt: xem trước với tiền sân của tháng gần nhất, phí tự chia đều. Không ghi gì xuống DB —
    // chỉ khi có thao tác (thêm người, lưu cài đặt…) TeamMonthService mới tạo dòng thật.
    const fundPreview = !storedFund;
    const fund = storedFund ?? (await this.previewFund(id, fundMonth, previousMonthBalance, members));
    const report = this.monthReportBuilder.build({ members, players, fund, expenses, previousMonthBalance, guestReceipts });
    return { team, members: report.members, players: report.players, allPlayers: players, fund, fundPreview, expenses, guestReceipts, admins, selectedMonth: month, finance: report.finance, emailList: report.emailList };
  }

  /**
   * Danh sách thành viên CỦA THÁNG: ai có dòng phí tháng đó (kể cả người đã rời đội sau này) theo loại
   * đã chụp, cộng thêm người đang hoạt động mà tháng chưa có dòng (tháng chưa chốt) theo loại hiện tại.
   */
  async monthRoster(teamId: bigint, fundMonth: Date): Promise<TeamMemberWithPayment[]> {
    const [rows, active] = await Promise.all([
      this.prisma.teamMemberPayment.findMany({ where: { fundMonth, member: { teamId } }, include: { member: { include: { player: true } } }, orderBy: { id: 'asc' } }),
      this.prisma.teamMember.findMany({ where: { teamId, active: true }, include: { player: true }, orderBy: { id: 'asc' } }),
    ]);
    const roster = new Map<string, TeamMemberWithPayment>();
    for (const row of rows) {
      const { member, ...payment } = row;
      roster.set(member.id.toString(), { ...member, memberType: row.memberType || member.memberType, payments: [payment] });
    }
    for (const member of active) {
      if (!roster.has(member.id.toString())) roster.set(member.id.toString(), { ...member, payments: [] });
    }
    return [...roster.values()];
  }

  private async previewFund(teamId: bigint, fundMonth: Date, previousBalance: number, members: TeamMemberWithPayment[]) {
    const carry = await this.prisma.teamMonthFund.findFirst({ where: { teamId, fundMonth: { lt: fundMonth } }, orderBy: { fundMonth: 'desc' } });
    const courtCost = carry ? Number(carry.courtCost) : 0;
    const fixedCount = members.filter((member) => member.memberType === 'FIXED').length;
    return { teamId, fundMonth, feeMode: 'AUTO', monthlyFee: suggestMonthlyFee(courtCost, 0, previousBalance, fixedCount), courtCost, otherCost: 0, previousBalance, notes: null } as unknown as import('@prisma/client').TeamMonthFund;
  }

  async previousMonthBalance(teamId: bigint, fundMonth: Date) {
    const previousMonth = addMonths(fundMonth, -1);
    const [fund, payments, expenses, receipts] = await Promise.all([
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth: previousMonth } } }),
      this.prisma.teamMemberPayment.findMany({ where: { fundMonth: previousMonth, member: { teamId } }, include: { member: true } }),
      this.prisma.teamExpense.findMany({ where: { teamId, expenseMonth: previousMonth } }),
      this.prisma.teamGuestReceipt.findMany({ where: { teamId, receiptMonth: previousMonth } }),
    ]);
    if (!fund) return 0;
    // Đi đúng công thức balance của team-month-report.ts: (phải đóng + dư trước + vãng lai)
    // - (tiền sân + khoản chi). Lệch công thức thì số dư app tự điền cho tháng sau sẽ khác
    // với "Quỹ còn lại" đang hiện trên màn hình, càng để lâu càng lệch dồn.
    // Số cố định và loại lấy từ ẢNH CHỤP của tháng trước (dòng phí), không phải danh sách hiện tại:
    // người đã rời đội vẫn được tính đúng tháng họ còn ở và đã đóng.
    const typeOf = (payment: (typeof payments)[number]) => payment.memberType || payment.member.memberType;
    const fixedCount = payments.filter((payment) => typeOf(payment) === 'FIXED').length;
    const totalDue = Number(fund.monthlyFee || 0) * fixedCount;
    const guestPaid =
      payments
        .filter((payment) => typeOf(payment) === 'GUEST' && payment.paymentStatus === 'PAID')
        .reduce((sum, payment) => sum + Number(payment.paidAmount), 0) + receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0);
    const totalExpense = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    return Number(fund.previousBalance || 0) + totalDue + guestPaid - Number(fund.courtCost || 0) - totalExpense;
  }

  private availableAdmins(teamId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: availableAdminsWhere(ownerAdminId, { teamPermissions: { none: { teamId } } }),
      orderBy: AVAILABLE_ADMINS_ORDER,
    });
  }
}
