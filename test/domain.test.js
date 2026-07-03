const assert = require('node:assert/strict');
const test = require('node:test');

const { TournamentRankingCalculator } = require('../dist/tournaments/tournament-ranking');
const { TournamentScheduleBuilder } = require('../dist/tournaments/tournament-schedule');
const { TeamMonthReportBuilder } = require('../dist/teams/team-month-report');

test('TournamentRankingCalculator ranks finished matches and keeps pending matches out of totals', () => {
  const calculator = new TournamentRankingCalculator();
  const rankings = calculator.rankings([
    { groupName: 'A', teamA: 'Alpha', teamB: 'Beta', scoreA: 11, scoreB: 5, status: 'FINISHED' },
    { groupName: 'A', teamA: 'Gamma', teamB: 'Alpha', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    { groupName: 'B', teamA: 'Delta', teamB: 'Echo', scoreA: 0, scoreB: 0, status: 'PENDING' },
  ]);

  assert.equal(rankings.length, 2);
  assert.deepEqual(
    rankings[0].rows.map((row) => row.teamName),
    ['Alpha', 'Gamma', 'Beta'],
  );
  assert.equal(rankings[1].rows[0].played, 0);
});

test('TournamentRankingCalculator builds group boards with all teams in each group', () => {
  const calculator = new TournamentRankingCalculator();
  const boards = calculator.groupBoards([
    { groupName: 'A', teamA: 'Alpha', teamB: 'Beta' },
    { groupName: 'A', teamA: 'Alpha', teamB: 'Gamma' },
    { groupName: 'B', teamA: 'Delta', teamB: 'Echo' },
  ]);

  assert.deepEqual(boards, [
    { groupName: 'A', teams: ['Alpha', 'Beta', 'Gamma'] },
    { groupName: 'B', teams: ['Delta', 'Echo'] },
  ]);
});

test('TournamentScheduleBuilder creates group and knockout matches for group knockout tournaments', () => {
  const builder = new TournamentScheduleBuilder();
  const tournament = {
    id: 1n,
    format: 'GROUP_KNOCKOUT',
    playType: 'SINGLES',
    courtCount: 2,
    knockoutQualifierCount: 4,
  };
  const registrations = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((displayName, index) => ({
    id: BigInt(index + 1),
    externalName: null,
    externalEmail: null,
    player: { displayName },
  }));

  const matches = builder.fromRegistrations(tournament, registrations);

  assert.equal(matches.filter((match) => match.stage === 'Vòng bảng').length, 12);
  assert.equal(matches.filter((match) => match.stage === 'Bán kết').length, 2);
  assert.equal(matches.filter((match) => match.stage === 'Chung kết').length, 1);
});

test('TeamMonthReportBuilder calculates finance summary and fixed member ordering', () => {
  const builder = new TeamMonthReportBuilder();
  const fixedPaid = {
    id: 1n,
    teamId: 1n,
    playerId: 1n,
    memberType: 'FIXED',
    active: true,
    notes: null,
    createdAt: new Date(),
    player: { id: 1n, displayName: 'An', email: 'an@example.com' },
    payments: [{ paidAmount: 100, paymentStatus: 'PAID', notes: '' }],
  };
  const fixedUnpaid = {
    ...fixedPaid,
    id: 2n,
    playerId: 2n,
    player: { id: 2n, displayName: 'Binh', email: 'binh@example.com' },
    payments: [{ paidAmount: 100, paymentStatus: 'UNPAID', notes: '' }],
  };
  const guest = {
    ...fixedPaid,
    id: 3n,
    playerId: 3n,
    memberType: 'GUEST',
    player: { id: 3n, displayName: 'Cuong', email: null },
    payments: [{ paidAmount: 50, paymentStatus: 'PAID', notes: '' }],
  };

  const report = builder.build({
    members: [guest, fixedUnpaid, fixedPaid],
    players: [fixedPaid.player, fixedUnpaid.player, guest.player, { id: 4n, displayName: 'Dung', email: 'dung@example.com' }],
    fund: { monthlyFee: 100, courtCost: 30, previousBalance: 20 },
    expenses: [{ amount: 10 }],
    previousMonthBalance: 7,
  });

  assert.deepEqual(
    report.members.map((member) => member.player.displayName),
    ['An', 'Binh', 'Cuong'],
  );
  assert.equal(report.finance.fixedUnpaidCount, 1);
  assert.equal(report.finance.totalMissing, 100);
  assert.equal(report.finance.balance, 130);
  assert.deepEqual(
    report.players.map((player) => player.displayName),
    ['Dung'],
  );
});
