const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  TournamentScheduleBuilder,
  groupCountFor,
  groupLetter,
  groupIndexOf,
  isKnockoutStage,
  STAGE_THIRD_PLACE,
  ROUND_THIRD_PLACE,
} = require('../dist/tournaments/tournament-schedule');

function mockTournament(overrides = {}) {
  return {
    id: 1001n,
    title: 'Fuzz Tournament',
    format: 'GROUP_KNOCKOUT',
    playType: 'SINGLES',
    pairingRule: 'RANDOM',
    courtCount: 3,
    knockoutQualifierCount: 8,
    groupCount: null,
    advancePerGroup: 2,
    hasThirdPlace: true,
    ...overrides,
  };
}

describe('CHALLENGER 2 — Matrix & Fuzz Stress Testing (groupCount: -5 to 20, teamCount: 2 to 32)', () => {
  const builder = new TournamentScheduleBuilder();

  test('Fuzz 1: Exhaustive Matrix (groupCount -5..20 x teamCount 2..32) — Schedule generation & invariants', () => {
    const groupCounts = [];
    for (let g = -5; g <= 20; g++) groupCounts.push(g);

    const teamCounts = [];
    for (let t = 2; t <= 32; t++) teamCounts.push(t);

    let totalCombinations = 0;

    for (const gCount of groupCounts) {
      for (const tCount of teamCounts) {
        totalCombinations++;
        const tournament = mockTournament({
          groupCount: gCount,
          knockoutQualifierCount: 8,
          courtCount: 4,
          hasThirdPlace: true,
        });

        // 1. groupCountFor validation
        const resolvedGroups = groupCountFor(tournament, tCount);
        const maxPossibleGroups = Math.max(1, Math.floor(tCount / 2));

        assert.ok(
          Number.isInteger(resolvedGroups) && resolvedGroups >= 1,
          `groupCountFor returned invalid value ${resolvedGroups} for gCount=${gCount}, tCount=${tCount}`,
        );
        assert.ok(
          resolvedGroups <= maxPossibleGroups,
          `groupCountFor returned ${resolvedGroups} exceeding maxPossibleGroups ${maxPossibleGroups} for tCount=${tCount}`,
        );

        if (gCount > 0) {
          const expected = Math.min(gCount, maxPossibleGroups);
          assert.equal(
            resolvedGroups,
            expected,
            `Expected ${expected} groups for gCount=${gCount}, tCount=${tCount}, got ${resolvedGroups}`,
          );
        } else {
          // Negative or zero groupCount falls back to qualifier-based or max groups
          const fallback = Math.min(Math.max(1, Math.ceil(tournament.knockoutQualifierCount / 2)), maxPossibleGroups);
          assert.equal(
            resolvedGroups,
            fallback,
            `Fallback group count mismatch for gCount=${gCount}, tCount=${tCount}: expected ${fallback}, got ${resolvedGroups}`,
          );
        }

        // 2. Schedule generation execution
        const teams = Array.from({ length: tCount }, (_, i) => ({ name: `Team_${i + 1}` }));
        let matches;
        assert.doesNotThrow(() => {
          matches = builder.fromManualPairs(tournament, teams);
        }, `Schedule generation crashed for gCount=${gCount}, tCount=${tCount}`);

        assert.ok(Array.isArray(matches), 'Matches must be an array');

        // 3. Group match structural invariants
        const groupMatches = matches.filter((m) => m.stage === 'Vòng bảng');
        const expectedGroupLetters = Array.from({ length: resolvedGroups }, (_, i) => groupLetter(i));

        const presentGroups = [...new Set(groupMatches.map((m) => m.groupName))].sort();
        // Present groups must be subset of expected group letters
        for (const pg of presentGroups) {
          assert.ok(
            expectedGroupLetters.includes(pg),
            `Unexpected group ${pg} generated for gCount=${gCount}, tCount=${tCount}`,
          );
        }

        // 4. Verify no self-play and court/round limits
        const pairOccurrences = new Map();
        const teamGroups = new Map();

        for (const m of groupMatches) {
          assert.equal(m.tournamentId, tournament.id);
          assert.ok(m.teamA && m.teamB, 'Teams must not be empty');
          assert.notEqual(m.teamA, m.teamB, `Self-play detected in gCount=${gCount}, tCount=${tCount}`);
          assert.ok(
            m.courtNumber >= 1 && m.courtNumber <= tournament.courtCount,
            `Court ${m.courtNumber} out of range [1, ${tournament.courtCount}]`,
          );
          assert.ok(m.roundNumber >= 1, `Round number ${m.roundNumber} must be >= 1`);

          // Track assigned group for each team
          if (!teamGroups.has(m.teamA)) teamGroups.set(m.teamA, m.groupName);
          if (!teamGroups.has(m.teamB)) teamGroups.set(m.teamB, m.groupName);
          assert.equal(teamGroups.get(m.teamA), m.groupName, `Team ${m.teamA} played in multiple groups`);
          assert.equal(teamGroups.get(m.teamB), m.groupName, `Team ${m.teamB} played in multiple groups`);

          // Pair uniqueness in round robin
          const pKey = [m.teamA, m.teamB].sort().join(':::');
          assert.equal(
            pairOccurrences.has(pKey),
            false,
            `Duplicate match ${pKey} in gCount=${gCount}, tCount=${tCount}`,
          );
          pairOccurrences.set(pKey, true);
        }

        // 5. Verify complete round-robin graph in each non-empty group
        const groupMembers = new Map();
        for (const [team, group] of teamGroups.entries()) {
          const list = groupMembers.get(group) || [];
          list.push(team);
          groupMembers.set(group, list);
        }

        let totalExpectedGroupMatches = 0;
        for (const [group, members] of groupMembers.entries()) {
          const k = members.length;
          assert.ok(k >= 2, `Group ${group} has fewer than 2 teams (${k}) in gCount=${gCount}, tCount=${tCount}`);
          const expectedMatches = (k * (k - 1)) / 2;
          const actualGroupMatches = groupMatches.filter((m) => m.groupName === group).length;
          assert.equal(
            actualGroupMatches,
            expectedMatches,
            `Group ${group} match count mismatch for gCount=${gCount}, tCount=${tCount}: got ${actualGroupMatches}, expected ${expectedMatches}`,
          );
          totalExpectedGroupMatches += expectedMatches;
        }

        assert.equal(
          groupMatches.length,
          totalExpectedGroupMatches,
          `Total group matches mismatch for gCount=${gCount}, tCount=${tCount}`,
        );

        // 6. Knockout stages invariant (knockoutQualifierCount: 8, hasThirdPlace: true)
        const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));
        assert.equal(knockoutMatches.length, 8, `Expected 8 knockout matches, got ${knockoutMatches.length}`);
        assert.equal(knockoutMatches.filter((m) => m.stage === 'Tứ kết').length, 4);
        assert.equal(knockoutMatches.filter((m) => m.stage === 'Bán kết').length, 2);
        assert.equal(knockoutMatches.filter((m) => m.stage === 'Chung kết').length, 1);
        assert.equal(knockoutMatches.filter((m) => m.stage === STAGE_THIRD_PLACE).length, 1);
      }
    }

    assert.equal(totalCombinations, 26 * 31, `Executed exactly ${totalCombinations} combinations`);
  });

  test('Fuzz 2: 500 Randomized Configurations — Mixed Manual Group Seeding & Wild Group Letters', () => {
    let rngSeed = 424242;
    function pseudoRandom() {
      rngSeed = (rngSeed * 1664525 + 1013904223) % 4294967296;
      return rngSeed / 4294967296;
    }

    const iterations = 500;
    for (let iter = 0; iter < iterations; iter++) {
      const gCount = Math.floor(pseudoRandom() * 36) - 10; // -10 to 25
      const tCount = Math.floor(pseudoRandom() * 31) + 2;   // 2 to 32
      const courtCount = Math.floor(pseudoRandom() * 8) + 1; // 1 to 8
      const koQualifiers = [2, 4, 8][Math.floor(pseudoRandom() * 3)];
      const hasThirdPlace = pseudoRandom() > 0.5;
      const format = pseudoRandom() > 0.1 ? 'GROUP_KNOCKOUT' : 'ROUND_ROBIN';

      const tournament = mockTournament({
        format,
        groupCount: gCount,
        knockoutQualifierCount: koQualifiers,
        courtCount,
        hasThirdPlace,
      });

      // Build teams with randomized manual group assignments
      const candidateGroups = [null, undefined, '', 'A', 'B', 'C', 'D', 'E', 'Z', '??', ' a '];
      const teams = Array.from({ length: tCount }, (_, i) => {
        const assignedGroup = pseudoRandom() > 0.6 ? candidateGroups[Math.floor(pseudoRandom() * candidateGroups.length)] : null;
        return { name: `Team_${i + 1}`, group: assignedGroup };
      });

      const matches = builder.fromManualPairs(tournament, teams);
      assert.ok(Array.isArray(matches));

      const expectedStage = format === 'GROUP_KNOCKOUT' ? 'Vòng bảng' : 'Vòng tròn';
      const stageMatches = matches.filter((m) => m.stage === expectedStage);

      // Verify no self-play
      for (const m of stageMatches) {
        assert.notEqual(m.teamA, m.teamB);
        assert.ok(m.courtNumber >= 1 && m.courtNumber <= courtCount);
        assert.ok(m.roundNumber >= 1);
      }

      // Check knockout match counts
      if (format === 'GROUP_KNOCKOUT') {
        const koMatches = matches.filter((m) => isKnockoutStage(m.stage));
        let expectedKoCount = 1; // Finals always
        if (koQualifiers >= 8) expectedKoCount += 6; // 4 QF + 2 SF
        else if (koQualifiers >= 4) expectedKoCount += 2; // 2 SF
        if (koQualifiers >= 4 && hasThirdPlace) expectedKoCount += 1;

        assert.equal(
          koMatches.length,
          expectedKoCount,
          `Iteration ${iter}: Expected ${expectedKoCount} KO matches, got ${koMatches.length}`,
        );
      } else {
        // ROUND_ROBIN has no knockout
        const koMatches = matches.filter((m) => isKnockoutStage(m.stage));
        assert.equal(koMatches.length, 0);
      }
    }
  });

  test('Fuzz 3: Boundary inputs & extreme numbers (0 teams, 1 team, 100 groups, negative extreme)', () => {
    // 0 teams
    const tZero = mockTournament({ groupCount: 4 });
    const matches0 = builder.fromManualPairs(tZero, []);
    assert.equal(matches0.filter((m) => m.stage === 'Vòng bảng').length, 0);

    // 1 team
    const tOne = mockTournament({ groupCount: 4 });
    const matches1 = builder.fromManualPairs(tOne, [{ name: 'Solo' }]);
    assert.equal(matches1.filter((m) => m.stage === 'Vòng bảng').length, 0);

    // Extreme group counts: 100 groups with 10 teams -> clamped to 5 groups (10 / 2)
    const t100 = mockTournament({ groupCount: 100 });
    assert.equal(groupCountFor(t100, 10), 5);
    const matches100 = builder.fromManualPairs(t100, Array.from({ length: 10 }, (_, i) => ({ name: `T${i}` })));
    const gMatches100 = matches100.filter((m) => m.stage === 'Vòng bảng');
    const distinctGroups100 = [...new Set(gMatches100.map((m) => m.groupName))];
    assert.equal(distinctGroups100.length, 5);

    // Extreme negative group count: -9999
    const tNeg999 = mockTournament({ groupCount: -9999, knockoutQualifierCount: 4 });
    assert.equal(groupCountFor(tNeg999, 8), 2); // clamped from qualifier 4 / 2 = 2
    assert.doesNotThrow(() => {
      builder.fromManualPairs(tNeg999, Array.from({ length: 8 }, (_, i) => ({ name: `T${i}` })));
    });

    // groupIndexOf boundary checks
    assert.equal(groupIndexOf('A'), 0);
    assert.equal(groupIndexOf('z'), 25);
    assert.equal(groupIndexOf('  b  '), 1);
    assert.equal(groupIndexOf(''), -1);
    assert.equal(groupIndexOf(null), -1);
    assert.equal(groupIndexOf(undefined), -1);
    assert.equal(groupIndexOf('123'), -1);
    assert.equal(groupIndexOf('AA'), -1);
  });
});
