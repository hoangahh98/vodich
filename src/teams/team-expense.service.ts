import { Injectable, NotFoundException } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { TeamMonthService } from './team-month.service';
import { cleanText, monthDate } from './team-utils';

/**
 * Khoản chi của đội theo tháng. Khoản chi đổi "Quỹ còn lại" của tháng → đổi số dư mang sang tháng sau, nên
 * thêm/xoá đều phải chốt lại tháng để lan số dư (giống khoản thu vãng lai). Từng quên bước này: 3/10/2026
 * admin sửa khoản chi tháng 9 cho hết −13k mà dư đầu tháng 10 vẫn −13k.
 */
@Injectable()
export class TeamExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly months: TeamMonthService,
  ) {}

  async addExpense(teamId: bigint, month: string, expenseDate: string, content: string, amount: string, notes?: string) {
    const expense = await this.prisma.teamExpense.create({
      data: {
        teamId,
        expenseMonth: monthDate(month),
        expenseDate: expenseDate ? new Date(`${expenseDate}T00:00:00Z`) : null,
        content: content.trim(),
        amount: parseMoney(amount),
        notes: cleanText(notes),
      },
    });
    await this.months.ensureMonth(teamId, month);
    return expense;
  }

  async deleteExpense(teamId: bigint, id: bigint) {
    const expense = await this.prisma.teamExpense.findFirst({ where: { id, teamId }, select: { expenseMonth: true } });
    const result = await this.prisma.teamExpense.deleteMany({ where: { id, teamId } });
    if (!result.count || !expense) throw new NotFoundException('Không tìm thấy khoản chi trong đội');
    await this.months.recompute(teamId, expense.expenseMonth);
    return result;
  }
}
