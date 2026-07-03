import { Injectable, NotFoundException } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { cleanText, monthDate } from './team-utils';

@Injectable()
export class TeamExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  addExpense(teamId: bigint, month: string, expenseDate: string, content: string, amount: string, notes?: string) {
    return this.prisma.teamExpense.create({
      data: {
        teamId,
        expenseMonth: monthDate(month),
        expenseDate: expenseDate ? new Date(`${expenseDate}T00:00:00Z`) : null,
        content: content.trim(),
        amount: parseMoney(amount),
        notes: cleanText(notes),
      },
    });
  }

  async deleteExpense(teamId: bigint, id: bigint) {
    const result = await this.prisma.teamExpense.deleteMany({ where: { id, teamId } });
    if (!result.count) throw new NotFoundException('Không tìm thấy khoản chi trong đội');
    return result;
  }
}
