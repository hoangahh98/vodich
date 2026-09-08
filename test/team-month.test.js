const assert = require('node:assert/strict');
const test = require('node:test');

const { TeamMonthService } = require('../dist/teams/team-month.service');
const { TeamMemberService } = require('../dist/teams/team-member.service');
const { TeamDetailService } = require('../dist/teams/team-detail.service');

/**
 * Quỹ đội bóng theo tháng (9/2026). Hai câu hỏi thật của chủ app:
 * 1. Tháng đã chia xong có người vào, tháng sau đổi họ thành cố định — tool có tự chia lại không?
 * 2. Một người rời đội — tháng cũ có giữ nguyên không, tháng mới có chia đều cho người còn lại không?
 */

const M7 = new Date('2026-07-01T00:00:00Z');
const M8 = new Date('2026-08-01T00:00:00Z');

test('recompute AUTO: chia đều theo số cố định của ảnh chụp tháng, chỉ sửa dòng CHƯA đóng', async () => {
  const updates = [];
  const prisma = {
    teamMonthFund: {
      findUnique: async () => ({ id: 1n, teamId: 1n, fundMonth: M8, feeMode: 'AUTO', monthlyFee: 300000, courtCost: 900000, otherCost: 100000, previousBalance: 200000 }),
      update: async (args) => updates.push(args),
      findFirst: async () => null,
    },
    teamMemberPayment: {
      count: async ({ where }) => {
        assert.equal(where.memberType, 'FIXED');
        assert.deepEqual(where.fundMonth, M8);
        return 4; // 4 cố định tháng 8
      },
      updateMany: async (args) => updates.push(args),
    },
  };
  const fee = await new TeamMonthService(prisma, {}).recompute(1n, M8);
  assert.equal(fee, 200000, '(900k + 100k − 200k) / 4');
  assert.equal(updates[0].data.monthlyFee, 200000, 'mức phí tháng ghi lại');
  assert.deepEqual(updates[1].where.paymentStatus, { not: 'PAID' }, 'người đã đóng giữ nguyên số đã thu');
  assert.equal(updates[1].data.paidAmount, 200000);
});

test('recompute MANUAL: không đổi mức phí admin gõ', async () => {
  let touchedFund = false;
  const prisma = {
    teamMonthFund: { findUnique: async () => ({ id: 1n, feeMode: 'MANUAL', monthlyFee: 150000, courtCost: 1, otherCost: 1, previousBalance: 0 }), update: async () => (touchedFund = true), findFirst: async () => null },
    teamMemberPayment: { count: async () => 99, updateMany: async () => undefined },
  };
  assert.equal(await new TeamMonthService(prisma, {}).recompute(1n, M8), 150000);
  assert.equal(touchedFund, false);
});

test('recompute lan sang tháng sau AUTO: số dư mang sang đổi thì phí tháng sau tính lại', async () => {
  const calls = [];
  const funds = { [M7.toISOString()]: { id: 7n, fundMonth: M7, feeMode: 'AUTO', monthlyFee: 0, courtCost: 400000, otherCost: 0, previousBalance: 0 }, [M8.toISOString()]: { id: 8n, fundMonth: M8, feeMode: 'AUTO', monthlyFee: 0, courtCost: 400000, otherCost: 0, previousBalance: 999 } };
  const prisma = {
    teamMonthFund: {
      findUnique: async ({ where }) => funds[where.teamId_fundMonth.fundMonth.toISOString()],
      update: async (args) => {
        calls.push(args);
        Object.values(funds).find((fund) => fund.id === args.where.id) && Object.assign(Object.values(funds).find((fund) => fund.id === args.where.id), args.data);
      },
      findFirst: async ({ where }) => (where.fundMonth.gt.toISOString() === M7.toISOString() ? funds[M8.toISOString()] : null),
    },
    teamMemberPayment: { count: async () => 2, updateMany: async () => undefined },
  };
  const detail = { previousMonthBalance: async () => 50000 };
  await new TeamMonthService(prisma, detail).recompute(1n, M7);
  const nextBalance = calls.find((c) => c.where.id === 8n && c.data.previousBalance !== undefined);
  assert.equal(nextBalance.data.previousBalance, 50000, 'tháng 8 nhận số dư mới của tháng 7');
  const nextFee = calls.find((c) => c.where.id === 8n && c.data.monthlyFee !== undefined);
  assert.equal(nextFee.data.monthlyFee, 175000, '(400k − 50k) / 2 làm tròn lên nghìn');
});

