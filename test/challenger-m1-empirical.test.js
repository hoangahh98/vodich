'use strict';

/**
 * test/challenger-m1-empirical.test.js
 * 
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE for Milestone 1:
 * Head-to-Head & Standings Engine in `src/tournaments/tournament-ranking.ts`
 * 
 * Objectives:
 * 1. 2-team tie with opposite point diff (team with lower point diff won direct match -> must rank higher).
 * 2. 3-team circular tie: Team A beat B, B beat C, C beat A with various point margins.
 *    Verify deterministic sorting, no infinite loops, no NaN.
 * 3. 4-team complex ties: Mini-table resolution vs pointDiff fallback.
 * 4. Tied teams that have not played each other: fallback to pointDiff -> pointsFor -> teamName.
 * 5. Extreme inputs: 0 points scored, huge scores (999-998), single-team groups, empty matches list.
 * 6. Property-based randomized stress testing (500 circular ties, 200 4-team tournaments).
 * 7. Cross-group standings edge cases: shortage calculation, candidate filtering, rank priority.
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

describe('CHALLENGER M1: 2-Team Head-to-Head Tiebreaks', () => {
  test('2 teams tied on wins: direct winner with negative point diff ranks higher than loser with positive point diff', () => {
    // 4 teams in Group A: Team A, Team B, Team C, Team D.
    // Team A: beats B (11-9), beats C (11-9), loses to D (0-11) -> 2 wins, diff = -7
    // Team B: loses to A (9-11), beats C (11-0), beats D (11-0) -> 2 wins, diff = +20
    // Team C: loses to A, loses to B, beats D (11-0) -> 1 win
    // Team D: beats A, loses to B, loses to C -> 1 win
    //
    // Exactly 2 teams tied on 2 wins: Team A and Team B.
    // Team A has lower point diff (-7 vs +20).
    // But Team A won the direct match against Team B (11-9).
    // Therefore, Team A MUST rank higher than Team B!
    const matches = [
      { groupName: 'A', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 9, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team A', teamB: 'Team C', scoreA: 11, scoreB: 9, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team D', teamB: 'Team A', scoreA: 11, scoreB: 0, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 0, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team D', scoreA: 11, scoreB: 0, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team C', teamB: 'Team D', scoreA: 11, scoreB: 0, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const rows = rankings[0].rows;

    const rankA = rows.findIndex((r) => r.teamName === 'Team A');
    const rankB = rows.findIndex((r) => r.teamName === 'Team B');

    assert.equal(rankA, 0, 'Team A must be rank 1');
    assert.equal(rankB, 1, 'Team B must be rank 2');
    assert.ok(rows[rankA].pointDiff < rows[rankB].pointDiff, 'Team A has lower point diff than Team B');
  });

  test('2 teams tied on wins: split series (1-1) resolved by direct head-to-head point difference', () => {
    // Team X beat Team Y 11-4 (+7 net)
    // Team Y beat Team X 11-9 (+2 net)
    // Net direct diff: Team X (+5), Team Y (-5)
    const matches = [
      { teamA: 'Team X', teamB: 'Team Y', scoreA: 11, scoreB: 4, status: 'FINISHED' },
      { teamA: 'Team Y', teamB: 'Team X', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    const rowX = { teamName: 'Team X', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 20, pointsAgainst: 15, pointDiff: 5 };
    const rowY = { teamName: 'Team Y', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 15, pointsAgainst: 20, pointDiff: -5 };

    assert.equal(directHeadToHead('Team X', 'Team Y', matches), -1, 'Team X won direct point diff');
    assert.equal(directHeadToHead('Team Y', 'Team X', matches), 1, 'Team Y lost direct point diff');

    const sorted = sortGroupRowsWithHeadToHead([rowY, rowX], matches);
    assert.equal(sorted[0].teamName, 'Team X');
    assert.equal(sorted[1].teamName, 'Team Y');
  });

  test('2 teams tied on wins that have NOT played each other: fallback to pointDiff -> pointsFor -> teamName', () => {
    const rowHighDiff = { teamName: 'Beta', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 2, pointDiff: 9 };
    const rowLowDiff = { teamName: 'Alpha', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 8, pointDiff: 3 };

    // No matches between Alpha and Beta
    const sorted = sortGroupRowsWithHeadToHead([rowLowDiff, rowHighDiff], []);
    assert.equal(sorted[0].teamName, 'Beta', 'Beta has higher pointDiff (+9 vs +3)');
    assert.equal(sorted[1].teamName, 'Alpha');

    // Tied on pointDiff, but different pointsFor
    const rowHighPF = { teamName: 'Beta', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 20, pointsAgainst: 15, pointDiff: 5 };
    const rowLowPF = { teamName: 'Alpha', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 15, pointsAgainst: 10, pointDiff: 5 };
    const sortedPF = sortGroupRowsWithHeadToHead([rowLowPF, rowHighPF], []);
    assert.equal(sortedPF[0].teamName, 'Beta', 'Beta has higher pointsFor (20 vs 15)');

    // Tied on won, pointDiff, and pointsFor: alphabetical fallback
    const rowA = { teamName: 'Alpha', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 };
    const rowZ = { teamName: 'Zeta', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 };
    const sortedAlpha = sortGroupRowsWithHeadToHead([rowZ, rowA], []);
    assert.equal(sortedAlpha[0].teamName, 'Alpha', 'Alpha comes before Zeta alphabetically');
    assert.equal(sortedAlpha[1].teamName, 'Zeta');
  });

  test('2 teams with PENDING match: treated as not played, fall back to overall pointDiff', () => {
    const matches = [
      { teamA: 'Team 1', teamB: 'Team 2', scoreA: 0, scoreB: 0, status: 'PENDING' },
    ];
    const row1 = { teamName: 'Team 1', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 9, pointDiff: 2 };
    const row2 = { teamName: 'Team 2', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 3, pointDiff: 8 };

    const sorted = sortGroupRowsWithHeadToHead([row1, row2], matches);
    assert.equal(sorted[0].teamName, 'Team 2', 'Team 2 has higher overall pointDiff (+8 vs +2)');
    assert.equal(sorted[1].teamName, 'Team 1');
  });
});

describe('CHALLENGER M1: 3-Team Circular Ties (A > B > C > A)', () => {
  test('3-team circular tie: mini-table point differential clearly separates all 3 teams', () => {
    // A beat B 11-2 (A: +9, B: -9)
    // B beat C 11-7 (B: +4, C: -4)
    // C beat A 11-6 (C: +5, A: -5)
    //
    // Mini-wins: A=1, B=1, C=1 (circular tie)
    // Mini-diff:
    // A: (+9) + (-5) = +4
    // B: (-9) + (+4) = -5
    // C: (-4) + (+5) = +1
    // Expected order: A (+4), C (+1), B (-5)
    const matches = [
      { groupName: 'G', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team C', teamB: 'Team A', scoreA: 11, scoreB: 6, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const order = rankings[0].rows.map((r) => r.teamName);

    assert.deepEqual(order, ['Team A', 'Team C', 'Team B']);
  });

  test('3-team circular tie: top team isolated by mini-diff, remaining 2 teams broken by direct H2H', () => {
    // A beat B 11-1 (+10)
    // B beat C 11-7 (+4)
    // C beat A 11-9 (+2)
    //
    // Mini-diffs:
    // A: +10 - 2 = +8
    // B: -10 + 4 = -6
    // C: -4 + 2 = -2
    // Here all three differ: A (+8), C (-2), B (-6).
    // Now let us construct where 2 teams have EXACT SAME miniDiff:
    // A beat B 11-5 (+6)
    // B beat C 11-8 (+3)
    // C beat A 11-8 (+3)
    // Mini-diffs:
    // A: (+6) - 3 = +3
    // B: (-6) + 3 = -3
    // C: (-3) + 3 = 0
    // Wait, let's make two teams equal miniDiff:
    // Need: diffA + diffB + diffC = 0.
    // If diffA = +4, then diffB and diffC can be -2, -2!
    // Let's solve:
    // A vs B: A wins by X
    // B vs C: B wins by Y
    // C vs A: C wins by Z
    // miniDiff(A) = X - Z
    // miniDiff(B) = Y - X
    // miniDiff(C) = Z - Y
    // For miniDiff(B) = miniDiff(C) = -2 and miniDiff(A) = +4:
    // Y - X = -2 => X - Y = 2
    // Z - Y = -2 => Y - Z = 2
    // X - Z = (X - Y) + (Y - Z) = 2 + 2 = 4! Perfect!
    // Choose:
    // Z = 3 -> C beat A by 3: 11 - 8
    // Y = 5 -> B beat C by 5: 11 - 6
    // X = 7 -> A beat B by 7: 11 - 4
    // Check:
    // A: +7 (vs B) - 3 (vs C) = +4
    // B: -7 (vs A) + 5 (vs C) = -2
    // C: -5 (vs B) + 3 (vs A) = -2
    // B and C are tied on miniDiff (-2).
    // Direct match between B and C: B beat C (11-6)!
    // Therefore, B MUST rank above C!
    // Expected order: Team A, Team B, Team C!
    const matches = [
      { groupName: 'G', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 4, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 6, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team C', teamB: 'Team A', scoreA: 11, scoreB: 8, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const order = rankings[0].rows.map((r) => r.teamName);

    assert.deepEqual(order, ['Team A', 'Team B', 'Team C'], 'A is +4, B and C tied on -2, B beat C directly so B before C');
  });

  test('3-team circular tie: perfectly identical margins (all 11-9), fallback to alphabetical order', () => {
    // A beat B 11-9 (+2)
    // B beat C 11-9 (+2)
    // C beat A 11-9 (+2)
    // Mini-diffs:
    // A: +2 - 2 = 0
    // B: +2 - 2 = 0
    // C: +2 - 2 = 0
    // Mini-points-for:
    // A: 11 + 9 = 20
    // B: 11 + 9 = 20
    // C: 11 + 9 = 20
    // All metrics perfectly equal!
    // Must fall back to alphabetical teamName: Team A, Team B, Team C.
    const matches = [
      { groupName: 'G', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 9, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 9, status: 'FINISHED' },
      { groupName: 'G', teamA: 'Team C', teamB: 'Team A', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const order = rankings[0].rows.map((r) => r.teamName);

    assert.deepEqual(order, ['Team A', 'Team B', 'Team C']);
  });

  test('3-team circular tie: randomized property-based stress test (500 iterations)', () => {
    // Stress test: random scorelines in 3-team circular ties
    // Invariants:
    // 1. Array length === 3
    // 2. Contains all 3 teams
    // 3. Deterministic (sorting twice gives same order)
    // 4. No NaN or undefined in any row
    // 5. Arithmetic pointDiff === pointsFor - pointsAgainst
    const teams = ['Đỏ', 'Vàng', 'Xanh'];
    const calc = new TournamentRankingCalculator();

    for (let iter = 0; iter < 500; iter++) {
      const sAB_A = 11;
      const sAB_B = Math.floor(Math.random() * 10); // 0..9 (A wins)

      const sBC_B = 11;
      const sBC_C = Math.floor(Math.random() * 10); // 0..9 (B wins)

      const sCA_C = 11;
      const sCA_A = Math.floor(Math.random() * 10); // 0..9 (C wins)

      const matches = [
        { groupName: 'X', teamA: teams[0], teamB: teams[1], scoreA: sAB_A, scoreB: sAB_B, status: 'FINISHED' },
        { groupName: 'X', teamA: teams[1], teamB: teams[2], scoreA: sBC_B, scoreB: sBC_C, status: 'FINISHED' },
        { groupName: 'X', teamA: teams[2], teamB: teams[0], scoreA: sCA_C, scoreB: sCA_A, status: 'FINISHED' },
      ];

      const r1 = calc.rankingsWithHeadToHead(matches)[0].rows;
      const r2 = calc.rankingsWithHeadToHead(matches)[0].rows;

      assert.equal(r1.length, 3, `Iteration ${iter}: must have 3 rows`);
      const names = r1.map((r) => r.teamName);
      for (const t of teams) {
        assert.ok(names.includes(t), `Iteration ${iter}: missing team ${t}`);
      }

      // Idempotency / determinism
      assert.deepEqual(r1.map((r) => r.teamName), r2.map((r) => r.teamName), `Iteration ${iter}: non-deterministic ranking`);

      // Integrity
      for (const row of r1) {
        assert.ok(!Number.isNaN(row.pointDiff), `Iteration ${iter}: pointDiff is NaN`);
        assert.ok(!Number.isNaN(row.pointsFor), `Iteration ${iter}: pointsFor is NaN`);
        assert.ok(!Number.isNaN(row.pointsAgainst), `Iteration ${iter}: pointsAgainst is NaN`);
        assert.equal(row.pointDiff, row.pointsFor - row.pointsAgainst, `Iteration ${iter}: pointDiff arithmetic mismatch`);
      }
    }
  });
});

describe('CHALLENGER M1: 4-Team Complex Ties & Round Robin', () => {
  test('4 teams tied on 2 wins: mini-table resolves into distinct ranks', () => {
    // 5-team group: A, B, C, D, E.
    // E loses to everyone (0 wins).
    // A, B, C, D all beat E (1 win from E each).
    // Inside the 4-team subset:
    // A beat B (11-5) and C (11-5) and D (11-5) -> A has 3 mini-wins (4 wins total)
    // Wait, let's create a 4-team tie where each has 2 wins:
    // Round-robin among 4 teams (A, B, C, D): 6 matches total.
    // Cycle:
    // A beat B (11-5)
    // B beat C (11-5)
    // C beat D (11-5)
    // D beat A (11-5)
    // Extra matches:
    // A beat C (11-2)
    // D beat B (11-2)
    // Let's count wins:
    // A: beat B, beat C (lost to D) -> 2 wins
    // B: beat C (lost to A, lost to D) -> 1 win
    // C: beat D (lost to A, lost to B) -> 1 win
    // D: beat A, beat B (lost to C) -> 2 wins
    // A and D have 2 wins; B and C have 1 win.
    // Between A and D (tied on 2 wins): D beat A (11-5)!
    // So D MUST rank above A!
    // Between B and C (tied on 1 win): B beat C (11-5)!
    // So B MUST rank above C!
    // Overall order: D, A, B, C!
    const matches = [
      { groupName: 'A', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team C', teamB: 'Team D', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team D', teamB: 'Team A', scoreA: 11, scoreB: 5, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team A', teamB: 'Team C', scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team D', teamB: 'Team B', scoreA: 11, scoreB: 2, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const order = rankings[0].rows.map((r) => r.teamName);

    assert.deepEqual(order, ['Team D', 'Team A', 'Team B', 'Team C'], 'D beat A (2-win tiebreak), B beat C (1-win tiebreak)');
  });

  test('4 teams in a 4-way circular tie (A>B, B>C, C>D, D>A, A-C split, B-D split) resolves without infinite loop', () => {
    // 4 teams, each plays each other.
    // A beat B (11-8), B beat C (11-8), C beat D (11-8), D beat A (11-8)
    // A beat C (11-6), C beat A (wait, round robin has 1 match between A and C):
    // Let's say:
    // A beat B (11-7)
    // B beat C (11-7)
    // C beat D (11-7)
    // D beat A (11-7)
    // A beat C (11-9) -> A has 2 wins
    // B beat D (11-9) -> B has 2 wins
    // C beat A? (already played)
    // Now D vs B: B beat D (11-9).
    // Let's check records:
    // A: beat B, beat C, lost to D -> 2 wins
    // B: beat C, beat D, lost to A -> 2 wins
    // C: beat D, lost to B, lost to A -> 1 win
    // D: beat A, lost to C, lost to B -> 1 win
    // A and B both have 2 wins. Direct match: A beat B (11-7). A ranks before B.
    // C and D both have 1 win. Direct match: C beat D (11-7). C ranks before D.
    // Expected order: A, B, C, D
    const matches = [
      { groupName: 'A', teamA: 'Team A', teamB: 'Team B', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team C', teamB: 'Team D', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team D', teamB: 'Team A', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team A', teamB: 'Team C', scoreA: 11, scoreB: 9, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team D', scoreA: 11, scoreB: 9, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const order = rankings[0].rows.map((r) => r.teamName);

    assert.deepEqual(order, ['Team A', 'Team B', 'Team C', 'Team D']);
  });
});

describe('CHALLENGER M1: Extreme & Boundary Inputs', () => {
  test('Empty matches list: returns empty ranking groups or handles empty gracefully', () => {
    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead([]);
    assert.deepEqual(rankings, [], 'Empty matches returns empty groups');

    // Direct sort of empty rows
    const sorted = sortGroupRowsWithHeadToHead([], []);
    assert.deepEqual(sorted, [], 'Empty rows returns empty array');
  });

  test('Single match with 0 points scored (0 - 0)', () => {
    const matches = [
      { groupName: 'A', teamA: 'Team Zero', teamB: 'Team Zilch', scoreA: 0, scoreB: 0, status: 'FINISHED' },
    ];
    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const rows = rankings[0].rows;

    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.pointsFor, 0);
      assert.equal(r.pointsAgainst, 0);
      assert.equal(r.pointDiff, 0);
      assert.equal(r.won, 0);
    }
    // Alphabetical tiebreak
    assert.equal(rows[0].teamName, 'Team Zero');
    assert.equal(rows[1].teamName, 'Team Zilch');
  });

  test('Extreme scores: huge numbers (9999 vs 9998) without overflow or NaN', () => {
    const matches = [
      { groupName: 'A', teamA: 'Giant A', teamB: 'Giant B', scoreA: 9999, scoreB: 9998, status: 'FINISHED' },
    ];
    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const rows = rankings[0].rows;

    assert.equal(rows[0].teamName, 'Giant A');
    assert.equal(rows[0].pointDiff, 1);
    assert.equal(rows[1].teamName, 'Giant B');
    assert.equal(rows[1].pointDiff, -1);
  });

  test('Vietnamese accent preservation and locale sorting', () => {
    // 4 teams with identical 0-0 records, sorted by Vietnamese locale
    const rows = [
      { teamName: 'Đà Nẵng', played: 0, won: 0, lost: 0, rankingPoints: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 },
      { teamName: 'Cần Thơ', played: 0, won: 0, lost: 0, rankingPoints: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 },
      { teamName: 'Hà Nội', played: 0, won: 0, lost: 0, rankingPoints: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 },
      { teamName: 'Bình Định', played: 0, won: 0, lost: 0, rankingPoints: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 },
    ];

    const sorted = sortGroupRowsWithHeadToHead(rows, []);
    const expected = [...rows].sort((a, b) => a.teamName.localeCompare(b.teamName));
    assert.deepEqual(sorted.map((r) => r.teamName), expected.map((r) => r.teamName));
  });

  test('Whitespace in team names: untrimmed teamName in mini-table causes score inversion (BUG REPRODUCTION)', () => {
    // 3 teams with leading/trailing whitespace in team names
    // Team A has leading/trailing spaces: ' Team A '
    // A beat B: 11-2 (+9)
    // B beat C: 11-7 (+4)
    // C beat A: 11-6 (+5)
    // Expected MiniDiff: Team A (+4), Team C (+1), Team B (-5)
    // Expected ranking order: ['Team A', 'Team C', 'Team B']
    //
    // BUG IN src/tournaments/tournament-ranking.ts:273:
    // `const isAFirst = m.teamA.trim() === tA;`
    // Because `tA` is ' Team A ' (untrimmed) and `m.teamA.trim()` is 'Team A',
    // `isAFirst` evaluates to false, inverting the scores of Team A and Team B.
    const matches = [
      { groupName: 'A', teamA: ' Team A ', teamB: 'Team B', scoreA: 11, scoreB: 2, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team B', teamB: 'Team C', scoreA: 11, scoreB: 7, status: 'FINISHED' },
      { groupName: 'A', teamA: 'Team C', teamB: ' Team A ', scoreA: 11, scoreB: 6, status: 'FINISHED' },
    ];

    const calc = new TournamentRankingCalculator();
    const rankings = calc.rankingsWithHeadToHead(matches);
    const names = rankings[0].rows.map((r) => r.teamName.trim());

    // Check if the bug manifests:
    const bugManifested = (names[0] === 'Team B' && names[2] === 'Team A');
    assert.ok(!bugManifested, 'BUG DETECTED: Untrimmed tA caused mini-table score inversion (Team B ranked #1 instead of Team A)');
  });

  test('Null-safety: undefined finishedMatches in aggregateCrossGroupStandings throws TypeError (BUG REPRODUCTION)', () => {
    // Two groups with 2nd-place teams having identical records
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

    // If caller passes undefined for finishedMatches, directHeadToHead crashes with TypeError
    let crashed = false;
    try {
      aggregateCrossGroupStandings(groups, undefined, 1, 4);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('filter')) {
        crashed = true;
      }
    }

    assert.ok(!crashed, 'BUG DETECTED: aggregateCrossGroupStandings crashed when finishedMatches was undefined');
  });

  test('Self-match or identical team names: directHeadToHead returns 0 safely', () => {
    assert.equal(directHeadToHead('Team Same', 'Team Same', []), 0);
  });

  test('pairKey is symmetric and normalizes whitespace', () => {
    assert.equal(pairKey('Team A', 'Team B'), pairKey('Team B', 'Team A'));
    assert.equal(pairKey('  Team A  ', 'Team B'), pairKey('Team B', 'Team A'));
  });
});

describe('CHALLENGER M1: Cross-Group Standings & Wildcard Aggregation', () => {
  test('Cross-group standings strictly preserves group finishing rank priority', () => {
    // Group A:
    // Rank 1: A1 (2 wins, +10 diff)
    // Rank 2: A2 (1 win, +2 diff)
    // Rank 3: A3 (0 wins, -12 diff)
    //
    // Group B:
    // Rank 1: B1 (3 wins, +20 diff)
    // Rank 2: B2 (2 wins, +5 diff)
    // Rank 3: B3 (1 win, -5 diff)
    //
    // Even though B2 has 2 wins and A2 has 1 win:
    // Both A1 and B1 must be directlyQualified (advancePerGroup = 2 -> total 4).
    // Next in line must be groupRank 2 teams (B2, A2), then groupRank 3 teams (B3, A3).
    // A 3rd-place team (B3) with 1 win must NEVER rank above a 2nd-place team (A2) even if B3 had better stats!
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 2, won: 2, lost: 0, rankingPoints: 2, pointsFor: 22, pointsAgainst: 12, pointDiff: 10 },
          { teamName: 'A2', played: 2, won: 1, lost: 1, rankingPoints: 1, pointsFor: 18, pointsAgainst: 16, pointDiff: 2 },
          { teamName: 'A3', played: 2, won: 0, lost: 2, rankingPoints: 0, pointsFor: 10, pointsAgainst: 22, pointDiff: -12 },
        ],
      },
      {
        groupName: 'B',
        rows: [
          { teamName: 'B1', played: 3, won: 3, lost: 0, rankingPoints: 3, pointsFor: 33, pointsAgainst: 13, pointDiff: 20 },
          { teamName: 'B2', played: 3, won: 2, lost: 1, rankingPoints: 2, pointsFor: 28, pointsAgainst: 23, pointDiff: 5 },
          { teamName: 'B3', played: 3, won: 1, lost: 2, rankingPoints: 1, pointsFor: 20, pointsAgainst: 25, pointDiff: -5 },
        ],
      },
    ];

    const result = aggregateCrossGroupStandings(rankingGroups, [], 2, 6);

    assert.deepEqual(result.directlyQualified, ['A1', 'A2', 'B1', 'B2']);
    assert.equal(result.shortage, 2);
    assert.deepEqual(result.suggested.map((r) => r.teamName), ['B3', 'A3']);
  });

  test('Shortage calculation with zero or negative targetKnockoutCount', () => {
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 },
        ],
      },
    ];

    const resZero = aggregateCrossGroupStandings(rankingGroups, [], 1, 0);
    assert.equal(resZero.shortage, 0);
    assert.deepEqual(resZero.suggested, []);

    const resNeg = aggregateCrossGroupStandings(rankingGroups, [], 1, -5);
    assert.equal(resNeg.shortage, 0);
    assert.deepEqual(resNeg.suggested, []);
  });

  test('Shortage exceeding total remaining candidates handles gracefully without crashing', () => {
    const rankingGroups = [
      {
        groupName: 'A',
        rows: [
          { teamName: 'A1', played: 1, won: 1, lost: 0, rankingPoints: 1, pointsFor: 11, pointsAgainst: 5, pointDiff: 6 },
          { teamName: 'A2', played: 1, won: 0, lost: 1, rankingPoints: 0, pointsFor: 5, pointsAgainst: 11, pointDiff: -6 },
        ],
      },
    ];

    // Need 8 teams, but only 2 teams exist in tournament!
    const res = aggregateCrossGroupStandings(rankingGroups, [], 1, 8);
    assert.equal(res.directlyQualified.length, 1);
    assert.equal(res.shortage, 7);
    assert.equal(res.candidates.length, 1);
    assert.equal(res.suggested.length, 1);
    assert.equal(res.suggested[0].teamName, 'A2');
  });
});
