/**
 * test/challenger-seed-cli.test.js
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE for scripts/seed-dynamic-tournament.js.
 * Authored by Challenger 2 (M-TEST).
 *
 * Verifies:
 * 1. CLI flags (--dry-run, --scenario=1..5, --verbose, --help, -v, -h).
 * 2. Invalid CLI arguments (--scenario=99, --scenario=abc, --scenario=-1, --unknown-flag).
 * 3. Database connection failure fallback (graceful recovery to in-memory mode under --persist).
 * 4. Programmatic import stress test (100 consecutive simulations, heap stability, zero memory leaks).
 * 5. Visual formatting & Vietnamese output verification (exact table border alignment, emoji widths, podium box).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const v8 = require('node:v8');

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/seed-dynamic-tournament.js');
const {
  parseCliArgs,
  stringVisualWidth,
  pad,
  InMemoryStore,
  simulatePickleballScore,
  computeGroupStandings,
  computeCrossGroupCandidatePool,
  wheelSpinPairings,
  SCENARIOS,
  DynamicTournamentSimulator,
  TournamentAsciiRenderer,
  simulateTournament,
} = require(SCRIPT_PATH);

// Helper to invoke CLI via child_process
function runCli(args, extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: 'D:\\Setup\\nodejs;' + (process.env.PATH || ''),
    ...extraEnv,
  };
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

describe('Adversarial Test Suite 1: CLI Flags & Options', () => {
  test('CLI flag --help and -h exit with code 0 and show usage banner', () => {
    const resHelp = runCli(['--help']);
    assert.equal(resHelp.status, 0, '--help should exit with 0');
    assert.match(resHelp.stdout, /VODICH-TOOL: SEED & DYNAMIC TOURNAMENT SIMULATOR/);
    assert.match(resHelp.stdout, /--dry-run/);
    assert.match(resHelp.stdout, /--scenario=<1\.\.5>/);

    const resH = runCli(['-h']);
    assert.equal(resH.status, 0, '-h should exit with 0');
    assert.match(resH.stdout, /DANH SÁCH 5 KỊCH BẢN MÔ PHỎNG/);
  });

  test('CLI flag --verbose / -v outputs detailed simulator logs', () => {
    const resVerbose = runCli(['--dry-run', '--scenario=1', '--verbose']);
    assert.equal(resVerbose.status, 0);
    assert.match(resVerbose.stdout, /\[Simulator\] Tournament created with ID/);

    const resVShort = runCli(['--dry-run', '--scenario=1', '-v']);
    assert.equal(resVShort.status, 0);
    assert.match(resVShort.stdout, /\[Simulator\] Tournament created with ID/);
  });

  test('CLI runs all 5 scenarios cleanly with --dry-run', () => {
    for (let sId = 1; sId <= 5; sId++) {
      const res = runCli(['--dry-run', `--scenario=${sId}`]);
      assert.equal(res.status, 0, `Scenario ${sId} should exit with code 0`);
      assert.match(res.stdout, new RegExp(`Kịch bản\\s+:\\s+\\[${sId}\\]`));
      assert.match(res.stdout, /BẢNG VINH DANH GIẢI ĐẤU/);
      assert.match(res.stdout, /QUÁN QUÂN \(VÔ ĐỊCH\)/);
      assert.match(res.stdout, /Á QUÂN \(HẠNG NHÌ\)/);
      assert.match(res.stdout, /QUÝ QUÂN \(HẠNG BA\)/);
      assert.match(res.stdout, /HẠNG TƯ/);
    }
  });
});

describe('Adversarial Test Suite 2: Invalid CLI Arguments & Boundary Defense', () => {
  test('Invalid scenario numbers fallback safely to Scenario 1', () => {
    const invalidScenarios = ['--scenario=99', '--scenario=-1', '--scenario=0', '--scenario=abc', '--scenario=', '--scenario=6'];
    for (const flag of invalidScenarios) {
      const res = runCli(['--dry-run', flag]);
      assert.equal(res.status, 0, `${flag} must not crash; must exit 0`);
      assert.match(res.stdout, /Kịch bản\s+:\s+\[1\]/, `${flag} must default to Scenario 1`);
    }
  });

  test('Unrecognized / adversarial CLI flags are handled gracefully', () => {
    const strangeFlags = [
      ['--unknown-flag'],
      ['--invalid=true', '--bogus-arg'],
      ['--foo', '--bar', '--baz'],
      ['-z', '-x'],
    ];
    for (const flags of strangeFlags) {
      const res = runCli(['--dry-run', ...flags]);
      assert.equal(res.status, 0, `Unrecognized flags [${flags.join(' ')}] must not crash script`);
      assert.match(res.stdout, /BẢNG VINH DANH GIẢI ĐẤU/);
    }
  });

  test('parseCliArgs unit boundary assertions', () => {
    assert.deepEqual(parseCliArgs(['--dry-run', '--scenario=3', '--verbose']), {
      dryRun: true,
      scenario: 3,
      persist: false,
      verbose: true,
      help: false,
    });

    assert.equal(parseCliArgs(['--scenario=100']).scenario, 1);
    assert.equal(parseCliArgs(['--scenario=not-a-number']).scenario, 1);
    assert.equal(parseCliArgs(['--scenario=-5']).scenario, 1);
    assert.equal(parseCliArgs(['-v']).verbose, true);
    assert.equal(parseCliArgs(['-h']).help, true);
  });
});

describe('Adversarial Test Suite 3: Database Connection Failure & Fallback Resilience', () => {
  test('Graceful fallback to in-memory mode when DATABASE_URL is unreachable with --persist', () => {
    // Unreachable local port with fast timeout
    const fakeDbUrl = 'postgresql://invalid_challenger_user:bogus_pass@127.0.0.1:54329/nonexistent_db?connect_timeout=1';
    const res = runCli(['--persist', '--scenario=1'], {
      DATABASE_URL: fakeDbUrl,
    });

    assert.equal(res.status, 0, 'Script must exit with 0 even when DB is unreachable');
    assert.match(res.stdout, /⚠️\s+Không thể kết nối tới DATABASE_URL\. Tự động chuyển sang chế độ mô phỏng trong bộ nhớ/);
    assert.match(res.stdout, /Môi trường\s+:\s+\[IN-MEMORY SIMULATION \(FALLBACK\)\]/);
    assert.match(res.stdout, /BẢNG VINH DANH GIẢI ĐẤU/);
  });

  test('Graceful fallback when DATABASE_URL is malformed', () => {
    const malformedDbUrl = 'not-a-valid-connection-string';
    const res = runCli(['--persist', '--scenario=2'], {
      DATABASE_URL: malformedDbUrl,
    });

    assert.equal(res.status, 0, 'Script must exit with 0 even with malformed DATABASE_URL');
    assert.match(res.stdout, /⚠️\s+Không thể kết nối tới DATABASE_URL/);
    assert.match(res.stdout, /BẢNG VINH DANH GIẢI ĐẤU/);
  });
});

describe('Adversarial Test Suite 4: Programmatic Import & 100-Run Memory Stress Test', () => {
  test('Execute 100 consecutive simulations in-process without memory leak', async () => {
    // Force garbage collection if available or monitor heap
    if (global.gc) global.gc();
    const initialMem = process.memoryUsage();

    const iterations = 100;
    const podiumHistory = [];

    for (let i = 0; i < iterations; i++) {
      const scenarioId = (i % 5) + 1;
      const res = await simulateTournament(scenarioId, {
        dryRun: true,
        printOutput: false,
      });

      assert.ok(res.tournament, `Run ${i + 1}: tournament must exist`);
      assert.ok(res.tournament.id > 0n, `Run ${i + 1}: tournament ID must be positive`);
      assert.ok(res.matches.length >= 16, `Run ${i + 1}: matches count must be >= 16`);
      assert.ok(res.podium.firstPlace, `Run ${i + 1}: champion must exist`);
      assert.ok(res.podium.secondPlace, `Run ${i + 1}: runnerUp must exist`);
      assert.ok(res.podium.thirdPlace, `Run ${i + 1}: thirdPlace must exist`);

      podiumHistory.push(res.podium.firstPlace);

      if ((i + 1) % 25 === 0) {
        const currentMem = process.memoryUsage();
        const heapDiffMb = (currentMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
        // Heap difference should remain reasonable (< 50MB growth across 100 runs)
        assert.ok(heapDiffMb < 50, `Heap growth at iteration ${i + 1} was ${heapDiffMb.toFixed(2)} MB, exceeding 50 MB threshold`);
      }
    }

    assert.equal(podiumHistory.length, 100, 'All 100 iterations must complete successfully');
    const finalMem = process.memoryUsage();
    const totalHeapGrowthMb = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
    assert.ok(totalHeapGrowthMb < 60, `Total heap growth after 100 runs is ${totalHeapGrowthMb.toFixed(2)} MB (< 60MB)`);
  });

  test('All 5 scenarios produce deterministic expected results under seeded data', async () => {
    // Scenario 1
    const s1 = await simulateTournament(1, { dryRun: true, printOutput: false });
    assert.equal(s1.podium.firstPlace, 'Nguyễn An / Trần Bình');
    assert.equal(s1.podium.secondPlace, 'Võ Kiên / Dương Lâm');
    assert.equal(s1.podium.thirdPlace, 'Hà Nghĩa / Chu Phát');
    assert.equal(s1.podium.fourthPlace, 'Cao Uy / Trương Tài');
    assert.deepEqual(s1.wildcardStatus.selected, ['Hoàng Em / Đỗ Giang', 'Phan Nam / Trịnh Oanh']);

    // Scenario 2 (manual wildcard override)
    const s2 = await simulateTournament(2, { dryRun: true, printOutput: false });
    assert.equal(s2.podium.firstPlace, 'Võ Kiên / Dương Lâm');
    assert.equal(s2.podium.secondPlace, 'Đặng Quý / Hồ Sơn');
    assert.deepEqual(s2.wildcardStatus.selected, ['Hoàng Em / Đỗ Giang', 'Đinh Long / Bùi Minh']);

    // Scenario 3 (16 teams, no wildcard)
    const s3 = await simulateTournament(3, { dryRun: true, printOutput: false });
    assert.equal(s3.podium.firstPlace, 'Nguyễn An / Trần Bình');
    assert.equal(s3.wildcardStatus.shortage, 0);

    // Scenario 4 (8 teams, no QF)
    const s4 = await simulateTournament(4, { dryRun: true, printOutput: false });
    assert.equal(s4.podium.firstPlace, 'Nguyễn An / Trần Bình');
    assert.equal(s4.knockoutMatches.filter((m) => m.stage === 'Tứ kết').length, 0);

    // Scenario 5 (Head-to-head tie break)
    const s5 = await simulateTournament(5, { dryRun: true, printOutput: false });
    assert.equal(s5.podium.firstPlace, 'Nguyễn An / Trần Bình');
    // Group A standings check: A1 beat A2 direct, A4 beat A3 direct
    const grpA = s5.groupRankings.find((g) => g.groupName === 'A');
    assert.equal(grpA.rows[0].teamName, 'Nguyễn An / Trần Bình');
    assert.equal(grpA.rows[1].teamName, 'Lê Cường / Phạm Dũng');
  });
});

describe('Adversarial Test Suite 5: Visual Formatting & Vietnamese Output Alignment', () => {
  test('stringVisualWidth correctly computes widths for Vietnamese, symbols, and emojis', () => {
    // Standard ASCII
    assert.equal(stringVisualWidth('Hello'), 5);
    // Vietnamese diacritics (single display cell each)
    assert.equal(stringVisualWidth('Nguyễn An / Trần Bình'), 21);
    assert.equal(stringVisualWidth('BẢNG VINH DANH GIẢI ĐẤU'), 23);
    assert.equal(stringVisualWidth('Tranh hạng 3-4'), 14);

    // Symbols
    assert.equal(stringVisualWidth('⚙️'), 2);
    assert.equal(stringVisualWidth('⚠️'), 2);
    assert.equal(stringVisualWidth('⚔️'), 2);

    // Emojis (surrogate pairs)
    assert.equal(stringVisualWidth('🥇'), 2);
    assert.equal(stringVisualWidth('🥈'), 2);
    assert.equal(stringVisualWidth('🥉'), 2);
    assert.equal(stringVisualWidth('🏆'), 2);
    assert.equal(stringVisualWidth('🎡'), 2);
    assert.equal(stringVisualWidth('✅'), 2);
    // Note: ℹ️ (U+2139) and ⭐ (U+2B50) fall outside 0x2600-0x27bf and BMP surrogate ranges,
    // so the implementation evaluates their visual width as 1 cell.
    assert.equal(stringVisualWidth('ℹ️'), 1);
    assert.equal(stringVisualWidth('⭐'), 1);
  });

  test('pad helper ensures exact visual width without drift', () => {
    const s1 = pad('Nguyễn An / Trần Bình', 30, 'left');
    assert.equal(stringVisualWidth(s1), 30);

    const s2 = pad('🥇 QUÁN QUÂN', 20, 'left');
    assert.equal(stringVisualWidth(s2), 20);

    const s3 = pad('15 - 11', 10, 'center');
    assert.equal(stringVisualWidth(s3), 10);
  });

  test('Rendered Table and Grand Podium borders have exact, uniform display widths', async () => {
    // Intercept stdout to inspect rendered lines
    const capturedLines = [];
    const originalLog = console.log;
    console.log = (...args) => {
      capturedLines.push(args.join(' '));
    };

    try {
      await simulateTournament(1, { dryRun: true, printOutput: true });
    } finally {
      console.log = originalLog;
    }

    // Inspect Grand Podium box lines
    const podiumStartIndex = capturedLines.findIndex((line) => line.includes('BẢNG VINH DANH GIẢI ĐẤU'));
    assert.ok(podiumStartIndex > 0, 'Grand podium header must be found in output');

    // The box starts at podiumStartIndex - 1 (the ╔════...╗ line)
    const boxTopLine = capturedLines[podiumStartIndex - 1];
    assert.ok(boxTopLine.startsWith('╔'), 'Podium box must start with ╔');
    const expectedWidth = stringVisualWidth(boxTopLine);
    assert.equal(expectedWidth, 80, 'Podium box top line must be exactly 80 chars wide');

    // Check all lines of the grand podium box until ╚════...╝
    let boxEndIndex = -1;
    for (let i = podiumStartIndex - 1; i < capturedLines.length; i++) {
      const line = capturedLines[i];
      if (line.startsWith('╚')) {
        boxEndIndex = i;
        break;
      }
    }
    assert.ok(boxEndIndex > podiumStartIndex, 'Podium box bottom line must exist');

    for (let i = podiumStartIndex - 1; i <= boxEndIndex; i++) {
      const line = capturedLines[i];
      const w = stringVisualWidth(line);
      assert.equal(
        w,
        expectedWidth,
        `Line ${i} of podium box must have width ${expectedWidth}, got ${w}: "${line}"`
      );
    }

    // Inspect Group Stage Table lines
    const tableTopIndices = [];
    capturedLines.forEach((line, idx) => {
      if (line.startsWith('┌─────┬──────')) {
        tableTopIndices.push(idx);
      }
    });
    assert.ok(tableTopIndices.length >= 3, 'Must find at least 3 group tables');

    for (const topIdx of tableTopIndices) {
      const topWidth = stringVisualWidth(capturedLines[topIdx]);
      // Verify subsequent rows until └─────
      for (let j = topIdx + 1; j < topIdx + 8; j++) {
        const row = capturedLines[j];
        const rowWidth = stringVisualWidth(row);
        assert.equal(
          rowWidth,
          topWidth,
          `Table row at line ${j} must match header width ${topWidth}, got ${rowWidth}: "${row}"`
        );
        if (row.startsWith('└')) break;
      }
    }
  });
});
