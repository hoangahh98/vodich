import { Player, TeamExpense, TeamMember, TeamMemberPayment, TeamMonthFund } from '@prisma/client';
import { roundUpToStep } from '../common/money';

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
  suggestedMonthlyFee: number;
  courtCost: number;
  guestPaid: number;
  otherCost: number;
  totalRequired: number;
  previousBalance: number;
  previousMonthBalance: number;
  totalPaid: number;
  fixedPaid: number;
  totalFund: number;
  totalExpense: number;
  totalSpent: number;
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

type TeamFundInput = {
  monthlyFee: number;
  courtCost: number;
  otherCost: number;
  previousBalance: number;
  previousMonthBalance: number;
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
    const finance = this.finance(rows, input.expenses, {
      monthlyFee,
      courtCost: Number(input.fund?.courtCost || 0),
      otherCost: Number(input.fund?.otherCost || 0),
      previousBalance,
      previousMonthBalance: input.previousMonthBalance,
    });
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

  private finance(rows: TeamMemberReportRow[], expenses: TeamExpense[], fund: TeamFundInput): TeamFinanceSummary {
    const { monthlyFee, courtCost, previousBalance, previousMonthBalance } = fund;
    // Tiền vãng lai là một số hạng RIÊNG của tổng quỹ, không gộp vào "tiền khác" (tiền khác
    // chỉ là số admin nhập tay ở Cài đặt). Gộp vào thì mỗi lần lưu Cài đặt sẽ ghi đè tiền
    // vãng lai xuống DB rồi tháng sau cộng tiếp thành hai lần.
    const guestPaid = rows.filter((member) => member.memberType === 'GUEST').reduce((sum, member) => sum + member.paidAmount, 0);
    const otherCost = fund.otherCost;
    const totalPaid = rows.reduce((sum, member) => sum + member.paidAmount, 0);
    const totalExpense = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const totalDue = rows.reduce((sum, member) => sum + member.expectedAmount, 0);
    const totalMissing = rows.reduce((sum, member) => sum + Math.max(0, member.expectedAmount - member.paidAmount), 0);
    const fixedCount = rows.filter((member) => member.memberType === 'FIXED').length;
    const paidCount = rows.filter((member) => member.paymentStatus === 'PAID').length;
    const fixedUnpaidCount = rows.filter((member) => member.memberType === 'FIXED' && member.paymentStatus !== 'PAID').length;
    return {
      monthlyFee,
      suggestedMonthlyFee: suggestMonthlyFee(courtCost, otherCost, previousBalance, fixedCount),
      courtCost,
      guestPaid,
      otherCost,
      totalRequired: requiredCollection(courtCost, otherCost, previousBalance),
      previousBalance,
      previousMonthBalance,
      totalPaid,
      fixedPaid: totalPaid - guestPaid,
      // Tổng quỹ = tiền cả đội PHẢI đóng (mức phí x người cố định) + quỹ còn lại tháng trước
      // + tiền vãng lai đã đóng. Là số dự kiến chứ không phải số đã thu, nên KHÔNG dùng nó
      // để tính quỹ còn lại (balance vẫn đi theo tiền thực đóng bên dưới).
      totalFund: totalDue + previousBalance + guestPaid,
      totalExpense,
      // Tổng đã chi = tiền sân + các khoản chi trong tháng (tiền sân không nằm trong
      // bảng team_expense nên phải cộng tay, đừng nhầm với totalExpense).
      totalSpent: courtCost + totalExpense,
      totalDue,
      totalMissing,
      // Quỹ còn lại trừ cả tiền khác: số này phải khớp previousMonthBalance() bên
      // team-detail.service.ts, sửa một chỗ thì sửa cả hai kẻo số dư mang sang tháng sau lệch.
      balance: previousBalance + totalPaid - courtCost - otherCost - totalExpense,
      memberCount: rows.length,
      fixedCount,
      fixedUnpaidCount,
      guestCount: rows.length - fixedCount,
      paidCount,
      unpaidCount: rows.length - paidCount,
    };
  }
}

// Tổng phải thu tháng này = tiền sân + tiền khác - tiền còn lại tháng trước.
// Giữ nguyên số âm (quỹ dư thừa) để dòng công thức hiện trên giao diện cộng trừ đúng.
export function requiredCollection(courtCost: number, otherCost: number, previousBalance: number) {
  return courtCost + otherCost - previousBalance;
}

// Gợi ý mức phí tháng / người: tổng phải thu chia đều cho thành viên CỐ ĐỊNH rồi làm tròn
// LÊN bội số 1.000đ cho số tiền chẵn (355.500 -> 356.000). Bước 1.000 chứ không dùng mặc
// định 50.000đ của roundUpToStep (bước đó là cho phí giải đấu, đội bóng không cần chênh nhiều).
export function suggestMonthlyFee(courtCost: number, otherCost: number, previousBalance: number, fixedCount: number) {
  if (fixedCount <= 0) return 0;
  return roundUpToStep(requiredCollection(courtCost, otherCost, previousBalance) / fixedCount, 1000);
}

function memberTypeOrder(value?: string) {
  return value === 'GUEST' ? 1 : 0;
}