test('rời đội từ tháng 8: tháng 7 giữ nguyên, tháng 8 trở đi chỉ bỏ dòng chưa đóng, rồi chia lại', async () => {
  const deleted = [];
  const recomputed = [];
  const prisma = {
    teamMember: { findFirst: async () => ({ playerId: 5n }), updateMany: async () => ({ count: 1 }) },
    teamMemberPayment: { deleteMany: async (args) => deleted.push(args.where) },
    playerTeamAccess: { deleteMany: async () => undefined },
  };
  const months = { recompute: async (teamId, fundMonth) => recomputed.push(fundMonth.toISOString()) };
  await new TeamMemberService(prisma, months).removeMember(1n, 10n, '2026-08');
  assert.deepEqual(deleted[0].fundMonth, { gte: M8 }, 'không đụng tháng trước tháng 8');
  assert.deepEqual(deleted[0].paymentStatus, { not: 'PAID' }, 'tiền đã đóng thì giữ');
  assert.deepEqual(recomputed, [M8.toISOString()], 'phí tháng 8 tự chia lại cho người còn lại');
});

test('thêm người vào tháng: chụp loại vào tháng đó rồi chốt tháng để chia lại phí', async () => {
  const log = [];
  const prisma = {
    teamMember: { upsert: async () => ({ id: 10n }) },
    playerTeamAccess: { createMany: async () => undefined },
  };
  const months = {
    snapshotMemberType: async (memberId, month, type) => log.push(`snap:${memberId}:${month}:${type}`),
    ensureMonth: async (teamId, month) => log.push(`ensure:${teamId}:${month}`),
  };
  await new TeamMemberService(prisma, months).addMember(1n, 5n, 'GUEST', '', '2026-08');
  assert.deepEqual(log, ['snap:10:2026-08:GUEST', 'ensure:1:2026-08']);
});

test('số dư mang sang đếm cố định theo ẢNH CHỤP tháng trước, kể cả người đã rời đội', async () => {
  const prisma = {
    teamMonthFund: { findUnique: async () => ({ monthlyFee: 100000, courtCost: 250000, previousBalance: 0 }) },
    teamMemberPayment: {
      findMany: async () => [
        { memberType: 'FIXED', paymentStatus: 'PAID', paidAmount: 100000, member: { memberType: 'FIXED' } },
        { memberType: 'FIXED', paymentStatus: 'PAID', paidAmount: 100000, member: { memberType: 'FIXED', active: false } }, // đã rời đội sau đó
        { memberType: null, paymentStatus: 'UNPAID', paidAmount: 100000, member: { memberType: 'FIXED' } }, // dòng cũ chưa chụp loại
        { memberType: 'GUEST', paymentStatus: 'PAID', paidAmount: 30000, member: { memberType: 'FIXED' } }, // tháng trước là vãng lai
      ],
    },
    teamExpense: { findMany: async () => [{ amount: 20000 }] },
  };
  const balance = await new TeamDetailService(prisma).previousMonthBalance(1n, M8);
  // phải đóng 3 × 100k + vãng lai 30k − sân 250k − chi 20k
  assert.equal(balance, 60000);
});

test('monthRoster: người có dòng phí tháng đó hiện theo loại đã chụp; người mới không dòng hiện theo loại hiện tại', async () => {
  const prisma = {
    teamMemberPayment: {
      findMany: async () => [{ id: 1n, memberType: 'GUEST', paidAmount: 50000, paymentStatus: 'PAID', member: { id: 10n, memberType: 'FIXED', active: false, player: { displayName: 'Đã rời' } } }],
    },
    teamMember: { findMany: async () => [{ id: 11n, memberType: 'FIXED', active: true, player: { displayName: 'Mới' } }] },
  };
  const roster = await new TeamDetailService(prisma).monthRoster(1n, M7);
  assert.equal(roster.length, 2);
  assert.equal(roster[0].memberType, 'GUEST', 'tháng 7 người này là vãng lai dù giờ cột hiện tại là cố định');
  assert.equal(roster[0].payments[0].paidAmount, 50000);
  assert.equal(roster[1].memberType, 'FIXED');
  assert.deepEqual(roster[1].payments, []);
});
