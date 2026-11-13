const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  TournamentScheduleBuilder,
  groupCountFor,
  groupLetter,
  groupIndexOf,
  isKnockoutStage,
  finishedStageWinners,
  finishedStageLosers,
  STAGE_THIRD_PLACE,
  ROUND_THIRD_PLACE,
} = require('../dist/tournaments/tournament-schedule');

const {
  aggregateCrossGroupStandings,
  directHeadToHead,
  compareWithHeadToHead,
} = require('../dist/tournaments/tournament-ranking');

// Helper to construct a minimal Tournament object
function mockTournament(overrides = {}) {
  return {
    id: 999n,
    title: 'Test Tournament',
    format: 'GROUP_KNOCKOUT',
    playType: 'SINGLES',
    pairingRule: 'RANDOM',
    courtCount: 3,
    knockoutQualifierCount: 8,
    groupCount: 3,
    advancePerGroup: 2,
    hasThirdPlace: true,
    ...overrides,
  };
}

describe('CHALLENGER 2 — Dynamic Schedule Generation Empirical Stress Tests', () => {
  const builder = new TournamentScheduleBuilder();

  test('TC1.1: Various Group Counts (1, 2, 3, 5, 8 groups) with varying team counts generate valid fixtures', () => {
    const testCases = [
      { name: '1 group, 4 teams (even)', groupCount: 1, teamCount: 4, expectedGroups: ['A'], expectedMatchesPerGroup: [6] },
      { name: '1 group, 5 teams (odd)', groupCount: 1, teamCount: 5, expectedGroups: ['A'], expectedMatchesPerGroup: [10] },
      { name: '2 groups, 8 teams (4 in each)', groupCount: 2, teamCount: 8, expectedGroups: ['A', 'B'], expectedMatchesPerGroup: [6, 6] },
      { name: '2 groups, 7 teams (4 in A, 3 in B)', groupCount: 2, teamCount: 7, expectedGroups: ['A', 'B'], expectedMatchesPerGroup: [6, 3] },
      { name: '3 groups, 10 teams (4 in A, 3 in B, 3 in C)', groupCount: 3, teamCount: 10, expectedGroups: ['A', 'B', 'C'], expectedMatchesPerGroup: [6, 3, 3] },
      { name: '5 groups, 15 teams (3 in each)', groupCount: 5, teamCount: 15, expectedGroups: ['A', 'B', 'C', 'D', 'E'], expectedMatchesPerGroup: [3, 3, 3, 3, 3] },
      { name: '5 groups, 16 teams (4 in A, 3 in B..E)', groupCount: 5, teamCount: 16, expectedGroups: ['A', 'B', 'C', 'D', 'E'], expectedMatchesPerGroup: [6, 3, 3, 3, 3] },
      { name: '8 groups, 16 teams (2 in each)', groupCount: 8, teamCount: 16, expectedGroups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], expectedMatchesPerGroup: [1, 1, 1, 1, 1, 1, 1, 1] },
      { name: '8 groups, 24 teams (3 in each)', groupCount: 8, teamCount: 24, expectedGroups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], expectedMatchesPerGroup: [3, 3, 3, 3, 3, 3, 3, 3] },
    ];

    for (const tc of testCases) {
      const tournament = mockTournament({
        groupCount: tc.groupCount,
        knockoutQualifierCount: 8,
        courtCount: 4,
      });
      const teams = Array.from({ length: tc.teamCount }, (_, i) => ({ name: `T_${i + 1}` }));
      const matches = builder.fromManualPairs(tournament, teams);
      const groupMatches = matches.filter((m) => m.stage === 'Vòng bảng');

      // Check group names
      const presentGroups = [...new Set(groupMatches.map((m) => m.groupName))].sort();
      assert.deepEqual(presentGroups, tc.expectedGroups, `Failed group names for ${tc.name}`);

      // Check match count per group
      for (let i = 0; i < tc.expectedGroups.length; i++) {
        const gName = tc.expectedGroups[i];
        const gMatches = groupMatches.filter((m) => m.groupName === gName);
        assert.equal(
          gMatches.length,
          tc.expectedMatchesPerGroup[i],
          `Failed match count for group ${gName} in ${tc.name}: got ${gMatches.length}, expected ${tc.expectedMatchesPerGroup[i]}`,
        );
      }
    }
  });

  test('TC1.2: Fixture Validity — No duplicate pairings, no self-play, strictly within-group play, valid courts & rounds', () => {
    const configVariations = [
      { groupCount: 2, teamCount: 7, courtCount: 2 },
      { groupCount: 3, teamCount: 11, courtCount: 3 },
      { groupCount: 5, teamCount: 17, courtCount: 4 },
      { groupCount: 8, teamCount: 25, courtCount: 6 },
    ];

    for (const conf of configVariations) {
      const tournament = mockTournament({
        groupCount: conf.groupCount,
        courtCount: conf.courtCount,
      });
      const teams = Array.from({ length: conf.teamCount }, (_, i) => ({ name: `Team_${i + 1}` }));
      const matches = builder.fromManualPairs(tournament, teams);
      const groupMatches = matches.filter((m) => m.stage === 'Vòng bảng');

      // Map each team to its assigned group
      const teamToGroup = new Map();
      for (const m of groupMatches) {
        if (!teamToGroup.has(m.teamA)) teamToGroup.set(m.teamA, m.groupName);
        if (!teamToGroup.has(m.teamB)) teamToGroup.set(m.teamB, m.groupName);
      }

      // 1. Verify every team is in exactly one group
      const seenPairings = new Set();
      for (const m of groupMatches) {
        // No self-play
        assert.notEqual(m.teamA, m.teamB, `Self-play detected: ${m.teamA} vs ${m.teamB}`);

        // Both teams must belong to m.groupName
        assert.equal(teamToGroup.get(m.teamA), m.groupName, `Team ${m.teamA} assigned outside its group ${m.groupName}`);
        assert.equal(teamToGroup.get(m.teamB), m.groupName, `Team ${m.teamB} assigned outside its group ${m.groupName}`);

        // No duplicate pairings within group stage
        const pairKey = [m.teamA, m.teamB].sort().join(':::');
        assert.equal(seenPairings.has(pairKey), false, `Duplicate pairing found in group stage: ${pairKey}`);
        seenPairings.add(pairKey);

        // Court constraints
        assert.ok(m.courtNumber >= 1 && m.courtNumber <= conf.courtCount, `Invalid courtNumber ${m.courtNumber}`);
        // Round number positive
        assert.ok(m.roundNumber >= 1, `Invalid roundNumber ${m.roundNumber}`);
      }

      // 2. Verify complete graph per group: each group of size K has K*(K-1)/2 matches
      const groupMembers = new Map();
      for (const [team, group] of teamToGroup.entries()) {
        const list = groupMembers.get(group) || [];
        list.push(team);
        groupMembers.set(group, list);
      }

      for (const [group, members] of groupMembers.entries()) {
        const expectedPairCount = (members.length * (members.length - 1)) / 2;
        const matchesInGroup = groupMatches.filter((m) => m.groupName === group);
        assert.equal(
          matchesInGroup.length,
          expectedPairCount,
          `Group ${group} has ${matchesInGroup.length} matches, expected complete round-robin ${expectedPairCount}`,
        );
      }
    }
  });

  test('TC1.3: FIX VERIFICATION — 3 teams in 3 groups & negative groupCount use groupCountFor clamping', () => {
    // 3 teams with groupCount: 3 -> clamped to 1 group of 3 teams, producing 3 round-robin matches
    const t3 = mockTournament({ groupCount: 3 });
    const teams3 = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

    assert.equal(groupCountFor(t3, 3), 1, 'groupCountFor correctly clamps to 1 group');
    const matches3 = builder.fromManualPairs(t3, teams3);
    const groupMatches3 = matches3.filter((m) => m.stage === 'Vòng bảng');
    assert.equal(groupMatches3.length, 3, 'VERIFIED FIX: 3 group matches generated in 1 clamped group (A vs B, B vs C, C vs A)');
    const presentGroups = [...new Set(groupMatches3.map((m) => m.groupName))];
    assert.deepEqual(presentGroups, ['A'], 'All 3 teams correctly placed into single group A');

    // Negative groupCount safely falls back without throwing TypeError
    const tNeg = mockTournament({ groupCount: -1, knockoutQualifierCount: 4 });
    assert.ok(groupCountFor(tNeg, 4) >= 1, 'groupCountFor safely ignores negative groupCount');
    assert.doesNotThrow(
      () => builder.fromManualPairs(tNeg, [{ name: 'A' }, { name: 'B' }]),
      'VERIFIED FIX: negative groupCount does not crash; falls back cleanly',
    );
    const matchesNeg = builder.fromManualPairs(tNeg, [{ name: 'A' }, { name: 'B' }]);
    assert.equal(matchesNeg.filter((m) => m.stage === 'Vòng bảng').length, 1);
  });

  test('TC1.4: Knockout Stages — knockoutQualifierCount: 8, hasThirdPlace: true', () => {
    const tournament = mockTournament({
      knockoutQualifierCount: 8,
      hasThirdPlace: true,
      groupCount: 4,
    });
    const teams = Array.from({ length: 8 }, (_, i) => ({ name: `Team_${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));
    
    // Stages: Tứ kết (4 matches), Bán kết (2 matches), Chung kết (1 match), Tranh hạng 3-4 (1 match) -> Total 8
    assert.equal(knockoutMatches.length, 8, 'Total knockout matches must be 8');

    const qf = knockoutMatches.filter((m) => m.stage === 'Tứ kết' && m.roundNumber === 100);
    assert.equal(qf.length, 4, 'Must have 4 Quarterfinal matches');

    const sf = knockoutMatches.filter((m) => m.stage === 'Bán kết' && m.roundNumber === 101);
    assert.equal(sf.length, 2, 'Must have 2 Semifinal matches');

    const finals = knockoutMatches.filter((m) => m.stage === 'Chung kết' && m.roundNumber === 102);
    assert.equal(finals.length, 1, 'Must have 1 Final match');

    const thirdPlace = knockoutMatches.filter((m) => m.stage === STAGE_THIRD_PLACE && m.roundNumber === ROUND_THIRD_PLACE);
    assert.equal(thirdPlace.length, 1, 'Must have 1 Third-place match');
    assert.equal(thirdPlace[0].teamA, 'Thua Bán kết 1');
    assert.equal(thirdPlace[0].teamB, 'Thua Bán kết 2');
  });

  test('TC1.5: Knockout Stages — knockoutQualifierCount: 8, hasThirdPlace: false', () => {
    const tournament = mockTournament({
      knockoutQualifierCount: 8,
      hasThirdPlace: false,
      groupCount: 4,
    });
    const teams = Array.from({ length: 8 }, (_, i) => ({ name: `Team_${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));

    // Stages: Tứ kết (4), Bán kết (2), Chung kết (1). NO Tranh hạng 3-4 -> Total 7
    assert.equal(knockoutMatches.length, 7, 'Total knockout matches must be 7 when hasThirdPlace is false');

    const thirdPlace = knockoutMatches.filter((m) => m.stage === STAGE_THIRD_PLACE || m.roundNumber === ROUND_THIRD_PLACE);
    assert.equal(thirdPlace.length, 0, 'Tranh hạng 3-4 must be completely omitted when hasThirdPlace is false');

    const finals = knockoutMatches.filter((m) => m.stage === 'Chung kết');
    assert.equal(finals.length, 1);
  });

  test('TC1.6: Knockout Stages — knockoutQualifierCount: 4, hasThirdPlace: true', () => {
    const tournament = mockTournament({
      knockoutQualifierCount: 4,
      hasThirdPlace: true,
      groupCount: 2,
    });
    const teams = Array.from({ length: 6 }, (_, i) => ({ name: `Team_${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));

    // Must NOT have Tứ kết (round 100)
    const qf = knockoutMatches.filter((m) => m.stage === 'Tứ kết' || m.roundNumber === 100);
    assert.equal(qf.length, 0, 'No Quarterfinal matches when knockoutQualifierCount is 4');

    // Must have Bán kết (2), Chung kết (1), Tranh hạng 3-4 (1) -> Total 4
    assert.equal(knockoutMatches.length, 4, 'Must have 4 knockout matches (2 SF, 1 Final, 1 3rd-Place)');

    const sf = knockoutMatches.filter((m) => m.stage === 'Bán kết' && m.roundNumber === 101);
    assert.equal(sf.length, 2);

    const finals = knockoutMatches.filter((m) => m.stage === 'Chung kết' && m.roundNumber === 102);
    assert.equal(finals.length, 1);

    const thirdPlace = knockoutMatches.filter((m) => m.stage === STAGE_THIRD_PLACE && m.roundNumber === ROUND_THIRD_PLACE);
    assert.equal(thirdPlace.length, 1);
  });

  test('TC1.7: Knockout Stages — knockoutQualifierCount: 4, hasThirdPlace: false', () => {
    const tournament = mockTournament({
      knockoutQualifierCount: 4,
      hasThirdPlace: false,
      groupCount: 2,
    });
    const teams = Array.from({ length: 6 }, (_, i) => ({ name: `Team_${i + 1}` }));
    const matches = builder.fromManualPairs(tournament, teams);

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));

    // Must have Bán kết (2), Chung kết (1). NO QF, NO 3rd place -> Total 3
    assert.equal(knockoutMatches.length, 3);
    assert.equal(knockoutMatches.filter((m) => m.stage === STAGE_THIRD_PLACE).length, 0);
  });

  test('TC1.8: Knockout Stages — knockoutQualifierCount: 2 (Finals only, no 3rd place even if hasThirdPlace is true)', () => {
    const tournament = mockTournament({
      knockoutQualifierCount: 2,
      hasThirdPlace: true,
      groupCount: 1,
    });
    const teams = [{ name: 'Team_1' }, { name: 'Team_2' }, { name: 'Team_3' }];
    const matches = builder.fromManualPairs(tournament, teams);

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));
    assert.equal(knockoutMatches.length, 1, 'Only Chung kết (round 102)');
    assert.equal(knockoutMatches[0].stage, 'Chung kết');
    assert.equal(knockoutMatches[0].roundNumber, 102);
  });
});

describe('CHALLENGER 2 — Cross-Group Standings Empirical Stress Tests', () => {
  test('TC2.1: 3 groups, advancePerGroup: 2, targetKnockoutCount: 8 -> directlyQualified: 6, shortage: 2, best 2 third-place wildcards', () => {
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 12, pointDiff: 21 },
          { teamName: 'A2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 28, pointsAgainst: 22, pointDiff: 6 },
          { teamName: 'A3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 22, pointsAgainst: 28, pointDiff: -6 }, // 3rd place A
          { teamName: 'A4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 12, pointsAgainst: 33, pointDiff: -21 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 10, pointDiff: 23 },
          { teamName: 'B2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 29, pointsAgainst: 20, pointDiff: 9 },
          { teamName: 'B3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 26, pointsAgainst: 24, pointDiff: 2 }, // 3rd place B (best 3rd: +2 diff)
          { teamName: 'B4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 10, pointsAgainst: 33, pointDiff: -23 },
        ],
      },
      {
        groupName: 'C',
        rows: [
          { teamName: 'C1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 15, pointDiff: 18 },
          { teamName: 'C2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 26, pointsAgainst: 24, pointDiff: 2 },
          { teamName: 'C3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 25, pointsAgainst: 26, pointDiff: -1 }, // 3rd place C (second best 3rd: -1 diff)
          { teamName: 'C4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 14, pointsAgainst: 33, pointDiff: -19 },
        ],
      },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 8);

    // Directly qualified
    assert.deepEqual(result.directlyQualified, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    assert.equal(result.shortage, 2);
    assert.equal(result.targetCount, 8);

    // Wildcards must be top 2 third-place teams: B3 (+2 diff) and C3 (-1 diff)
    assert.deepEqual(
      result.suggested.map((r) => r.teamName),
      ['B3', 'C3'],
    );

    // Verify candidates ordering: B3, C3, A3, then 4th-place teams (C4, A4, B4)
    assert.deepEqual(
      result.candidates.map((r) => r.teamName),
      ['B3', 'C3', 'A3', 'C4', 'A4', 'B4'],
    );
  });

  test('TC2.2: Exact Match — 4 groups, advancePerGroup: 2, targetKnockoutCount: 8 -> shortage: 0, suggested: []', () => {
    const rankingGroups = [
      { groupName: 'A', rows: [{ teamName: 'A1', won: 3 }, { teamName: 'A2', won: 2 }, { teamName: 'A3', won: 1 }] },
      { groupName: 'B', rows: [{ teamName: 'B1', won: 3 }, { teamName: 'B2', won: 2 }, { teamName: 'B3', won: 1 }] },
      { groupName: 'C', rows: [{ teamName: 'C1', won: 3 }, { teamName: 'C2', won: 2 }, { teamName: 'C3', won: 1 }] },
      { groupName: 'D', rows: [{ teamName: 'D1', won: 3 }, { teamName: 'D2', won: 2 }, { teamName: 'D3', won: 1 }] },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 8);

    assert.equal(result.directlyQualified.length, 8);
    assert.deepEqual(result.directlyQualified, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2']);
    assert.equal(result.shortage, 0);
    assert.deepEqual(result.suggested, []);
    assert.equal(result.candidates.length, 4); // A3, B3, C3, D3
  });

  test('TC2.3: Surplus Match — 4 groups, advancePerGroup: 3, targetKnockoutCount: 8 -> shortage: 0, suggested: []', () => {
    const rankingGroups = [
      { groupName: 'A', rows: [{ teamName: 'A1' }, { teamName: 'A2' }, { teamName: 'A3' }, { teamName: 'A4' }] },
      { groupName: 'B', rows: [{ teamName: 'B1' }, { teamName: 'B2' }, { teamName: 'B3' }, { teamName: 'B4' }] },
      { groupName: 'C', rows: [{ teamName: 'C1' }, { teamName: 'C2' }, { teamName: 'C3' }, { teamName: 'C4' }] },
      { groupName: 'D', rows: [{ teamName: 'D1' }, { teamName: 'D2' }, { teamName: 'D3' }, { teamName: 'D4' }] },
    ];

    // 4 groups x 3 = 12 directly qualified, exceeding target of 8
    const result = aggregateCrossGroupStandings(rankingGroups, [], 3, 8);

    assert.equal(result.directlyQualified.length, 12);
    assert.equal(result.shortage, 0);
    assert.deepEqual(result.suggested, []);
    assert.equal(result.candidates.length, 4); // 4th-place teams
  });

  test('TC2.4: Groups of Unequal Sizes — Group A has 4 teams, Group B has 3 teams', () => {
    // Group A (4 teams): A1 (1st), A2 (2nd), A3 (3rd), A4 (4th)
    // Group B (3 teams): B1 (1st), B2 (2nd), B3 (3rd)
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 12, pointDiff: 21 },
          { teamName: 'A2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 28, pointsAgainst: 22, pointDiff: 6 },
          { teamName: 'A3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 20, pointsAgainst: 28, pointDiff: -8 },
          { teamName: 'A4', played: 3, won: 0, lost: 3, rankingPoints: 0, pointsFor: 12, pointsAgainst: 33, pointDiff: -21 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', played: 2, won: 2, lost: 0, rankingPoints: 2, pointsFor: 22, pointsAgainst: 10, pointDiff: 12 },
          { teamName: 'B2', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 18, pointDiff: 0 },
          { teamName: 'B3', played: 2, won: 0, lost: 2, rankingPoints: 0, pointsFor: 10, pointsAgainst: 22, pointDiff: -12 },
        ],
      },
    ];

    // Advance 1 per group, target 4 knockout teams -> directlyQualified: 2 (A1, B1), shortage: 2
    const result = aggregateCrossGroupStandings(rankingGroups, [], 1, 4);

    assert.deepEqual(result.directlyQualified, ['A1', 'B1']);
    assert.equal(result.shortage, 2);

    // Candidates: 2nd place teams (A2, B2) must rank before 3rd place teams (A3, B3)
    // A2 won 2 matches vs B2 won 1 match -> A2 ranks first, B2 second
    assert.deepEqual(
      result.suggested.map((r) => r.teamName),
      ['A2', 'B2'],
    );

    // Complete candidate list
    assert.deepEqual(
      result.candidates.map((r) => r.teamName),
      ['A2', 'B2', 'A3', 'B3', 'A4'],
    );
  });

  test('TC2.5: Cross-group tie-breaking fallback to teamName when non-group teams never met', () => {
    // Two 3rd-place teams with identical won, pointDiff, pointsFor from different groups
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', won: 2, pointDiff: 10, pointsFor: 22 },
          { teamName: 'A2', won: 1, pointDiff: 2, pointsFor: 15 },
          { teamName: 'Beta', won: 0, pointDiff: -12, pointsFor: 10 }, // 3rd
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', won: 2, pointDiff: 10, pointsFor: 22 },
          { teamName: 'B2', won: 1, pointDiff: 2, pointsFor: 15 },
          { teamName: 'Alpha', won: 0, pointDiff: -12, pointsFor: 10 }, // 3rd (identical stats to Beta)
        ],
      },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 5);
    assert.equal(result.shortage, 1);
    
    // Alpha comes before Beta alphabetically
    assert.deepEqual(
      result.suggested.map((r) => r.teamName),
      ['Alpha'],
    );
  });

  test('TC2.6: Boundary input robustness — empty groups, zero target, shortage > candidates', () => {
    const emptyResult = aggregateCrossGroupStandings([], [], 2, 8);
    assert.deepEqual(emptyResult.directlyQualified, []);
    assert.equal(emptyResult.shortage, 8);
    assert.deepEqual(emptyResult.suggested, []);
    assert.deepEqual(emptyResult.candidates, []);

    const zeroTarget = aggregateCrossGroupStandings(
      [{ groupName: 'A', rows: [{ teamName: 'A1' }, { teamName: 'A2' }] }],
      [],
      1,
      0,
    );
    assert.deepEqual(zeroTarget.directlyQualified, ['A1']);
    assert.equal(zeroTarget.shortage, 0);
    assert.deepEqual(zeroTarget.suggested, []);

    // Shortage exceeds available candidates
    const scarceResult = aggregateCrossGroupStandings(
      [{ groupName: 'A', rows: [{ teamName: 'A1' }, { teamName: 'A2' }] }],
      [],
      1,
      5,
    );
    assert.equal(scarceResult.shortage, 4);
    assert.equal(scarceResult.candidates.length, 1);
    assert.equal(scarceResult.suggested.length, 1); // Returns all available candidates without padding undefined
    assert.equal(scarceResult.suggested[0].teamName, 'A2');
  });

  test('TC2.7: Fuzz Stress Testing — 100 randomized multi-group configurations maintain all mathematical invariants', () => {
    for (let seed = 0; seed < 100; seed++) {
      const groupCount = 1 + (seed % 6); // 1 to 6 groups
      const advancePerGroup = 1 + (seed % 3); // 1 to 3
      const targetKnockoutCount = (seed * 2) % 16; // 0, 2, 4, 6, 8, 10, 12, 14

      const rankingGroups = [];
      let totalTeams = 0;

      for (let g = 0; g < groupCount; g++) {
        const teamCountInGroup = 2 + ((seed + g) % 4); // 2 to 5 teams
        const groupLetterName = String.fromCharCode(65 + g);
        const rows = [];
        for (let t = 0; t < teamCountInGroup; t++) {
          totalTeams++;
          rows.push({
            teamName: `${groupLetterName}_Team_${t + 1}`,
            played: teamCountInGroup - 1,
            won: teamCountInGroup - 1 - t,
            lost: t,
            rankingPoints: teamCountInGroup - 1 - t,
            pointsFor: 30 - t * 4,
            pointsAgainst: 10 + t * 4,
            pointDiff: 20 - t * 8,
          });
        }
        rankingGroups.push({ groupName: groupLetterName, rows });
      }

      const res = aggregateCrossGroupStandings(rankingGroups, [], advancePerGroup, targetKnockoutCount);

      // Invariant 1: Qualified length
      const expectedQualified = rankingGroups.reduce((acc, g) => acc + Math.min(advancePerGroup, g.rows.length), 0);
      assert.equal(res.directlyQualified.length, expectedQualified, `Seed ${seed}: Qualified count mismatch`);

      // Invariant 2: Shortage calculation
      assert.equal(res.shortage, Math.max(0, targetKnockoutCount - expectedQualified), `Seed ${seed}: Shortage mismatch`);

      // Invariant 3: Suggested count
      assert.equal(res.suggested.length, Math.min(res.shortage, res.candidates.length), `Seed ${seed}: Suggested count mismatch`);

      // Invariant 4: No overlap between qualified and candidates
      const qualifiedSet = new Set(res.directlyQualified);
      for (const cand of res.candidates) {
        assert.equal(qualifiedSet.has(cand.teamName), false, `Seed ${seed}: Candidate ${cand.teamName} is in directlyQualified`);
      }

      // Invariant 5: Candidates monotonic by groupRank
      // Note: candidates is a sub-list of crossGroupStandings where allRows was sorted by groupRank
      // Verify that no candidate with a worse within-group position ranks above one with a better position
      for (let i = 0; i < res.candidates.length - 1; i++) {
        const c1 = res.candidates[i];
        const c2 = res.candidates[i + 1];
        // Find their within-group ranks:
        const findRank = (name) => {
          for (const g of rankingGroups) {
            const idx = g.rows.findIndex((r) => r.teamName === name);
            if (idx >= 0) return idx + 1;
          }
          return 999;
        };
        const rank1 = findRank(c1.teamName);
        const rank2 = findRank(c2.teamName);
        assert.ok(rank1 <= rank2, `Seed ${seed}: Candidate ${c1.teamName} (rank ${rank1}) ranked below ${c2.teamName} (rank ${rank2})`);
      }
    }
  });
});
