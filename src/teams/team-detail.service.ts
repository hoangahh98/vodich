import { Injectable } from '@nestjs/common';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere } from '../common/admin-scope';
import { PrismaService } from '../prisma.service';
import { TeamMonthReportBuilder } from './team-month-report';
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
      include: { ownerAdmin: true, permissions: { include: { admin: true }, orderBy: { id: 'asc' } } },
    });
    const [members, players, fund, expenses, admins] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { teamId: id, active: true },
        include: { player: true, payments: { where: { fundMonth } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId: id, fundMonth } } }),
      this.prisma.teamExpense.findMany({ where: { teamId: id, expenseMonth: fundMonth }, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }] }),
      this.availableAdmins(id, team.ownerAdminId),
    ]);
    const report = this.monthReportBuilder.build({ members, players, fund, expenses, previousMonthBalance });
    return { team, members: report.members, players: report.players, fund, expenses, admins, selectedMonth: month, finance: report.finance, emailList: report.emailList };
  }

  async previousMonthBalance(teamId: bigint, fundMonth: Date) {
    const previousMonth = addMonths(fundMonth, -1);
    const [fund, payments, expenses, fixedCount] = await Promise.all([
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth: previousMonth } } }),
      this.prisma.teamMemberPayment.findMany({ where: { fundMonth: previousMonth, member: { teamId } }, include: { member: true } }),
      this.prisma.teamExpense.findMany({ where: { teamId, expenseMonth: previousMonth } }),
      this.prisma.teamMember.count({ where: { teamId, active: true, memberType: 'FIXED' } }),
    ]);
    if (!fund) return 0;
    // Đi đúng công thức balance của team-month-report.ts: (phải đóng + dư trước + vãng lai)
    // - (tiền sân + khoản chi). Lệch công thức thì số dư app tự điền cho tháng sau sẽ khác
    // với "Quỹ còn lại" đang hiện trên màn hình, càng để lâu càng lệch dồn.
    const totalDue = Number(fund.monthlyFee || 0) * fixedCount;
    const guestPaid = payments
      .filter((payment) => payment.member.memberType === 'GUEST' && payment.paymentStatus === 'PAID')
      .reduce((sum, payment) => sum + Number(payment.paidAmount), 0);
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
