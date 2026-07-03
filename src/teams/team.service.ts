import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseMoney } from '../common/money';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [teams, memberCounts] = await Promise.all([
      this.prisma.teamClub.findMany({ orderBy: { id: 'desc' } }),
      this.prisma.teamMember.groupBy({
        by: ['teamId'],
        where: { active: true },
        _count: { _all: true },
      }),
    ]);
    const countByTeamId = new Map(memberCounts.map((item) => [item.teamId.toString(), item._count._all]));
    return teams.map((team) => ({
      ...team,
      activeMemberCount: countByTeamId.get(team.id.toString()) || 0,
    }));
  }

  create(name: string, description?: string) {
    return this.prisma.teamClub.create({ data: { name: name.trim(), description: description?.trim() || null } });
  }

  updateTeam(id: bigint, name: string, description?: string) {
    return this.prisma.teamClub.update({
      where: { id },
      data: { name: name.trim(), description: cleanText(description), updatedAt: new Date() },
    });
  }

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
    const monthlyFee = Number(fund?.monthlyFee || 0);
    const rows = members.map((member) => {
      const payment = member.payments[0];
      const expectedAmount = member.memberType === 'FIXED' ? monthlyFee : 0;
      const paymentStatus = payment?.paymentStatus || 'UNPAID';
      const enteredAmount = payment ? Number(payment.paidAmount || 0) : expectedAmount;
      const paidAmount = paymentStatus === 'PAID' ? enteredAmount : 0;
      return {
        ...member,
        payment,
        expectedAmount,
        paidAmount,
        enteredAmount,
        paymentStatus,
        feeNotes: payment?.notes || '',
        difference: paidAmount - expectedAmount,
        typeLabel: member.memberType === 'FIXED' ? 'Cố định' : 'Vãng lai',
      };
    }).sort((a, b) => memberTypeOrder(a.memberType) - memberTypeOrder(b.memberType) || a.player.displayName.localeCompare(b.player.displayName, 'vi'));
    const totalPaid = rows.reduce((sum, member) => sum + member.paidAmount, 0);
    const totalDonate = rows.reduce((sum, member) => sum + Math.max(0, member.paidAmount - member.expectedAmount), 0);
    const totalExpense = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const courtCost = Number(fund?.courtCost || 0);
    const previousBalance = fund ? Number(fund.previousBalance || 0) : previousMonthBalance;
    const totalDue = rows.reduce((sum, member) => sum + member.expectedAmount, 0);
    const totalMissing = rows.reduce((sum, member) => sum + Math.max(0, member.expectedAmount - member.paidAmount), 0);
    const fixedCount = rows.filter((member) => member.memberType === 'FIXED').length;
    const paidCount = rows.filter((member) => member.paymentStatus === 'PAID').length;
    const fixedUnpaidCount = rows.filter((member) => member.memberType === 'FIXED' && member.paymentStatus !== 'PAID').length;
    const activePlayerIds = new Set(rows.map((member) => member.playerId.toString()));
    const finance = {
      monthlyFee,
      courtCost,
      previousBalance,
      previousMonthBalance,
      totalPaid,
      totalDonate,
      totalExpense,
      totalDue,
      totalMissing,
      balance: previousBalance + totalPaid - courtCost - totalExpense,
      memberCount: rows.length,
      fixedCount,
      fixedUnpaidCount,
      guestCount: rows.length - fixedCount,
      paidCount,
      unpaidCount: rows.length - paidCount,
    };
    const availablePlayers = players.filter((player) => !activePlayerIds.has(player.id.toString()));
    const emailList = rows.map((member) => member.player.email).filter(Boolean).join('; ');
    return { team, members: rows, players: availablePlayers, fund, expenses, selectedMonth: month, finance, emailList };
  }

  async addMember(teamId: bigint, playerId: bigint, memberType: string, notes?: string, month?: string) {
    const normalizedMemberType = normalizeMemberType(memberType);
    const member = await this.prisma.teamMember.upsert({
      where: { teamId_playerId: { teamId, playerId } },
      update: { active: true, memberType: normalizedMemberType, notes: cleanText(notes) },
      create: { teamId, playerId, memberType: normalizedMemberType, notes: cleanText(notes) },
    });
    const fundMonth = monthDate(month);
    const fund = await this.prisma.teamMonthFund.findUnique({ where: { teamId_fundMonth: { teamId, fundMonth } } });
    if (fund && normalizedMemberType === 'FIXED') {
      await this.prisma.teamMemberPayment.upsert({
        where: { memberId_fundMonth: { memberId: member.id, fundMonth: fund.fundMonth } },
        update: { paidAmount: Number(fund.monthlyFee), paymentStatus: 'UNPAID' },
        create: { memberId: member.id, fundMonth: fund.fundMonth, paidAmount: Number(fund.monthlyFee), paymentStatus: 'UNPAID' },
      });
    }
    return member;
  }

  async addMembers(teamId: bigint, playerIds: bigint[], memberType: string, notes?: string, month?: string) {
    const uniqueIds = [...new Set(playerIds.map((id) => id.toString()))].map((id) => BigInt(id));
    for (const playerId of uniqueIds) {
      await this.addMember(teamId, playerId, memberType, notes, month);
    }
    return uniqueIds.length;
  }

  async updateMember(teamId: bigint, memberId: bigint, memberType: string, notes?: string) {
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { memberType: normalizeMemberType(memberType), notes: cleanText(notes) },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    return result;
  }

  async removeMember(teamId: bigint, memberId: bigint) {
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { active: false },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    return result;
  }

  async setFund(teamId: bigint, month: string, monthlyFee: string, courtCost: string, previousBalance?: string, notes?: string) {
    const fundMonth = monthDate(month);
    const fee = parseMoney(monthlyFee);
    const resolvedPreviousBalance = hasMoneyValue(previousBalance) ? parseMoney(previousBalance) : await this.previousMonthBalance(teamId, fundMonth);
    const fund = await this.prisma.teamMonthFund.upsert({
      where: { teamId_fundMonth: { teamId, fundMonth } },
      update: { monthlyFee: fee, courtCost: parseMoney(courtCost), previousBalance: resolvedPreviousBalance, notes: notes?.trim() || null },
      create: { teamId, fundMonth, monthlyFee: fee, courtCost: parseMoney(courtCost), previousBalance: resolvedPreviousBalance, notes: notes?.trim() || null },
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
            update: { paidAmount: parseMoney(amount), paymentStatus: body[`status_${memberId}`] || 'UNPAID', notes: cleanText(body[`notes_${memberId}`]) },
            create: { memberId, fundMonth, paidAmount: parseMoney(amount), paymentStatus: body[`status_${memberId}`] || 'UNPAID', notes: cleanText(body[`notes_${memberId}`]) },
          }),
        ];
      });
    return this.prisma.$transaction(updates);
  }

  addExpense(teamId: bigint, month: string, expenseDate: string, content: string, amount: string, notes?: string) {
    return this.prisma.teamExpense.create({
      data: {
        teamId,
        expenseMonth: monthDate(month),
        expenseDate: expenseDate ? new Date(`${expenseDate}T00:00:00Z`) : null,
        content: content.trim(),
        amount: parseMoney(amount),
        notes: notes?.trim() || null,
      },
    });
  }

  async deleteExpense(teamId: bigint, id: bigint) {
    const result = await this.prisma.teamExpense.deleteMany({ where: { id, teamId } });
    if (!result.count) throw new NotFoundException('Không tìm thấy khoản chi trong đội');
    return result;
  }

  private async previousMonthBalance(teamId: bigint, fundMonth: Date) {
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

function monthDate(month?: string) {
  return new Date(`${month || new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
}

function addMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function hasMoneyValue(value?: string) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeMemberType(value?: string) {
  return value === 'GUEST' ? 'GUEST' : 'FIXED';
}

function memberTypeOrder(value?: string) {
  return value === 'GUEST' ? 1 : 0;
}

function cleanText(value?: string) {
  return value && value.trim() ? value.trim() : null;
}
