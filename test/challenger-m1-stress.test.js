'use strict';

/**
 * test/challenger-m1-stress.test.js
 *
 * EXPANDED ADVERSARIAL STRESS TEST HARNESS — Challenger M1 Iteration 2
 *
 * Objectives:
 * 1. 1000 randomized 3-team circular ties with random scores (verifying mini-table oracle logic, determinism, invariants).
 * 2. Multi-team ties and circular ties with heavy whitespace (spaces, tabs, newlines).
 * 3. Null, undefined, malformed objects and arrays across all public ranking functions.
 * 4. Cross-group edge cases with null/undefined groups, rows, matches, negative targets.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  TournamentRankingCalculator,
  buildHeadToHeadMap,
  directHeadToHead,
  compareWithHeadToHead,
  sortGroupRowsWithHeadToHead,
  aggregateCrossGroupStandings,
  pairKey,
} = require('../dist/tournaments/tournament-ranking');

describe('STRESS TEST 1: 1000 Randomized 3-Team Circular Ties with Oracle Verification', () => {
  test('1000 random circular ties: determinism, mathematical mini-table correctness & invariants', () => {
    const teams = ['Team Alpha', 'Team Beta', 'Team Gamma'];
    const calc = new TournamentRankingCalculator();

    let countClearWinner = 0;
    let countTiebreak2Teams = 0;
    let countThreeWayTies = 0;

    for (let iter = 0; iter < 1000; iter++) {
      // Generate a true circular tie: Alpha beats Beta, Beta beats Gamma, Gamma beats Alpha
      // Score margins vary widely: close games, blowouts, standard 11-point games, and deuce games
      const scoreStyle = iter % 4;
      let sAB_A, sAB_B, sBC_B, sBC_C, sCA_C, sCA_A;

      if (scoreStyle === 0) {
        // Standard pickleball to 11
        sAB_A = 11;
        sAB_B = Math.floor(Math.random() * 10); // 0..9
        sBC_B = 11;
        sBC_C = Math.floor(Math.random() * 10);
        sCA_C = 11;
        sCA_A = Math.floor(Math.random() * 10);
      } else if (scoreStyle === 1) {
        // Close / deuce scores (11-9 to 15-13)
        const marginAB = 2;
        sAB_B = 9 + Math.floor(Math.random() * 5); // 9..13
        sAB_A = sAB_B + marginAB;
        const marginBC = 2;
        sBC_C = 9 + Math.floor(Math.random() * 5);
        sBC_B = sBC_C + marginBC;
        const marginCA = 2;
        sCA_A = 9 + Math.floor(Math.random() * 5);
        sCA_C = sCA_A + marginCA;
      } else if (scoreStyle === 2) {
        // Blowouts or mixed scores (11-0, 11-1, etc.)
        sAB_A = 11;
        sAB_B = Math.floor(Math.random() * 3);
        sBC_B = 11;
        sBC_C = Math.floor(Math.random() * 3);
        sCA_C = 11;
        sCA_A = Math.floor(Math.random() * 3);
      } else {
        // High scoring games (e.g. up to 21)
        sAB_A = 21;
        sAB_B = Math.floor(Math.random() * 20);
        sBC_B = 21;
        sBC_C = Math.floor(Math.random() * 20);
        sCA_C = 21;
        sCA_A = Math.floor(Math.random() * 20);
      }

      const matches = [
        { groupName: 'Pool', teamA: teams[0], teamB: teams[1], scoreA: sAB_A, scoreB: sAB_B, status: 'FINISHED' },
        { groupName: 'Pool', teamA: teams[1], teamB: teams[2], scoreA: sBC_B, scoreB: sBC_C, status: 'FINISHED' },
        { groupName: 'Pool', teamA: teams[2], teamB: teams[0], scoreA: sCA_C, scoreB: sCA_A, status: 'FINISHED' },
      ];

      // Independent Oracle calculation
      // Alpha: beat Beta (sAB_A - sAB_B), lost to Gamma (sCA_A - sCA_C)
      const diffAlpha = (sAB_A - sAB_B) + (sCA_A - sCA_C);
      // Beta: beat Gamma (sBC_B - sBC_C), lost to Alpha (sAB_B - sAB_A)
      const diffBeta = (sBC_B - sBC_C) + (sAB_B - sAB_A);
      // Gamma: beat Alpha (sCA_C - sCA_A), lost to Beta (sBC_C - sBC_B)
      const diffGamma = (sCA_C - sCA_A) + (sBC_C - sBC_B);

      assert.equal(diffAlpha + diffBeta + diffGamma, 0, `Sum of net diffs must be 0 at iter ${iter}`);

      const oracleDiffs = {
        'Team Alpha': diffAlpha,
        'Team Beta': diffBeta,
        'Team Gamma': diffGamma,
      };

      // Execute ranking twice to verify determinism / idempotence
      const r1 = calc.rankingsWithHeadToHead(matches)[0].rows;
      const r2 = calc.rankingsWithHeadToHead(matches)[0].rows;

      assert.equal(r1.length, 3, `Iter ${iter}: length must be 3`);
      assert.deepEqual(r1.map((r) => r.teamName), r2.map((r) => r.teamName), `Iter ${iter}: non-deterministic!`);

      // Verify basic invariants
      for (const row of r1) {
        assert.equal(row.won, 1, `Iter ${iter}: each team must have exactly 1 win`);
        assert.equal(row.lost, 1, `Iter ${iter}: each team must have exactly 1 loss`);
        assert.equal(row.played, 2, `Iter ${iter}: each team played 2 games`);
        assert.equal(row.pointDiff, row.pointsFor - row.pointsAgainst, `Iter ${iter}: pointDiff arithmetic check`);
        assert.equal(row.pointDiff, oracleDiffs[row.teamName], `Iter ${iter}: pointDiff matches oracle for ${row.teamName}`);
      }

      // Check oracle sorting correctness:
      // Case 1: All 3 have distinct miniDiffs
      const sortedByDiff = [...teams].sort((t1, t2) => oracleDiffs[t2] - oracleDiffs[t1]);
      const d0 = oracleDiffs[sortedByDiff[0]];
      const d1 = oracleDiffs[sortedByDiff[1]];
      const d2 = oracleDiffs[sortedByDiff[2]];

      if (d0 > d1 && d1 > d2) {
        // Distinct miniDiffs -> rank MUST strictly match sortedByDiff!
        countClearWinner++;
        assert.deepEqual(
          r1.map((r) => r.teamName),
          sortedByDiff,
          `Iter ${iter}: distinct diffs [${d0}, ${d1}, ${d2}] failed to sort correctly!`,
        );
      } else if (d0 > d1 && d1 === d2) {
        // Top 1 has highest diff. Teams 1 and 2 are tied on diff!
        countTiebreak2Teams++;
        assert.equal(r1[0].teamName, sortedByDiff[0], `Iter ${iter}: leader must be ${sortedByDiff[0]}`);
        // The remaining 2 tied teams must be broken by direct H2H between them
        const tSecond = sortedByDiff[1];
        const tThird = sortedByDiff[2];
        const h2h = directHeadToHead(tSecond, tThird, matches);
        if (h2h === -1) {
          assert.equal(r1[1].teamName, tSecond);
          assert.equal(r1[2].teamName, tThird);
        } else if (h2h === 1) {
          assert.equal(r1[1].teamName, tThird);
          assert.equal(r1[2].teamName, tSecond);
        }
      } else if (d0 === d1 && d1 > d2) {
        // Top 2 tied on diff, 3rd is strictly lowest.
        countTiebreak2Teams++;
        assert.equal(r1[2].teamName, sortedByDiff[2], `Iter ${iter}: last must be ${sortedByDiff[2]}`);
        const tFirst = sortedByDiff[0];
        const tSecond = sortedByDiff[1];
        const h2h = directHeadToHead(tFirst, tSecond, matches);
        if (h2h === -1) {
          assert.equal(r1[0].teamName, tFirst);
          assert.equal(r1[1].teamName, tSecond);
        } else if (h2h === 1) {
          assert.equal(r1[0].teamName, tSecond);
          assert.equal(r1[1].teamName, tFirst);
        }
      } else {
        // All 3 equal diff (d0 === d1 && d1 === d2 === 0)
        countThreeWayTies++;
        // All 3 tied -> broken by miniPointsFor, then overall, then alphabetical
        assert.equal(r1.length, 3);
      }
    }

    assert.ok(countClearWinner > 200, `Expected many clear winner cases, got ${countClearWinner}`);
    assert.ok(countTiebreak2Teams > 20, `Expected some 2-way tie cases, got ${countTiebreak2Teams}`);
  });
});

describe('STRESS TEST 2: Whitespace Adversarial Inputs (Leading/Trailing Spaces, Tabs, Newlines)', () => {
  test('Tied teams with surrounding whitespace in 3-team circular tie', () => {
    // 3 teams with asymmetric whitespace
    const tA = '  Team A   ';
    const tB = '\tTeam B\t';
    const tC = '\nTeam C \r\n';

    // A beat B: 11-2 (+9)
    // B beat C: 11-7 (+4)
    // C beat A: 11-6 (+5)
    // MiniDiffs: A: +4, C: +1, B: -5.
    // Order must be A, C, B.
    const matches = [
      { groupName: 'G', teamA: tA, teamB: tB, scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { groupName: 'G', teamA: tB, teamB: tC, scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'G', teamA: tC, teamB: tA, scoreA: 11, scoreB: 6, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const rows = rankings[0].rows;

    const trimmedOrder = rows.map((r) => r.teamName.trim());
    assert.deepEqual(trimmedOrder, ['Team A', 'Team C', 'Team B']);
  });

  test('sortGroupRowsWithHeadToHead when matches have different whitespace padding than rows', () => {
    // Rows have one padding, matches have completely different padding or no padding
    const rows = [
      { teamName: '   Team Alpha   ', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 17, pointsAgainst: 8, pointDiff: 9 },
      { teamName: '\tTeam Beta\t', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 18, pointDiff: 0 },
      { teamName: 'Team Gamma', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 13, pointsAgainst: 22, pointDiff: -9 },
    ];

    // Matches with NO whitespace or mixed whitespace:
    // Alpha beat Beta 11-2
    // Beta beat Gamma 11-7
    // Gamma beat Alpha 11-6
    // MiniDiffs: Alpha: +4, Gamma: +1, Beta: -5
    const matches = [
      { teamA: 'Team Alpha', teamB: 'Team Beta', scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { teamA: 'Team Beta', teamB: 'Team Gamma', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { teamA: 'Team Gamma', teamB: 'Team Alpha', scoreA: 11, scoreB: 6, status: 'FINISHED' },
    ];

    const sorted = sortGroupRowsWithHeadToHead(rows, matches);
    const names = sorted.map((r) => r.teamName.trim());
    assert.deepEqual(names, ['Team Alpha', 'Team Gamma', 'Team Beta']);
  });

  test('directHeadToHead handles mismatched whitespace, tabs, and newlines', () => {
    const matches = [
      { teamA: ' Alpha \t', teamB: '\nBeta ', scoreA: 11, scoreB: 5, status: 'FINISHED' },
    ];

    assert.equal(directHeadToHead('Alpha', 'Beta', matches), -1);
    assert.equal(directHeadToHead(' Beta ', '  Alpha  ', matches), 1);
    assert.equal(directHeadToHead('\tAlpha\n', 'Beta', matches), -1);
  });

  test('sortGroupRowsWithHeadToHead with whitespace in rows and matches preserves original names', () => {
    const rows = [
      { teamName: '  Alpha  ', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 4, pointDiff: 7 },
      { teamName: '\tBeta\t', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 0, pointDiff: 11 },
    ];
    // Alpha beat Beta in direct match 11-4
    const matches = [
      { teamA: 'Alpha', teamB: 'Beta', scoreA: 11, scoreB: 4, status: 'FINISHED' },
    ];

    const sorted = sortGroupRowsWithHeadToHead(rows, matches);
    // Alpha beat Beta directly, so Alpha ranks #1 despite lower overall pointDiff (+7 vs +11)
    assert.equal(sorted[0].teamName, '  Alpha  ');
    assert.equal(sorted[1].teamName, '\tBeta\t');
  });

  test('aggregateCrossGroupStandings with whitespace in team names', () => {
    const groups = [
      {
        groupName: 'A',
        rows: [
          { teamName: '  Team A1  ', won: 2, pointDiff: 10, pointsFor: 22, pointsAgainst: 12, played: 2, lost: 0, rankingPoints: 2 },
          { teamName: '\tTeam A2\t', won: 1, pointDiff: 2, pointsFor: 18, pointsAgainst: 16, played: 2, lost: 1, rankingPoints: 1 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: ' Team B1 ', won: 2, pointDiff: 12, pointsFor: 24, pointsAgainst: 12, played: 2, lost: 0, rankingPoints: 2 },
          { teamName: 'Team B2', won: 1, pointDiff: 4, pointsFor: 19, pointsAgainst: 15, played: 2, lost: 1, rankingPoints: 1 },
        ],
      },
    ];

    const res = aggregateCrossGroupStandings(groups, [], 1, 3);
    assert.deepEqual(res.directlyQualified, ['  Team A1  ', ' Team B1 ']);
    assert.equal(res.shortage, 1);
    assert.equal(res.suggested.length, 1);
    // Between A2 and B2: both groupRank 2, won 1, B2 has pointDiff 4 vs A2 pointDiff 2 -> B2 suggested
    assert.equal(res.suggested[0].teamName, 'Team B2');
  });
});

describe('STRESS TEST 3: Null, Undefined, Malformed Objects & Boundary Arrays', () => {
  test('buildHeadToHeadMap resilience against null, undefined, empty, and malformed elements', () => {
    assert.doesNotThrow(() => buildHeadToHeadMap());
    assert.doesNotThrow(() => buildHeadToHeadMap(null));
    assert.doesNotThrow(() => buildHeadToHeadMap(undefined));
    assert.doesNotThrow(() => buildHeadToHeadMap('not-an-array'));
    assert.doesNotThrow(() => buildHeadToHeadMap(12345));

    const malformed = [
      null,
      undefined,
      {},
      { teamA: null, teamB: 'B' },
      { teamA: 'A', teamB: null },
      { teamA: '', teamB: 'B' },
      { teamA: 'A', teamB: 'B', status: 'PENDING' },
      { teamA: 'ValidA', teamB: 'ValidB', scoreA: 11, scoreB: 5, status: 'FINISHED' },
    ];
    const map = buildHeadToHeadMap(malformed);
    assert.equal(map.size, 1);
    assert.ok(map.has(pairKey('ValidA', 'ValidB')));
  });

  test('directHeadToHead resilience against null, undefined, and non-array inputs', () => {
    assert.equal(directHeadToHead(null, 'B', []), 0);
    assert.equal(directHeadToHead('A', null, []), 0);
    assert.equal(directHeadToHead(undefined, undefined, []), 0);
    assert.equal(directHeadToHead('A', 'B', null), 0);
    assert.equal(directHeadToHead('A', 'B', undefined), 0);
    assert.equal(directHeadToHead('A', 'B', 'invalid'), 0);
    assert.equal(directHeadToHead('', 'B', []), 0);
    assert.equal(directHeadToHead('   ', '   ', []), 0);
  });

  test('compareWithHeadToHead resilience against null and undefined matches', () => {
    const rowA = { teamName: 'A', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 };
    const rowB = { teamName: 'B', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 8, pointDiff: 3 };

    assert.doesNotThrow(() => compareWithHeadToHead(rowA, rowB, null));
    assert.doesNotThrow(() => compareWithHeadToHead(rowA, rowB, undefined));

    const cmp = compareWithHeadToHead(rowA, rowB, null);
    // Tied on won, no H2H matches, A has higher pointDiff (+6 vs +3) -> A ranks higher (cmp < 0)
    assert.ok(cmp < 0);
  });

  test('sortGroupRowsWithHeadToHead resilience against null, undefined, empty, and non-array rows', () => {
    assert.deepEqual(sortGroupRowsWithHeadToHead(null, []), []);
    assert.deepEqual(sortGroupRowsWithHeadToHead(undefined, []), []);
    assert.deepEqual(sortGroupRowsWithHeadToHead([], null), []);
    assert.deepEqual(sortGroupRowsWithHeadToHead([], undefined), []);
    assert.deepEqual(sortGroupRowsWithHeadToHead('invalid', []), []);

    const rowA = { teamName: 'A', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 };
    const sorted = sortGroupRowsWithHeadToHead([rowA], null);
    assert.deepEqual(sorted, [rowA]);
  });

  test('aggregateCrossGroupStandings resilience against null, undefined, negative parameters', () => {
    assert.doesNotThrow(() => aggregateCrossGroupStandings(null, null, null, null));
    assert.doesNotThrow(() => aggregateCrossGroupStandings(undefined, undefined, undefined, undefined));
    assert.doesNotThrow(() => aggregateCrossGroupStandings([], [], -10, -5));

    const emptyRes = aggregateCrossGroupStandings(null, null, 2, 8);
    assert.deepEqual(emptyRes.directlyQualified, []);
    assert.equal(emptyRes.shortage, 8);
    assert.deepEqual(emptyRes.suggested, []);
    assert.deepEqual(emptyRes.candidates, []);
    assert.deepEqual(emptyRes.crossGroupStandings, []);

    // Malformed groups array containing null, undefined, empty objects
    const malformedGroups = [
      null,
      undefined,
      {},
      { groupName: 'Valid', rows: null },
      { groupName: 'G1', rows: [{ teamName: 'T1', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 0, pointDiff: 11 }] },
    ];
    const res = aggregateCrossGroupStandings(malformedGroups, null, 1, 2);
    assert.deepEqual(res.directlyQualified, ['T1']);
    assert.equal(res.shortage, 1);
  });
});
