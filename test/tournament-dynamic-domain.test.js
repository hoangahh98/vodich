const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  TournamentRankingCalculator,
  buildHeadToHeadMap,
  directHeadToHead,
  compareWithHeadToHead,
  sortGroupRowsWithHeadToHead,
  aggregateCrossGroupStandings,
} = require('../dist/tournaments/tournament-ranking');

const {
  TournamentScheduleBuilder,
  groupCountFor,
  isKnockoutStage,
  finishedStageWinners,
  finishedStageLosers,
  STAGE_THIRD_PLACE,
  ROUND_THIRD_PLACE,
} = require('../dist/tournaments/tournament-schedule');

describe('Standings & Ranking Engine: Head-to-Head and Multi-Way Ties', () => {
  test('directHeadToHead: identifies winner of direct finished match', () => {
    const matches = [
      { teamA: 'Hà Nội', teamB: 'Sài Gòn', scoreA: 11, scoreB: 8, status: 'FINISHED' },
      { teamA: 'Đà Nẵng', teamB: 'Hải Phòng', scoreA: 10, scoreB: 12, status: 'FINISHED' },
      { teamA: 'Hà Nội', teamB: 'Đà Nẵng', scoreA: 0, scoreB: 0, status: 'PENDING' },
    ];

    // Hà Nội thắng Sài Gòn 11-8: Hà Nội xếp trên (-1)
    assert.equal(directHeadToHead('Hà Nội', 'Sài Gòn', matches), -1);
    assert.equal(directHeadToHead('Sài Gòn', 'Hà Nội', matches), 1);

    // Hải Phòng thắng Đà Nẵng 12-10: Hải Phòng xếp trên
    assert.equal(directHeadToHead('Hải Phòng', 'Đà Nẵng', matches), -1);
    assert.equal(directHeadToHead('Đà Nẵng', 'Hải Phòng', matches), 1);

    // Chưa đấu xong hoặc chưa từng gặp: trả về 0
    assert.equal(directHeadToHead('Hà Nội', 'Đà Nẵng', matches), 0);
    assert.equal(directHeadToHead('Hà Nội', 'Cần Thơ', matches), 0);
  });

  test('directHeadToHead: split series (1-1) uses direct point differential', () => {
    const matches = [
      { teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 4, status: 'FINISHED' }, // +7 cho A
      { teamA: 'Team B', teamB: 'Team A', scoreA: 11, scoreB: 9, status: 'FINISHED' }, // +2 cho B, -2 cho A -> Net A: +5
    ];

    // 1 thắng - 1 thắng, hiệu số đối đầu trực tiếp: Team A (+5), Team B (-5)
    assert.equal(directHeadToHead('Team A', 'Team B', matches), -1);
    assert.equal(directHeadToHead('Team B', 'Team A', matches), 1);
  });

  test('directHeadToHead: handles precomputed Map from buildHeadToHeadMap', () => {
    const matches = [
      { teamA: 'Team Red', teamB: 'Team Blue', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];
    const map = buildHeadToHeadMap(matches);

    assert.equal(directHeadToHead('Team Red', 'Team Blue', map), -1);
    assert.equal(directHeadToHead('Team Blue', 'Team Red', map), 1);
  });

  test('compareWithHeadToHead: 2 teams tied on wins -> H2H winner ranks higher despite lower point diff', () => {
    const matches = [
      { teamA: 'Chiến Binh', teamB: 'Tia Chớp', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    const rowChienBinh = {
      teamName: 'Chiến Binh',
      played: 2,
      won: 1,
      lost: 1,
      rankingPoints: 1,
      pointsFor: 18,
      pointsAgainst: 19,
      pointDiff: -1, // Hiệu số thấp hơn
    };

    const rowTiaChop = {
      teamName: 'Tia Chớp',
      played: 2,
      won: 1,
      lost: 1,
      rankingPoints: 1,
      pointsFor: 20,
      pointsAgainst: 15,
      pointDiff: +5, // Hiệu số cao hơn
    };

    // Khi đối đầu trực tiếp, Chiến Binh thắng Tia Chớp nên Chiến Binh phải đứng trước
    const result = compareWithHeadToHead(rowChienBinh, rowTiaChop, matches);
    assert.ok(result < 0, 'Chiến Binh phải xếp trước Tia Chớp nhờ thắng đối đầu');

    const resultReverse = compareWithHeadToHead(rowTiaChop, rowChienBinh, matches);
    assert.ok(resultReverse > 0, 'Tia Chớp phải xếp sau Chiến Binh');
  });

  test('sortGroupRowsWithHeadToHead: resolves 3-team circular tie using mini-table point diff and H2H', () => {
    // Vòng tròn 3 đội:
    // A thắng B 11 - 5 (+6 cho A, -6 cho B)
    // B thắng C 11 - 7 (+4 cho B, -4 cho C)
    // C thắng A 11 - 9 (+2 cho C, -2 cho A)
    // Mỗi đội đều có 1 thắng, 1 thua trong các trận gặp nhau.
    // Hiệu số mini-table:
    // A: (+6) + (-2) = +4  --> Hạng 1
    // B: (-6) + (+4) = -2  --> Hạng 2 (vì thắng đối đầu C 11-7)
    // C: (-4) + (+2) = -2  --> Hạng 3
    const matches = [
      { teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { teamA: 'Team C', teamB: 'Team A', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    const rows = [
      { teamName: 'Team C', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 20, pointDiff: -2 },
      { teamA: 'Team A', teamName: 'Team A', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 20, pointsAgainst: 16, pointDiff: +4 },
      { teamB: 'Team B', teamName: 'Team B', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 16, pointsAgainst: 18, pointDiff: -2 },
    ];

    const sorted = sortGroupRowsWithHeadToHead(rows, matches);
    assert.deepEqual(
      sorted.map((r) => r.teamName),
      ['Team A', 'Team B', 'Team C'],
    );
  });

  test('TournamentRankingCalculator.rankingsWithHeadToHead resolves H2H while preserving legacy rankings method', () => {
    const calculator = new TournamentRankingCalculator();
    const matches = [
      { groupName: 'A', teamA: 'Alpha', teamB: 'Beta', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Gamma', teamB: 'Alpha', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    // Legacy method: Alpha (+4) xếp trước Gamma (+2) theo pointDiff
    const legacyRankings = calculator.rankings(matches);
    assert.deepEqual(
      legacyRankings[0].rows.map((r) => r.teamName),
      ['Alpha', 'Gamma', 'Beta'],
    );

    // Enhanced H2H method: Gamma thắng Alpha (11-9), cả 2 đều 1 trận thắng -> Gamma xếp trước Alpha
    const h2hRankings = calculator.rankingsWithHeadToHead(matches);
    assert.deepEqual(
      h2hRankings[0].rows.map((r) => r.teamName),
      ['Gamma', 'Alpha', 'Beta'],
    );
  });
});

describe('Cross-Group Standings Engine (aggregateCrossGroupStandings)', () => {
  test('Scenario R1: 3 groups of 4 teams, top 2 advance, target 8 knockout teams -> shortage 2 and top 2 3rd-place suggested', () => {
    // 3 bảng A, B, C mỗi bảng 4 đội
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 15, pointDiff: 18 },
          { teamName: 'A2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 28, pointsAgainst: 22, pointDiff: 6 },
          { teamName: 'A3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 25, pointsAgainst: 28, pointDiff: -3 },
          { teamName: 'A4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 12, pointsAgainst: 33, pointDiff: -21 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 14, pointDiff: 19 },
          { teamName: 'B2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 29, pointsAgainst: 20, pointDiff: 9 },
          { teamName: 'B3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 27, pointsAgainst: 25, pointDiff: +2 }, // 3rd tốt nhất (hiệu số +2)
          { teamName: 'B4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 10, pointsAgainst: 33, pointDiff: -23 },
        ],
      },
      {
        groupName: 'C',
        rows: [
          { teamName: 'C1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 16, pointDiff: 17 },
          { teamName: 'C2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 26, pointsAgainst: 24, pointDiff: 2 },
          { teamName: 'C3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 26, pointsAgainst: 26, pointDiff: 0 }, // 3rd thứ hai (hiệu số 0)
          { teamName: 'C4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 14, pointsAgainst: 33, pointDiff: -19 },
        ],
      },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 8);

    // 1. Vào thẳng: 3 bảng x 2 đội = 6 đội
    assert.deepEqual(result.directlyQualified, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    assert.equal(result.shortage, 2);
    assert.equal(result.targetCount, 8);

    // 2. Ứng viên là các đội xếp thứ 3 và 4
    assert.equal(result.candidates.length, 6);

    // 3. Đội gợi ý là 2 đội hạng 3 có thành tích tốt nhất: B3 (+2) và C3 (0)
    assert.deepEqual(
      result.suggested.map((r) => r.teamName),
      ['B3', 'C3'],
    );

    // 4. Bảng tổng hợp toàn giải: 3 đội nhất -> 3 đội nhì -> 3 đội ba -> 3 đội tư
    const standingsNames = result.crossGroupStandings.map((r) => r.teamName);
    assert.deepEqual(standingsNames.slice(0, 3).sort(), ['A1', 'B1', 'C1']);
    assert.deepEqual(standingsNames.slice(3, 6).sort(), ['A2', 'B2', 'C2']);
    assert.deepEqual(standingsNames.slice(6, 9), ['B3', 'C3', 'A3']);
  });

  test('Zero Shortage Scenario: 4 groups of 4 teams, top 2 advance -> shortage 0 and empty suggested', () => {
    const rankingGroups = [
      { groupName: 'A', rows: [{ teamName: 'A1', won: 2, pointDiff: 5 }, { teamName: 'A2', won: 1, pointDiff: 0 }] },
      { groupName: 'B', rows: [{ teamName: 'B1', won: 2, pointDiff: 4 }, { teamName: 'B2', won: 1, pointDiff: -1 }] },
      { groupName: 'C', rows: [{ teamName: 'C1', won: 2, pointDiff: 3 }, { teamName: 'C2', won: 1, pointDiff: 1 }] },
      { groupName: 'D', rows: [{ teamName: 'D1', won: 2, pointDiff: 6 }, { teamName: 'D2', won: 1, pointDiff: 2 }] },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 8);

    assert.equal(result.directlyQualified.length, 8);
    assert.equal(result.shortage, 0);
    assert.deepEqual(result.suggested, []);
  });

  test('Group rank takes precedence in cross-group candidate ordering', () => {
    // Giả sử có bảng đấu bất đối xứng: Bảng A có 2 đội nhì (2 thắng) và ba (1 thắng),
    // nhưng đội ba bảng B (1 thắng, hiệu số rất cao +10) không được xếp trên đội nhì bảng A.
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 2, won: 2, lost: 0, rankingPoints: 2, pointsFor: 22, pointsAgainst: 10, pointDiff: 12 },
          { teamName: 'A2', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 18, pointDiff: 0 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 12, pointDiff: 21 },
          { teamName: 'B2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 30, pointsAgainst: 18, pointDiff: 12 },
          { teamName: 'B3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 25, pointsAgainst: 15, pointDiff: 10 },
        ],
      },
    ];

    // Chỉ lấy 1 đội/bảng vào thẳng, cần 3 đội knockout -> shortage 1
    const result = aggregateCrossGroupStandings(rankingGroups, [], 1, 3);
    assert.deepEqual(result.directlyQualified, ['A1', 'B1']);
    assert.equal(result.shortage, 1);

    // Đội nhì (A2, B2) phải đứng trước đội ba (B3)
    const candidateNames = result.candidates.map((r) => r.teamName);
    assert.equal(candidateNames[0], 'B2');
    assert.equal(candidateNames[1], 'A2');
    assert.equal(candidateNames[2], 'B3');
  });
});

describe('Dynamic Schedule Builder (tournament-schedule)', () => {
  test('groupCountFor supports explicit dynamic groupCount and limits to teamCount / 2', () => {
    // 3 bảng đấu
    assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, groupCount: 3 }, 12), 3);
    // 5 bảng đấu
    assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, groupCount: 5 }, 20), 5);
    // Bị chặn bởi floor(teamCount / 2): 6 đội không thể chia 4 bảng, chỉ chia tối đa 3 bảng
    assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, groupCount: 4 }, 6), 3);
    // Không có groupCount thì bảo lưu công thức cũ
    assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4 }, 8), 2);
    assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, 16), 4);
    // Thể thức khác thì luôn là 1 bảng
    assert.equal(groupCountFor({ format: 'ROUND_ROBIN', knockoutQualifierCount: 4, groupCount: 3 }, 10), 1);
  });

  test('TournamentScheduleBuilder: generates groups A, B, C when groupCount = 3', () => {
    const builder = new TournamentScheduleBuilder();
    const tournament = {
      id: 100n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 3,
      knockoutQualifierCount: 8,
      groupCount: 3,
      hasThirdPlace: true,
    };
    const teams = Array.from({ length: 9 }, (_, i) => ({ name: `VĐV ${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const groupStages = matches.filter((m) => m.stage === 'Vòng bảng');
    const groupNames = new Set(groupStages.map((m) => m.groupName));
    assert.deepEqual([...groupNames].sort(), ['A', 'B', 'C']);
  });

  test('TournamentScheduleBuilder: generates 3rd place match (round 103) when hasThirdPlace is true', () => {
    const builder = new TournamentScheduleBuilder();
    const tournament = {
      id: 101n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 2,
      knockoutQualifierCount: 4,
      hasThirdPlace: true,
    };
    const teams = Array.from({ length: 6 }, (_, i) => ({ name: `Đội ${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const thirdPlaceMatches = matches.filter((m) => m.stage === 'Tranh hạng 3-4');
    assert.equal(thirdPlaceMatches.length, 1);
    assert.equal(thirdPlaceMatches[0].roundNumber, 103);
    assert.equal(thirdPlaceMatches[0].teamA, 'Thua Bán kết 1');
    assert.equal(thirdPlaceMatches[0].teamB, 'Thua Bán kết 2');
    assert.equal(thirdPlaceMatches[0].groupName, null);

    const finalMatches = matches.filter((m) => m.stage === 'Chung kết');
    assert.equal(finalMatches.length, 1);
    assert.equal(finalMatches[0].roundNumber, 102);
  });

  test('TournamentScheduleBuilder: generates 3rd place match by default when hasThirdPlace is undefined', () => {
    const builder = new TournamentScheduleBuilder();
    const tournament = {
      id: 102n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 2,
      knockoutQualifierCount: 4,
    };
    const teams = Array.from({ length: 6 }, (_, i) => ({ name: `Đội ${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const thirdPlaceMatches = matches.filter((m) => m.stage === STAGE_THIRD_PLACE);
    assert.equal(thirdPlaceMatches.length, 1);
    assert.equal(thirdPlaceMatches[0].roundNumber, ROUND_THIRD_PLACE);
  });

  test('TournamentScheduleBuilder: OMITS 3rd place match when hasThirdPlace is false', () => {
    const builder = new TournamentScheduleBuilder();
    const tournament = {
      id: 103n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 2,
      knockoutQualifierCount: 4,
      hasThirdPlace: false,
    };
    const teams = Array.from({ length: 6 }, (_, i) => ({ name: `Đội ${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    assert.equal(matches.filter((m) => m.stage === 'Tranh hạng 3-4').length, 0);
    assert.equal(matches.filter((m) => m.stage === 'Chung kết').length, 1);
  });

  test('isKnockoutStage recognizes Tranh hạng 3-4 as knockout stage', () => {
    assert.equal(isKnockoutStage('Tranh hạng 3-4'), true);
    assert.equal(isKnockoutStage(STAGE_THIRD_PLACE), true);
    assert.equal(isKnockoutStage('Tứ kết'), true);
    assert.equal(isKnockoutStage('Bán kết'), true);
    assert.equal(isKnockoutStage('Chung kết'), true);
    assert.equal(isKnockoutStage('Vòng bảng'), false);
    assert.equal(isKnockoutStage('Vòng tròn'), false);
  });

  test('finishedStageLosers returns losers of all finished matches in stage', () => {
    const matches = [
      { id: 10n, stage: 'Bán kết', courtNumber: 1, teamA: 'Hà Nội', teamB: 'Sài Gòn', scoreA: 11, scoreB: 8, status: 'FINISHED' },
      { id: 11n, stage: 'Bán kết', courtNumber: 2, teamA: 'Đà Nẵng', teamB: 'Hải Phòng', scoreA: 9, scoreB: 11, status: 'FINISHED' },
    ];

    const winners = finishedStageWinners(matches, 'Bán kết');
    assert.deepEqual(winners, ['Hà Nội', 'Hải Phòng']);

    const losers = finishedStageLosers(matches, 'Bán kết');
    assert.deepEqual(losers, ['Sài Gòn', 'Đà Nẵng']);
  });

  test('finishedStageLosers returns null if any match in stage is unfinished', () => {
    const matches = [
      { id: 10n, stage: 'Bán kết', courtNumber: 1, teamA: 'Hà Nội', teamB: 'Sài Gòn', scoreA: 11, scoreB: 8, status: 'FINISHED' },
      { id: 11n, stage: 'Bán kết', courtNumber: 2, teamA: 'Đà Nẵng', teamB: 'Hải Phòng', scoreA: 0, scoreB: 0, status: 'PLAYING' },
    ];

    assert.equal(finishedStageLosers(matches, 'Bán kết'), null);
  });

  test('sortGroupRowsWithHeadToHead: preserves correct mini-table order when team names have whitespace', () => {
    const matches = [
      { groupName: 'A', teamA: ' Team A ', teamB: 'Team B', scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team C', teamB: ' Team A ', scoreA: 11, scoreB: 6, status: 'FINISHED' },
    ];
    const rows = [
      { teamName: ' Team A ', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 17, pointsAgainst: 13, pointDiff: 4 },
      { teamName: 'Team B', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 13, pointsAgainst: 18, pointDiff: -5 },
      { teamName: 'Team C', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 17, pointDiff: 1 },
    ];
    const sorted = sortGroupRowsWithHeadToHead(rows, matches);
    assert.deepEqual(
      sorted.map((r) => r.teamName.trim()),
      ['Team A', 'Team C', 'Team B'],
    );
  });

  test('directHeadToHead & aggregateCrossGroupStandings: null-safe when matches is undefined or null', () => {
    assert.equal(directHeadToHead('Team A', 'Team B', undefined), 0);
    assert.equal(directHeadToHead('Team A', 'Team B', null), 0);
    assert.equal(buildHeadToHeadMap(undefined).size, 0);

    const groups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', won: 2, pointDiff: 5, pointsFor: 20, pointsAgainst: 15, played: 2, lost: 0, rankingPoints: 2 },
          { teamName: 'A2', won: 1, pointDiff: 0, pointsFor: 10, pointsAgainst: 10, played: 2, lost: 1, rankingPoints: 1 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', won: 2, pointDiff: 5, pointsFor: 20, pointsAgainst: 15, played: 2, lost: 0, rankingPoints: 2 },
          { teamName: 'B2', won: 1, pointDiff: 0, pointsFor: 10, pointsAgainst: 10, played: 2, lost: 1, rankingPoints: 1 },
        ],
      },
    ];
    assert.doesNotThrow(() => {
      aggregateCrossGroupStandings(groups, undefined, 1, 4);
    });
  });

  test('TournamentScheduleBuilder: clamps groupCount via groupCountFor and handles edge cases safely', () => {
    const builder = new TournamentScheduleBuilder();
    // 3 teams with groupCount: 3 -> clamped to 1 group of 3 teams, generating 3 matches
    const t3 = {
      id: 104n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 2,
      knockoutQualifierCount: 8,
      groupCount: 3,
      hasThirdPlace: true,
    };
    const matches3 = builder.fromManualPairs(t3, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    const groupMatches3 = matches3.filter((m) => m.stage === 'Vòng bảng');
    assert.equal(groupMatches3.length, 3, 'Must clamp 3 teams in 3 groups to 1 group with 3 round-robin matches');

    // Negative groupCount safely falls back without throwing
    const tNeg = {
      id: 105n,
      format: 'GROUP_KNOCKOUT',
      playType: 'SINGLES',
      courtCount: 2,
      knockoutQualifierCount: 8,
      groupCount: -1,
      hasThirdPlace: true,
    };
    assert.doesNotThrow(() => {
      builder.fromManualPairs(tNeg, [{ name: 'A' }, { name: 'B' }]);
    });
  });
});
