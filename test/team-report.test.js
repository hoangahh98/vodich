const assert = require('node:assert/strict');
const test = require('node:test');

const { TeamReportService, aggregateTeamReports, normalizeReportMonth } = require('../dist/teams/team-report.service');

/**
 * Báo cáo tháng gộp nhiều đội (chủ app 28/9/2026): admin quản lý 3 đội, có người chơi ở 2–3 đội, trước
 * đây phải mở từng đội cộng tay. Lời hứa: số từng đội lấy đúng ảnh chụp tháng của trang chi tiết, còn
 * phần gộp theo người phải nhặt đủ mọi đội một người có mặt — kể cả vãng lai ghi theo buổi.
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
    guestReceipts: [],
  },
  {
    team: { id: 2n, name: 'Sáng chủ nhật' },
    members: [member(5, 'An', 'FIXED', 150000, 100000), member(7, 'Cường', 'GUEST', 0, 50000)],
    // An còn ghé đội thứ 3 với tư cách vãng lai theo buổi; một khách không có hồ sơ.
    finance: finance({ memberCount: 2, fixedCount: 1, monthlyFee: 150000, totalDue: 150000, totalPaid: 230000, totalMissing: 50000, guestPaid: 130000, totalSpent: 100000, balance: 180000 }),
    fundPreview: true,
    guestReceipts: [{ playerId: 5n, guestName: null, amount: 40000, player: player(5, 'An') }, { playerId: null, guestName: 'Khách Dũng', amount: 40000, player: null }],
  },
];

test('gộp theo người: An ở 2 đội thấy đủ cả hai trên một dòng, cộng đúng phải đóng / đã đóng / còn thiếu', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  const an = report.people.find((row) => row.name === 'An');
  assert.equal(an.teamCount, 2);
  assert.equal(an.multi, true);
  assert.deepEqual(an.teams.map((item) => item.teamName), ['Sáng chủ nhật', 'Tối thứ 3'], 'đội sắp theo tên');
  assert.equal(an.totalExpected, 350000, '200k + 150k');
  assert.equal(an.totalPaid, 340000, '200k + 100k + 40k vãng lai theo buổi ở đội 2');
  assert.equal(an.totalMissing, 50000, 'chỉ thiếu 50k ở đội 2; đội 1 đóng đủ không bù trừ');
  const doi2 = an.teams.find((item) => item.teamName === 'Sáng chủ nhật');
  assert.equal(doi2.sessions, 1, 'buổi vãng lai gộp vào đúng người, không thành dòng khách lạ');
  assert.equal(doi2.guestAmount, 40000, 'tiền buổi tách riêng khỏi phí');
  assert.equal(doi2.paidAmount, 100000, 'phí đã đóng giữ nguyên 100k để so với mức phí y như trang đội');
  assert.equal(doi2.memberType, 'FIXED', 'đã là cố định thì buổi vãng lai không hạ xuống vãng lai');
});

test('người nhiều đội lên đầu; khách không có hồ sơ đứng riêng theo tên', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  assert.equal(report.people[0].name, 'An', 'người 2 đội lên đầu');
  assert.deepEqual(report.people.slice(1).map((row) => row.name), ['Bình', 'Cường', 'Khách Dũng'], 'còn lại: thiếu nhiều trước, rồi theo tên');
  const guest = report.people.find((row) => row.name === 'Khách Dũng');
  assert.equal(guest.teams[0].sessions, 1);
  assert.equal(guest.teams[0].guestAmount, 40000, 'tiền buổi nằm ở cột riêng');
  assert.equal(guest.teams[0].paidAmount, 0, 'không phải phí cố định');
  assert.equal(guest.totalPaid, 40000);
  assert.equal(guest.teams[0].paymentStatus, 'PAID', 'vãng lai có tiền là đã thu');
});

test('tổng theo đội và tổng chung lấy đúng số của từng ảnh chụp, không tính lại', () => {
  const report = aggregateTeamReports('2026-09', snapshots);
  assert.deepEqual(report.teams.map((team) => [team.name, team.totalPaid, team.balance, team.fundPreview]), [
    ['Tối thứ 3', 200000, 100000, false],
    ['Sáng chủ nhật', 230000, 180000, true],
  ]);
  assert.deepEqual(report.totals, {
    teamCount: 2,
    peopleCount: 4,
    multiTeamCount: 1,
    totalDue: 550000,
    totalPaid: 430000,
    totalMissing: 250000,
    guestPaid: 130000,
    totalSpent: 400000,
    balance: 280000,
  });
  assert.equal(report.previousMonth, '2026-08');
  assert.equal(report.nextMonth, '2026-10');
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
