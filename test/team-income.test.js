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
