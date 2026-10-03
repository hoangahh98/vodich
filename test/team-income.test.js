const assert = require('node:assert/strict');
const test = require('node:test');

const { GroupService } = require('../dist/groups/group.service');
const { TeamFundService } = require('../dist/teams/team-fund.service');
const { TeamMonthReportBuilder } = require('../dist/teams/team-month-report');
const { TeamDetailService } = require('../dist/teams/team-detail.service');

const BOB = { id: '20', email: 'bob', displayName: 'Bob', role: 'ADMIN' };
const M8 = new Date('2026-08-01T00:00:00Z');

/** Thành viên đội đi theo nhóm; vãng lai ghi theo buổi. */

test('đưa người ra khỏi nhóm: rời các đội liên kết, trừ đội mà họ còn ở nhóm khác', async () => {
  const removed = [];
  const prisma = {
    playerGroupMember: {
      deleteMany: async () => ({ count: 1 }),
      // Người 5 còn ở nhóm khác đang liên kết với đội 100, không có với đội 200.
      findMany: async ({ where }) => (where.group.teams.some.teamId === 100n ? [{ playerId: 5n }] : []),
    },
    teamClubGroup: { findMany: async () => [{ teamId: 100n }, { teamId: 200n }] },
  };
  const teamMembers = { removePlayer: async (teamId, playerId, month) => removed.push(`${teamId}:${playerId}:${month}`) };
  await new GroupService(prisma, teamMembers).removeMember(BOB, 9n, 5n, '2026-08');
  assert.deepEqual(removed, ['200:5:2026-08'], 'đội 100 giữ vì còn nhóm khác; đội 200 thì rời từ tháng 8');
});

test('gỡ nhóm khỏi đội: người chỉ thuộc nhóm đó rời đội rồi mới bỏ liên kết', async () => {
  const log = [];
  const prisma = {
    playerGroupMember: {
      findMany: async ({ where }) => (where.groupId === 9n ? [{ playerId: 1n }, { playerId: 2n }] : [{ playerId: 2n }]),
    },
    teamClubGroup: { deleteMany: async (args) => log.push(`unlink:${args.where.teamId}:${args.where.groupId}`) },
  };
  const teamMembers = { removePlayer: async (teamId, playerId) => log.push(`leave:${teamId}:${playerId}`) };
  await new GroupService(prisma, teamMembers).detachTeamFromGroup(100n, 9n, '2026-08');
  assert.deepEqual(log, ['leave:100:1', 'unlink:100:9'], 'người 2 còn nhóm khác nên ở lại');
});

test('khoản thu vãng lai: cần người hoặc tên và tiền > 0; ghi xong thì chốt tháng để lan số dư', async () => {
  const created = [];
  const ensured = [];
  const prisma = {
    teamGuestReceipt: { create: async ({ data }) => created.push(data) },
    player: { findFirst: async ({ where }) => (where.displayName.equals.toLowerCase() === 'nguyễn văn an' ? { id: 7n } : null) },
  };
  const service = new TeamFundService({}, prisma, { ensureMonth: async (teamId, month) => ensured.push(month) });
  await assert.rejects(() => service.addGuestReceipt(1n, '2026-08', { amount: '0', guest: 'Khách' }), /lớn hơn 0/);
  await assert.rejects(() => service.addGuestReceipt(1n, '2026-08', { amount: '50,000' }), /gõ tên/);

  // Gõ trùng tên thành viên (không phân biệt hoa thường) thì gắn vào người đó.
  await service.addGuestReceipt(1n, '2026-08', { amount: '50,000', guest: 'nguyễn văn AN', receiptDate: '2026-08-12' });
  assert.equal(created[0].playerId, 7n);
  assert.equal(created[0].guestName, null);
  assert.equal(created[0].amount, 50000);
  assert.equal(created[0].receiptDate.toISOString(), '2026-08-12T00:00:00.000Z');
  assert.deepEqual(created[0].receiptMonth, M8);
  assert.deepEqual(ensured, ['2026-08']);

  // Tên lạ thì lưu làm khách.
  await service.addGuestReceipt(1n, '2026-08', { amount: '40,000', guest: 'Bạn của An' });
  assert.equal(created[1].playerId, null);
  assert.equal(created[1].guestName, 'Bạn của An');
});

test('nút "Tất cả đã đóng": nâng mọi ô lên đủ mức phí, ai đóng hơn thì giữ, chốt tháng trước để có phí', async () => {
  const writes = [];
  const ensured = [];
  const prisma = {
    teamMonthFund: { findUnique: async () => ({ monthlyFee: 200000 }) },
    teamMember: { findMany: async () => [{ id: 1n }, { id: 2n }, { id: 3n }] },
    teamMemberPayment: { upsert: (payload) => payload },
    $transaction: async (items) => { writes.push(...items); return items; },
  };
  const service = new TeamFundService({}, prisma, { ensureMonth: async (teamId, month) => ensured.push(month) });
  await service.updatePayments(1n, '2026-08', { markAllPaid: '1', amount_1: '', amount_2: '250,000', amount_3: '50,000' });
  const byId = Object.fromEntries(writes.map((w) => [w.where.memberId_fundMonth.memberId.toString(), w.update]));
  assert.equal(byId['1'].paidAmount, 200000);
  assert.equal(byId['1'].paymentStatus, 'PAID');
  assert.equal(byId['2'].paidAmount, 250000);
  assert.equal(byId['3'].paidAmount, 200000);
  // ensureMonth chạy cả trước (lấy phí) lẫn sau (lan số dư).
  assert.deepEqual(ensured, ['2026-08', '2026-08']);

  // Không bấm nút đó thì ghi đúng số gõ.
  writes.length = 0;
  await service.updatePayments(1n, '2026-08', { amount_3: '50,000' });
  assert.equal(writes[0].update.paidAmount, 50000);
  assert.equal(writes[0].update.paymentStatus, 'UNPAID');
});

