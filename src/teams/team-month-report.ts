import { Player, TeamExpense, TeamMember, TeamMemberPayment, TeamMonthFund } from '@prisma/client';

export type TeamMemberWithPayment = TeamMember & {
  player: Player;
  payments: TeamMemberPayment[];
};

export type TeamMemberReportRow = TeamMemberWithPayment & {
  payment?: TeamMemberPayment;
  expectedAmount: number;
  paidAmount: number;
  enteredAmount: number;
  paymentStatus: string;
  feeNotes: string;
  difference: number;
  typeLabel: string;
};

export type TeamFinanceSummary = {
  monthlyFee: number;
  courtCost: number;
  previousBalance: number;
  previousMonthBalance: number;
  totalPaid: number;
  totalDonate: number;
  totalExpense: number;
  totalDue: number;
  totalMissing: number;
  balance: number;
  memberCount: number;
  fixedCount: number;
  fixedUnpaidCount: number;
  guestCount: number;
  paidCount: number;
  unpaidCount: number;
};

type TeamMonthReportInput = {
  members: TeamMemberWithPayment[];
  players: Player[];
  fund: TeamMonthFund | null;
  expenses: TeamExpense[];
  previousMonthBalance: number;
};

export class TeamMonthReportBuilder {
  build(input: TeamMonthReportInput) {
    const monthlyFee = Number(input.fund?.monthlyFee || 0);
    const rows = this.memberRows(input.members, monthlyFee);
    const previousBalance = input.fund ? Number(input.fund.previousBalance || 0) : input.previousMonthBalance;
    const finance = this.finance(rows, input.expenses, monthlyFee, Number(input.fund?.courtCost || 0), previousBalance, input.previousMonthBalance);
    const activePlayerIds = new Set(rows.map((member) => member.playerId.toString()));
    return {
      members: rows,
      players: input.players.filter((player) => !activePlayerIds.has(player.id.toString())),
      finance,
      emailList: rows
        .filter((member) => member.memberType === 'FIXED')
        .map((member) => member.player.email)
        .filter(Boolean)
        .join('\n'),
    };
  }

  private memberRows(members: TeamMemberWithPayment[], monthlyFee: number): TeamMemberReportRow[] {
    return members
      .map((member) => {
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
      })
      .sort((a, b) => memberTypeOrder(a.memberType) - memberTypeOrder(b.memberType) || a.player.displayName.localeCompare(b.player.displayName, 'vi'));
  }

  private finance(
    rows: TeamMemberReportRow[],
    expenses: TeamExpense[],
    monthlyFee: number,
    courtCost: number,
    previousBalance: number,
    previousMonthBalance: number,
  ): TeamFinanceSummary {
    const totalPaid = rows.reduce((sum, member) => sum + member.paidAmount, 0);
    const totalDonate = rows.reduce((sum, member) => sum + Math.max(0, member.paidAmount - member.expectedAmount), 0);
    const totalExpense = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const totalDue = rows.reduce((sum, member) => sum + member.expectedAmount, 0);
    const totalMissing = rows.reduce((sum, member) => sum + Math.max(0, member.expectedAmount - member.paidAmount), 0);
    const fixedCount = rows.filter((member) => member.memberType === 'FIXED').length;
    const paidCount = rows.filter((member) => member.paymentStatus === 'PAID').length;
    const fixedUnpaidCount = rows.filter((member) => member.memberType === 'FIXED' && member.paymentStatus !== 'PAID').length;
    return {
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
  }
}

function memberTypeOrder(value?: string) {
  return value === 'GUEST' ? 1 : 0;
}
