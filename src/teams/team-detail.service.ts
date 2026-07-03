import { Injectable } from '@nestjs/common';
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
    const [team, members, players, fund, expenses] = await Promise.all([
      this.prisma.teamClub.findUniqueOrThrow({ where: { id } }),
      this.prisma.teamMember.findMany({
        where: { teamId: id, active: true },
        include: { player: true, payments: { where: { fundMonth } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.player.findMany({ orderBy: { displayName: 'asc' } }),
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId: id, fundMonth } } }),
      this.prisma.teamExpense.findMany({ where: { teamId: id, expenseMonth: fundMonth }, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }] }),
    ]);
    const report = this.monthReportBuilder.build({ members, players, fund, expenses, previousMonthBalance });
    return { team, members: report.members, players: report.players, fund, expenses, selectedMonth: month, finance: report.finance, emailList: report.emailList };
  }

  async previousMonthBalance(teamId: bigint, fundMonth: Date) {
    const previousMonth = addMonths(fundMonth, -1);
    const [fund, payments, expenses] = await Promise.all([
      this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth: previousMonth } } }),
      this.prisma.teamMemberPayment.findMany({ where: { fundMonth: previousMonth, member: { teamId } } }),
      this.prisma.teamExpense.findMany({ where: { teamId, expenseMonth: previousMonth } }),
    ]);
    if (!fund) return 0;
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.paidAmount), 0);
    const totalExpense = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    return Number(fund.previousBalance || 0) + totalPaid - Number(fund.courtCost || 0) - totalExpense;
  }
}
