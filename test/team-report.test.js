const assert = require('node:assert/strict');
const test = require('node:test');

const { TeamReportService, aggregateTeamReports, normalizeReportMonth } = require('../dist/teams/team-report.service');

/**
 * Báo cáo tháng gộp nhiều đội (chủ app 28/9/2026): admin quản lý 3 đội, có người chơi ở 2–3 đội, trước
 * đây phải mở từng đội cộng tay. Lời hứa: số từng đội lấy đúng ảnh chụp tháng của trang chi tiết; phần
 * gộp theo người nhặt đủ mọi đội một người có mặt — và CHỈ thành viên cố định (chủ app: bảng này check
 * tổng tiền phải đóng của cố định, vãng lai không ghi vào đây).
 */

const player = (id, name) => ({ displayName: name, email: `${name.toLowerCase()}@test` });
const member = (playerId, name, memberType, expectedAmount, paidAmount) => ({
  playerId: BigInt(playerId),
  memberType,
  typeLabel: memberType === 'FIXED' ? 'Cố định' : 'Vãng lai',
  expectedAmount,
  paidAmount,
  paymentStatus: paidAmount > 0 && paidAmount >= expectedAmount ? 'PAID' : 'UNPAID',
  player: player(playerId, name),
});
const finance = (over) => ({ memberCount: 0, fixedCount: 0, monthlyFee: 0, totalDue: 0, totalPaid: 0, totalMissing: 0, guestPaid: 0, totalSpent: 0, balance: 0, ...over });

const snapshots = [
  {
    team: { id: 1n, name: 'Tối thứ 3' },
    members: [member(5, 'An', 'FIXED', 200000, 200000), member(6, 'Bình', 'FIXED', 200000, 0)],
    finance: finance({ memberCount: 2, fixedCount: 2, monthlyFee: 200000, totalDue: 400000, totalPaid: 200000, totalMissing: 200000, totalSpent: 300000, balance: 100000 }),
    fundPreview: false,
  },
  {
    team: { id: 2n, name: 'Sáng chủ nhật' },
    // Cường là vãng lai ở đội 2 — không được xuất hiện trong báo cáo.
    members: [member(5, 'An', 'FIXED', 150000, 100000), member(7, 'Cường', 'GUEST', 0, 50000)],
    finance: finance({ memberCount: 2, fixedCount: 1, monthlyFee: 150000, totalDue: 150000, totalPaid: 230000, totalMissing: 50000, guestPaid: 130000, totalSpent: 100000, balance: 180000 }),
    fundPreview: true,
  },
];

test('gộp theo người: An cố định ở 2 đội thấy đủ cả hai trên một dòng, cộng đúng mức phí / đã đóng / còn thiếu', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  const an = report.people.find((row) => row.name === 'An');
  assert.equal(an.teamCount, 2);
  assert.equal(an.multi, true);
  assert.deepEqual(an.teams.map((item) => [item.teamName, item.expectedAmount]), [['Sáng chủ nhật', 150000], ['Tối thứ 3', 200000]], 'mỗi đội một mức phí, sắp theo tên đội');
  assert.equal(an.totalExpected, 350000, '200k + 150k');
  assert.equal(an.totalPaid, 300000);
  assert.equal(an.totalMissing, 50000, 'chỉ thiếu 50k ở đội 2; đội 1 đóng đủ không bù trừ');
});

test('vãng lai KHÔNG vào báo cáo; người nhiều đội lên đầu', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  assert.deepEqual(report.people.map((row) => row.name), ['An', 'Bình'], 'Cường vãng lai không có dòng');
  assert.equal(report.totals.peopleCount, 2);
  assert.equal(report.totals.multiTeamCount, 1);
});

test('tổng theo đội lấy đúng số của từng ảnh chụp, không tính lại', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  assert.deepEqual(report.teams.map((team) => [team.name, team.fixedCount, team.monthlyFee, team.totalDue, team.fundPreview]), [
    ['Tối thứ 3', 2, 200000, 400000, false],
    ['Sáng chủ nhật', 1, 150000, 150000, true],
  ]);
  assert.equal(report.totals.totalDue, 550000);
});

test('tháng rác thì về tháng hiện tại; service lấy đội theo đúng phạm vi list(user)', async () => {
  assert.equal(normalizeReportMonth('2026-09'), '2026-09');
  assert.equal(normalizeReportMonth('abc'), new Date().toISOString().slice(0, 7));
  assert.equal(normalizeReportMonth(undefined), new Date().toISOString().slice(0, 7));
  const asked = [];
  const crud = { list: async (user) => { asked.push(user.id); return [{ id: 1n, name: 'A' }, { id: 2n, name: 'B' }]; } };
  const detail = { monthSnapshot: async (id, month) => ({ ...snapshots[Number(id) - 1], team: { id, name: `Đội ${id}` }, _month: month }) };
  const report = await new TeamReportService(crud, detail).monthlyReport({ id: '9', role: 'ADMIN' }, '2026-09');
  assert.deepEqual(asked, ['9'], 'phạm vi đội lấy từ list(user), không tự truy vấn riêng');
  assert.equal(report.totals.teamCount, 2);
});
