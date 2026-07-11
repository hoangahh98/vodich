import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TRAVEL_EXPENSE_CATEGORIES, validExpenseCategory } from './travel.constants';
import { parseMoney, splitEvenly } from './travel-money';
import { TravelSummaryBuilder } from './travel-summary';
import { clean, cleanRequired } from './travel.service';

@Injectable()
export class TravelFinanceService {
  private readonly summaryBuilder = new TravelSummaryBuilder();

  constructor(private readonly prisma: PrismaService) {}

  async summary(tripId: bigint, treasurerMemberId?: bigint | null) {
    const [members, expenses] = await Promise.all([
      this.prisma.travelTripMember.findMany({ where: { tripId, active: true }, include: { collections: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.prisma.travelTripExpense.findMany({ where: { tripId }, include: { splits: true }, orderBy: [{ spentDate: 'asc' }, { id: 'asc' }] }),
    ]);
    return this.summaryBuilder.build(members, expenses, treasurerMemberId);
  }

  /** Thêm thành viên từ danh sách chung (Player). */
  async addMemberFromPlayer(tripId: bigint, playerId: bigint) {
    const player = await this.prisma.player.findUniqueOrThrow({ where: { id: playerId } });
    const member = await this.prisma.travelTripMember.create({
      data: {
        tripId,
        playerId: player.id,
        name: player.displayName,
        email: player.email,
        collections: { create: { tripId, amount: 0 } },
      },
    });
    await this.rebalanceSharedExpenses(tripId);
    return member;
  }

  /** Thêm nhanh bằng tên/email; nếu có email thì gắn/tạo vào danh sách chung (Player). */
  async addQuickMember(tripId: bigint, name: string, email = '') {
    const cleanName = cleanRequired(name, 'Tên thành viên');
    const normalizedEmail = clean(email).toLowerCase();
    const player = normalizedEmail
      ? await this.prisma.player.upsert({
          where: { email: normalizedEmail },
          update: { displayName: cleanName },
          create: { displayName: cleanName, email: normalizedEmail, skillLevel: 'C', notes: '' },
        })
      : null;
    const member = await this.prisma.travelTripMember.create({
      data: {
        tripId,
        playerId: player?.id ?? null,
        name: cleanName,
        email: normalizedEmail,
        collections: { create: { tripId, amount: 0 } },
      },
    });
    await this.rebalanceSharedExpenses(tripId);
    return member;
  }

  async updateMember(tripId: bigint, memberId: bigint, body: Record<string, string>) {
    const email = clean(body.email).toLowerCase();
    const name = cleanRequired(body.name, 'Tên thành viên');
    return this.prisma.travelTripMember.update({ where: { id: memberId, tripId }, data: { name, email } });
  }

  async deleteMember(tripId: bigint, memberId: bigint) {
    await this.prisma.$transaction([
      this.prisma.travelTrip.updateMany({ where: { id: tripId, treasurerMemberId: memberId }, data: { treasurerMemberId: null } }),
      this.prisma.travelTripMember.update({ where: { id: memberId, tripId }, data: { active: false } }),
    ]);
    await this.rebalanceSharedExpenses(tripId);
  }

  async setTreasurer(tripId: bigint, memberId?: string) {
    const treasurerMemberId = memberId ? BigInt(memberId) : null;
    await this.prisma.travelTrip.update({ where: { id: tripId }, data: { treasurerMemberId } });
    if (treasurerMemberId) await this.syncTreasurerCollection(tripId, treasurerMemberId);
  }

  async updateCollections(tripId: bigint, body: Record<string, string>) {
    const trip = await this.prisma.travelTrip.findUniqueOrThrow({ where: { id: tripId } });
    const members = await this.prisma.travelTripMember.findMany({ where: { tripId, active: true }, include: { collections: true } });
    const summary = this.summaryBuilder.build(
      members,
      await this.prisma.travelTripExpense.findMany({ where: { tripId }, include: { splits: true } }),
      trip.treasurerMemberId,
    );
    await this.prisma.$transaction(
      members.map((member) => {
        const memberKey = member.id.toString();
        const amount = trip.treasurerMemberId === member.id ? summary.memberSpent.get(memberKey) || 0 : parseMoney(body[`collection_${memberKey}`]);
        return this.prisma.travelTripCollection.upsert({
          where: { tripId_memberId: { tripId, memberId: member.id } },
          update: { amount, note: clean(body[`collectionNote_${memberKey}`]) },
          create: { tripId, memberId: member.id, amount, note: clean(body[`collectionNote_${memberKey}`]) },
        });
      }),
    );
  }

  async markPaidEnough(tripId: bigint) {
    const trip = await this.prisma.travelTrip.findUniqueOrThrow({ where: { id: tripId } });
    const members = await this.prisma.travelTripMember.findMany({ where: { tripId, active: true }, include: { collections: true } });
    const expenses = await this.prisma.travelTripExpense.findMany({ where: { tripId }, include: { splits: true } });
    const summary = this.summaryBuilder.build(members, expenses, trip.treasurerMemberId);
    await this.prisma.$transaction(
      members.map((member) => {
        const memberKey = member.id.toString();
        const amount = trip.treasurerMemberId === member.id ? summary.memberSpent.get(memberKey) || 0 : summary.paidEnoughTargets.get(memberKey) || 0;
        return this.prisma.travelTripCollection.upsert({
          where: { tripId_memberId: { tripId, memberId: member.id } },
          update: { amount },
          create: { tripId, memberId: member.id, amount },
        });
      }),
    );
  }

  async addExpense(tripId: bigint, body: Record<string, string>) {
    const members = await this.activeMembers(tripId);
    if (!members.length) throw new BadRequestException('Cần có thành viên để chia tiền');
    const title = cleanRequired(body.title, 'Nội dung khoản chi');
    if (!validExpenseCategory(title)) throw new BadRequestException('Nội dung khoản chi không hợp lệ');
    const memberIds = members.map((member) => member.id);
    const paidByMemberId = validMemberId(body.paidByMemberId, memberIds);
    if (!paidByMemberId) throw new BadRequestException('Cần chọn người trả tiền hợp lệ');
    const splitMode = body.splitMode === 'PRIVATE' ? 'PRIVATE' : 'SHARED';
    const splits =
      splitMode === 'PRIVATE'
        ? memberIds
            .map((memberId) => ({ memberId, amount: parseMoney(body[`privateSplit_${memberId}`]) }))
            .filter((item) => item.amount > 0)
        : splitEvenly(parseMoney(body.amount), memberIds);
    const amount = splitMode === 'PRIVATE' ? splits.reduce((total, split) => total + split.amount, 0) : parseMoney(body.amount);
    if (amount <= 0 || !splits.length) throw new BadRequestException('Cần nhập số tiền lớn hơn 0');
    const privateMemberId = splitMode === 'PRIVATE' && splits.length === 1 ? splits[0].memberId : null;
    return this.prisma.travelTripExpense.create({
      data: {
        tripId,
        spentDate: parseDate(body.spentDate),
        title,
        amount,
        note: clean(body.note),
        splitMode,
        privateMemberId,
        paidByMemberId,
        splits: { createMany: { data: splits } },
      },
    });
  }

  async updateExpense(tripId: bigint, expenseId: bigint, body: Record<string, string>) {
    const members = await this.activeMembers(tripId);
    const memberIds = members.map((member) => member.id);
    const title = cleanRequired(body.title, 'Nội dung khoản chi');
    if (!validExpenseCategory(title)) throw new BadRequestException('Nội dung khoản chi không hợp lệ');
    const amount = parseMoney(body.amount);
    const splits = memberIds.map((memberId) => ({ memberId, amount: parseMoney(body[`split_${memberId}`]) }));
    let normalizedSplits = splits;
    const splitTotal = splits.reduce((total, split) => total + split.amount, 0);
    if (splitTotal !== amount) normalizedSplits = splitEvenly(amount, memberIds);
    const paidByMemberId = validMemberId(body.paidByMemberId, memberIds);
    if (!paidByMemberId) throw new BadRequestException('Cần chọn người trả tiền hợp lệ');
    const positiveSplits = normalizedSplits.filter((item) => item.amount > 0);
    await this.prisma.$transaction([
      this.prisma.travelTripExpense.update({
        where: { id: expenseId, tripId },
        data: {
          spentDate: parseDate(body.spentDate),
          title,
          amount,
          note: clean(body.note),
          paidByMemberId,
          splitMode: positiveSplits.length === 1 && positiveSplits[0].amount === amount ? 'PRIVATE' : 'SHARED',
          privateMemberId: positiveSplits.length === 1 && positiveSplits[0].amount === amount ? positiveSplits[0].memberId : null,
        },
      }),
      this.prisma.travelTripExpenseSplit.deleteMany({ where: { expenseId } }),
      this.prisma.travelTripExpenseSplit.createMany({ data: normalizedSplits.map((split) => ({ expenseId, ...split })) }),
    ]);
  }

  deleteExpense(tripId: bigint, expenseId: bigint) {
    return this.prisma.travelTripExpense.delete({ where: { id: expenseId, tripId } });
  }

  private activeMembers(tripId: bigint) {
    return this.prisma.travelTripMember.findMany({ where: { tripId, active: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  private async rebalanceSharedExpenses(tripId: bigint) {
    const members = await this.activeMembers(tripId);
    const memberIds = members.map((member) => member.id);
    if (!memberIds.length) return;
    const expenses = await this.prisma.travelTripExpense.findMany({ where: { tripId, splitMode: 'SHARED' } });
    for (const expense of expenses) {
      const splits = splitEvenly(parseMoney(expense.amount), memberIds);
      await this.prisma.$transaction([
        this.prisma.travelTripExpenseSplit.deleteMany({ where: { expenseId: expense.id } }),
        this.prisma.travelTripExpenseSplit.createMany({ data: splits.map((split) => ({ expenseId: expense.id, ...split })) }),
      ]);
    }
  }

  private async syncTreasurerCollection(tripId: bigint, treasurerMemberId: bigint) {
    const summary = await this.summary(tripId, treasurerMemberId);
    await this.prisma.travelTripCollection.upsert({
      where: { tripId_memberId: { tripId, memberId: treasurerMemberId } },
      update: { amount: summary.memberSpent.get(treasurerMemberId.toString()) || 0 },
      create: { tripId, memberId: treasurerMemberId, amount: summary.memberSpent.get(treasurerMemberId.toString()) || 0 },
    });
  }
}

export const travelExpenseCategories = TRAVEL_EXPENSE_CATEGORIES;

function parseDate(value: string | undefined) {
  return value ? new Date(`${value}T00:00:00`) : new Date();
}

function validMemberId(value: string | undefined, memberIds: bigint[]) {
  if (!value) return null;
  const memberId = BigInt(value);
  return memberIds.some((id) => id === memberId) ? memberId : null;
}
