import { TravelTripExpense, TravelTripExpenseSplit, TravelTripMember, TravelTripCollection } from '@prisma/client';
import { parseMoney } from './travel-money';

export type TravelMemberWithCollection = TravelTripMember & {
  collections: TravelTripCollection[];
};

export type TravelExpenseWithSplits = TravelTripExpense & {
  splits: TravelTripExpenseSplit[];
};

export type TravelPaymentSuggestion = {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
};

export type TravelSummary = {
  totalSpent: number;
  totalCollected: number;
  totalCollectedDisplay: number;
  totalAdvanced: number;
  balance: number;
  memberSpent: Map<string, number>;
  memberPaidTotal: Map<string, number>;
  memberCollected: Map<string, number>;
  actualCollected: Map<string, number>;
  memberDebt: Map<string, number>;
  memberAdvanced: Map<string, number>;
  balances: Map<string, number>;
  paidEnoughTargets: Map<string, number>;
  paymentSuggestions: TravelPaymentSuggestion[];
};

export class TravelSummaryBuilder {
  build(members: TravelMemberWithCollection[], expenses: TravelExpenseWithSplits[], treasurerMemberId?: bigint | null): TravelSummary {
    const memberIds = members.map((member) => member.id.toString());
    const memberNames = new Map(members.map((member) => [member.id.toString(), member.name]));
    const memberSpent = new Map(memberIds.map((id) => [id, 0]));
    const memberPaidTotal = new Map(memberIds.map((id) => [id, 0]));

    let totalSpent = 0;
    expenses.forEach((expense) => {
      const expenseAmount = parseMoney(expense.amount);
      totalSpent += expenseAmount;
      const payerId = expense.paidByMemberId?.toString();
      if (payerId && memberPaidTotal.has(payerId)) {
        memberPaidTotal.set(payerId, (memberPaidTotal.get(payerId) || 0) + expenseAmount);
      }
      expense.splits.forEach((split) => {
        const memberId = split.memberId.toString();
        memberSpent.set(memberId, (memberSpent.get(memberId) || 0) + parseMoney(split.amount));
      });
    });

    const treasurerId = treasurerMemberId?.toString();
    const actualCollected = new Map<string, number>();
    const effectiveCollected = new Map<string, number>();
    const paidEnoughTargets = new Map<string, number>();

    members.forEach((member) => {
      const memberId = member.id.toString();
      const collected = parseMoney(member.collections[0]?.amount);
      actualCollected.set(memberId, collected);
      paidEnoughTargets.set(memberId, Math.max((memberSpent.get(memberId) || 0) - (memberPaidTotal.get(memberId) || 0), 0));
      effectiveCollected.set(memberId, treasurerId === memberId ? memberSpent.get(memberId) || 0 : collected);
    });

    const collectedFromOtherMembers = [...actualCollected.entries()]
      .filter(([memberId]) => !treasurerId || memberId !== treasurerId)
      .reduce((total, [, amount]) => total + amount, 0);

    const memberCollected = new Map<string, number>();
    const memberDebt = new Map<string, number>();
    const memberAdvanced = new Map<string, number>();
    const balances = new Map<string, number>();

    members.forEach((member) => {
      const memberId = member.id.toString();
      const spent = memberSpent.get(memberId) || 0;
      const paidTotal = memberPaidTotal.get(memberId) || 0;
      const collected = effectiveCollected.get(memberId) || 0;
      const remainingShare = Math.max(spent - collected, 0);
      const advanced =
        treasurerId === memberId
          ? Math.max(paidTotal - spent - collectedFromOtherMembers, 0)
          : Math.max(paidTotal - remainingShare, 0);
      const debt = treasurerId === memberId ? 0 : Math.max(remainingShare - paidTotal, 0);
      memberAdvanced.set(memberId, advanced);
      memberDebt.set(memberId, debt);
      memberCollected.set(memberId, Math.min(spent, collected + paidTotal));
      // "Còn" = số dư THỰC: (đã thu + đã trả) - đã chi. Dương = thừa, âm = thiếu.
      // Thủ quỹ giữ tiền của cả nhóm nên tính riêng: đã trả - phần của mình - tiền thu từ người khác.
      // Cách này đảm bảo tổng số dư của mọi người = 0 (sổ cân).
      const netBalance =
        treasurerId === memberId ? paidTotal - spent - collectedFromOtherMembers : collected + paidTotal - spent;
      balances.set(memberId, netBalance);
    });

    return {
      totalSpent,
      totalCollected: [...effectiveCollected.values()].reduce((total, amount) => total + amount, 0),
      totalCollectedDisplay: [...memberCollected.values()].reduce((total, amount) => total + amount, 0),
      totalAdvanced: [...memberAdvanced.values()].reduce((total, amount) => total + amount, 0),
      balance: [...memberCollected.values()].reduce((total, amount) => total + amount, 0) - totalSpent,
      memberSpent,
      memberPaidTotal,
      memberCollected,
      actualCollected,
      memberDebt,
      memberAdvanced,
      balances,
      paidEnoughTargets,
      paymentSuggestions: paymentSuggestions(balances, memberNames),
    };
  }
}

function paymentSuggestions(balances: Map<string, number>, memberNames: Map<string, string>): TravelPaymentSuggestion[] {
  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < 0)
    .map(([memberId, balance]) => ({ memberId, amount: -balance }));
  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([memberId, balance]) => ({ memberId, remaining: balance }));
  const suggestions: TravelPaymentSuggestion[] = [];
  let creditorIndex = 0;
  debtors.forEach((debtor) => {
    let remainingDebt = debtor.amount;
    while (remainingDebt > 0 && creditorIndex < creditors.length) {
      const creditor = creditors[creditorIndex];
      const amount = Math.min(remainingDebt, creditor.remaining);
      if (amount > 0) {
        suggestions.push({
          fromMemberId: debtor.memberId,
          fromName: memberNames.get(debtor.memberId) || '',
          toMemberId: creditor.memberId,
          toName: memberNames.get(creditor.memberId) || '',
          amount,
        });
        remainingDebt -= amount;
        creditor.remaining -= amount;
      }
      if (creditor.remaining <= 0) creditorIndex += 1;
    }
  });
  return suggestions;
}