/**
 * Ca thật 3/10/2026: "diu" đã đóng tháng 10 nên lúc rời nhóm dòng được giữ; admin hoàn tiền và sửa về 0đ,
 * dòng 0đ nằm lại khiến diu vẫn bị đếm vào số người chia phí. Người đã rời mà về 0đ ở tháng rời (hoặc
 * sau) thì phải bỏ hẳn khỏi tháng; tháng trước tháng rời thì giữ (nợ cũ thật); người đang ở đội thì giữ.
 */
test('lưu khoản thu: người đã rời bị sửa về 0đ ở tháng rời thì bỏ khỏi tháng, nợ cũ và người đang ở đội thì giữ', async () => {
  const writes = [];
  const deleted = [];
  const ensured = [];
  const M9 = new Date('2026-09-01T00:00:00Z');
  const members = [
    { id: 1n, active: true, leftMonth: null },
    { id: 2n, active: false, leftMonth: M8 }, // rời từ tháng 8, hoàn tiền về 0
    { id: 3n, active: false, leftMonth: M9 }, // rời từ tháng 9 → tháng 8 là nợ cũ
    { id: 4n, active: false, leftMonth: M8 }, // rời tháng 8 nhưng vẫn còn tiền đã đóng
  ];
  const prisma = {
    teamMonthFund: { findUnique: async () => ({ monthlyFee: 200000 }) },
    teamMember: { findMany: async () => members },
    teamMemberPayment: { upsert: (payload) => payload, deleteMany: async (args) => deleted.push(args.where) },
    $transaction: async (items) => { writes.push(...items); return items; },
  };
  const service = new TeamFundService({}, prisma, { ensureMonth: async (teamId, month) => ensured.push(month) });
  await service.updatePayments(1n, '2026-08', { amount_1: '0', amount_2: '0', amount_3: '', amount_4: '100,000' });
  const written = writes.map((w) => w.where.memberId_fundMonth.memberId.toString()).sort();
  assert.deepEqual(written, ['1', '3', '4']);
  assert.equal(deleted.length, 1);
  assert.deepEqual(deleted[0], { fundMonth: M8, memberId: { in: [2n] } });
  assert.deepEqual(ensured, ['2026-08'], 'chốt lại tháng để phí chia cho người còn lại');
});

test('báo cáo tháng cộng khoản thu vãng lai vào tiền vãng lai, tổng thu và tổng quỹ', () => {
  const report = new TeamMonthReportBuilder().build({
    members: [],
    players: [],
    fund: { monthlyFee: 100, courtCost: 30, otherCost: 0, previousBalance: 20 },
    expenses: [],
    previousMonthBalance: 0,
    guestReceipts: [{ amount: 50 }, { amount: '25' }],
  });
  assert.equal(report.finance.guestPaid, 75);
  assert.equal(report.finance.totalPaid, 75);
  assert.equal(report.finance.totalFund, 95, 'phải đóng 0 + dư 20 + vãng lai 75');
});

test('số dư mang sang tháng sau cộng cả khoản thu vãng lai của tháng trước', async () => {
  const prisma = {
    teamMonthFund: { findUnique: async () => ({ monthlyFee: 100000, courtCost: 100000, previousBalance: 0 }) },
    teamMemberPayment: { findMany: async () => [{ memberType: 'FIXED', paymentStatus: 'PAID', paidAmount: 100000, member: {} }] },
    teamExpense: { findMany: async () => [] },
    teamGuestReceipt: { findMany: async () => [{ amount: 40000 }] },
  };
  assert.equal(await new TeamDetailService(prisma).previousMonthBalance(1n, M8), 40000, '100k phải đóng + 40k vãng lai − 100k sân');
});

/** Ca thật 3/10/2026: sửa khoản chi tháng 9 cho hết −13k mà dư đầu tháng 10 vẫn −13k vì khoản chi không chốt lại tháng. */
test('khoản chi: thêm thì chốt tháng, xoá thì tính lại đúng tháng của khoản đó → số dư lan sang tháng sau', async () => {
  const { TeamExpenseService } = require('../dist/teams/team-expense.service');
  const log = [];
  const M9 = new Date('2026-09-01T00:00:00Z');
  const prisma = {
    teamExpense: {
      create: async () => ({ id: 1n }),
      findFirst: async () => ({ expenseMonth: M9 }),
      deleteMany: async () => ({ count: 1 }),
    },
  };
  const months = {
    ensureMonth: async (teamId, month) => log.push(`ensure:${teamId}:${month}`),
    recompute: async (teamId, fundMonth) => log.push(`recompute:${teamId}:${fundMonth.toISOString().slice(0, 7)}`),
  };
  const service = new TeamExpenseService(prisma, months);
  await service.addExpense(10n, '2026-09', '2026-09-27', 'tien Giai mini va nuoc', '995,000');
  await service.deleteExpense(10n, 39n);
  assert.deepEqual(log, ['ensure:10:2026-09', 'recompute:10:2026-09']);
});
