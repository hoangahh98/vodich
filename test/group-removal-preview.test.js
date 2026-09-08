const assert = require('node:assert/strict');
const test = require('node:test');

const { GroupService } = require('../dist/groups/group.service');

const BOB = { id: '20', email: 'bob', displayName: 'Bob', role: 'ADMIN' };
const d = (iso) => new Date(`${iso}T00:00:00Z`);

/** Trang soi trước khi đưa người ra khỏi nhóm: phải nói đúng đội nào rời, còn thiếu bao nhiêu, nợ tháng nào. */
test('removalPreview: liệt kê đội sẽ rời / ở lại, tiền tháng này, nợ tháng cũ và giải chưa đóng', async () => {
  const prisma = {
    playerGroup: { findFirst: async ({ where }) => (where.ownerAdminId === 20n ? { id: 9n, name: 'Hội tối thứ 3' } : null) },
    player: { findUnique: async () => ({ id: 5n, displayName: 'An', email: 'an@test' }) },
    teamClubGroup: { findMany: async () => [{ teamId: 100n, team: { id: 100n, name: 'Đội A' } }, { teamId: 200n, team: { id: 200n, name: 'Đội B' } }] },
    teamMember: {
      findFirst: async ({ where }) =>
        where.teamId === 100n
          ? {
              id: 1n,
              memberType: 'FIXED',
              payments: [
                { fundMonth: d('2026-07-01'), memberType: 'FIXED', paidAmount: 100000 },
                { fundMonth: d('2026-08-01'), memberType: 'FIXED', paidAmount: 150000 },
                { fundMonth: d('2026-09-01'), memberType: 'FIXED', paidAmount: 50000 },
              ],
            }
          : null, // không có trong đội B
    },
    playerGroupMember: { findMany: async ({ where }) => (where.group.teams.some.teamId === 100n ? [] : [{ group: { name: 'Nhóm khác' } }]) },
    teamMonthFund: {
      findMany: async () => [
        { fundMonth: d('2026-07-01'), monthlyFee: 100000 },
        { fundMonth: d('2026-08-01'), monthlyFee: 200000 },
        { fundMonth: d('2026-09-01'), monthlyFee: 200000 },
      ],
    },
    tournamentRegistration: { findMany: async () => [{ tournamentId: 7n, paidAmount: 150000, tournament: { id: 7n, name: 'Cúp thu' } }] },
  };
  const preview = await new GroupService(prisma, {}).removalPreview(BOB, 9n, 5n, '2026-09');

  assert.equal(preview.month, '2026-09');
  const teamA = preview.teams.find((item) => item.team.name === 'Đội A');
  assert.equal(teamA.isMember, true);
  assert.equal(teamA.willLeave, true, 'không còn nhóm khác gắn với đội A');
  assert.deepEqual(teamA.current, { paid: 50000, expected: 200000, shortfall: 150000 });
  assert.deepEqual(teamA.debts, [{ month: '2026-08', shortfall: 50000 }], 'tháng 7 đủ, tháng 8 thiếu 50k, tháng 9 là tháng hiện tại không tính vào nợ cũ');
  assert.equal(teamA.totalPaid, 300000);

  const teamB = preview.teams.find((item) => item.team.name === 'Đội B');
  assert.equal(teamB.isMember, false, 'nhóm gắn đội B nhưng người này không có trong đội B');
  assert.equal(teamB.willLeave, false);

  assert.deepEqual(preview.unpaidTournaments, [{ tournamentId: 7n, name: 'Cúp thu', amount: 150000 }]);
  assert.equal(preview.hasWarnings, true);
});

test('removalPreview: nhóm ngoài phạm vi admin phụ thì không soi được', async () => {
  const prisma = { playerGroup: { findFirst: async () => null }, player: { findUnique: async () => ({ id: 5n }) } };
  assert.equal(await new GroupService(prisma, {}).removalPreview(BOB, 9n, 5n, '2026-09'), null);
});
