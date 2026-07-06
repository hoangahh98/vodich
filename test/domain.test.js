const assert = require('node:assert/strict');
const test = require('node:test');

const { TournamentRankingCalculator } = require('../dist/tournaments/tournament-ranking');
const { TournamentScheduleBuilder } = require('../dist/tournaments/tournament-schedule');
const { TeamMonthReportBuilder } = require('../dist/teams/team-month-report');
const { splitEvenly } = require('../dist/travel/travel-money');
const { TravelSummaryBuilder } = require('../dist/travel/travel-summary');

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
  assert.equal(report.emailList, 'an@example.com\nbinh@example.com');
});

test('TravelSummaryBuilder balances paid expenses, collections, and transfer suggestions', () => {
  const builder = new TravelSummaryBuilder();
  const members = [
    { id: 1n, name: 'An', collections: [{ amount: 0 }] },
    { id: 2n, name: 'Binh', collections: [{ amount: 100 }] },
    { id: 3n, name: 'Cuong', collections: [{ amount: 0 }] },
  ];
  const expenses = [
    { amount: 300, paidByMemberId: 1n, splits: splitEvenly(300, [1n, 2n, 3n]) },
    { amount: 90, paidByMemberId: 3n, splits: [{ memberId: 3n, amount: 90 }] },
  ];

  const summary = builder.build(members, expenses, null);

  assert.equal(summary.totalSpent, 390);
  assert.equal(summary.memberSpent.get('1'), 100);
  assert.equal(summary.memberSpent.get('3'), 190);
  assert.equal(summary.memberAdvanced.get('1'), 200);
  assert.equal(summary.totalAdvanced, 200);
  assert.equal(summary.totalCollectedDisplay, 290);
  assert.equal(summary.balance, -100);
  assert.equal(summary.memberDebt.get('3'), 100);
  assert.deepEqual(summary.paymentSuggestions[0], {
    fromMemberId: '3',
    fromName: 'Cuong',
    toMemberId: '1',
    toName: 'An',
    amount: 100,
  });
});
