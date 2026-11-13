#!/usr/bin/env node
/**
 * scripts/seed-dynamic-tournament.js
 *
 * Publication-Grade Dynamic Tournament CLI Simulator & Database Seeder.
 * Supports 100% offline in-memory execution (--dry-run) and live database persistence (--persist).
 * Exercises complete lifecycle:
 *   1. Dynamic tournament & group creation
 *   2. Realistic group stage matches (touchScore 11, maxScore 15)
 *   3. Group standings calculation with Head-to-Head tiebreak resolution
 *   4. Shortage detection & cross-group aggregate wildcard suggestion / selection
 *   5. Quarterfinals wheel spin pairing (8 teams, 4 matches, stage 'Tứ kết', round 100)
 *   6. Semifinals progression ('FIXED' QF1-QF2 vs 'WHEEL' random draw)
 *   7. Automatic Final & 3rd-Place match generation and match simulation
 *   8. Final podium determination (Quán quân, Á quân, Quý quân, Hạng 4)
 *   9. Publication-grade Vietnamese ASCII tables and podium box art
 */

'use strict';

// ============================================================================
// 1. CLI ARGUMENT PARSER
// ============================================================================

function parseCliArgs(argv = process.argv.slice(2)) {
  const opts = {
    dryRun: false,
    scenario: 1,
    persist: false,
    verbose: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg.startsWith('--scenario=')) {
      const num = parseInt(arg.split('=')[1], 10);
      opts.scenario = Number.isInteger(num) && num >= 1 && num <= 5 ? num : 1;
    } else if (arg === '--persist') {
      opts.persist = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }

  // If DATABASE_URL is missing and persist is not explicitly requested, default to dry-run
  if (!process.env.DATABASE_URL && !opts.persist) {
    opts.dryRun = true;
  }

  return opts;
}

function printCliHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║              VODICH-TOOL: SEED & DYNAMIC TOURNAMENT SIMULATOR                ║
╚══════════════════════════════════════════════════════════════════════════════╝

CÚ PHÁP:
  node scripts/seed-dynamic-tournament.js [TÙY CHỌN]

CÁC TÙY CHỌN:
  --dry-run             Chạy hoàn toàn trong bộ nhớ (In-Memory). Không kết nối DB.
  --scenario=<1..5>     Chọn kịch bản mô phỏng giải đấu (Mặc định: 1).
  --persist             Bật chế độ ghi vào PostgreSQL nếu có DATABASE_URL.
                        Tự động fallback an toàn về in-memory nếu DB mất kết nối.
  -v, --verbose         Hiển thị chi tiết từng trận đấu và log chuyển trạng thái.
  -h, --help            Hiển thị hướng dẫn sử dụng và danh sách kịch bản.

DANH SÁCH 5 KỊCH BẢN MÔ PHỎNG:
  [1] 12 Đội (3 bảng x top 2) + 2 Wildcards gợi ý tự động (Hạng 7, 8)
      -> Bốc thăm Tứ kết Wheel -> Bán kết Wheel -> Chung kết & Tranh hạng 3-4.
  [2] 12 Đội (3 bảng x top 2) + 2 Wildcards do BTC chủ động thay thế (Hạng 7, 9)
      -> Bốc thăm Tứ kết Wheel -> Bán kết nhánh cố định -> Chung kết & Tranh 3-4.
  [3] 16 Đội (4 bảng x top 2, Không thiếu suất = 8 đội vào thẳng)
      -> Bốc thăm Tứ kết Wheel -> Bán kết nhánh cố định -> Chung kết & Tranh 3-4.
  [4] 8 Đội (2 bảng x top 2, Vào thẳng Bán kết, bỏ qua Tứ kết)
      -> Bán kết Wheel -> Chung kết & Tranh hạng 3-4.
  [5] 12 Đội với kịch bản Đối đầu phức tạp (Head-to-head tie-break) vòng bảng
      -> Phân định thứ hạng bằng kết quả đối đầu trực tiếp trước hiệu số.

VÍ DỤ SỬ DỤNG:
  node scripts/seed-dynamic-tournament.js --dry-run --scenario=1
  node scripts/seed-dynamic-tournament.js --scenario=5 --verbose
  node scripts/seed-dynamic-tournament.js --persist --scenario=3
`);
}

// ============================================================================
// 2. STRING DISPLAY WIDTH & ASCII FORMATTING HELPERS
// ============================================================================

function stripAnsi(str) {
  return String(str).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Calculates display visual cell width in monospaced terminal.
 * Handles Vietnamese accents, BMP symbols (⚙, ⚠️, ⚔), emojis, and variation selectors.
 */
function stringVisualWidth(str) {
  const clean = stripAnsi(str).replace(/\uFE0F/g, '');
  let width = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair (emoji)
      width += 2;
      i++;
    } else if (
      (code >= 0x2600 && code <= 0x27bf) || // Miscellaneous symbols (⚙, ⚠️, ⚔)
      (code >= 0x1f300 && code <= 0x1f9ff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function pad(str, targetWidth, align = 'left') {
  const s = String(str !== undefined && str !== null ? str : '');
  const cur = stringVisualWidth(s);
  const diff = Math.max(0, targetWidth - cur);
  if (align === 'right') return ' '.repeat(diff) + s;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + s + ' '.repeat(right);
  }
  return s + ' '.repeat(diff);
}

function formatTableRow(cols, widths, aligns = []) {
  const cells = cols.map((c, i) => pad(c, widths[i], aligns[i] || 'left'));
  return '│ ' + cells.join(' │ ') + ' │';
}

function formatTableSeparator(widths, type = 'middle') {
  if (type === 'top') {
    return '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  }
  if (type === 'bottom') {
    return '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';
  }
  return '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
}

// ============================================================================
// 3. STORAGE ADAPTERS (IN-MEMORY & PRISMA CLIENT WITH FALLBACK)
// ============================================================================

class InMemoryStore {
  constructor() {
    this.tournaments = new Map();
    this.matches = new Map();
    this.nextTournamentId = 1n;
    this.nextMatchId = 1n;
    this.isInMemory = true;
  }

  async createTournament(data) {
    const id = this.nextTournamentId++;
    const tournament = {
      id,
      name: data.name || 'Giải Đấu Pickleball Dynamic',
      venue: data.venue || 'Sân Pickleball Trung Tâm',
      format: data.format || 'GROUP_KNOCKOUT',
      playType: data.playType || 'DOUBLES',
      courtCount: data.courtCount || 3,
      touchScore: data.touchScore || 11,
      maxScore: data.maxScore || 15,
      knockoutTouchScore: data.knockoutTouchScore || 15,
      knockoutMaxScore: data.knockoutMaxScore || 19,
      knockoutQualifierCount: data.knockoutQualifierCount || 8,
      groupCount: data.groupCount || 3,
      advancePerGroup: data.advancePerGroup || 2,
      hasThirdPlace: data.hasThirdPlace !== undefined ? data.hasThirdPlace : true,
      wildcardTeams: data.wildcardTeams || null,
      quarterDrawMethod: data.quarterDrawMethod || 'FIXED',
      semiDrawMethod: data.semiDrawMethod || 'FIXED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tournaments.set(id, tournament);
    return tournament;
  }

  async updateTournament(id, data) {
    const tournament = this.tournaments.get(id);
    if (!tournament) throw new Error(`Tournament ${id} not found in memory`);
    Object.assign(tournament, data, { updatedAt: new Date() });
    return tournament;
  }

  async createMatch(data) {
    const id = this.nextMatchId++;
    const match = {
      id,
      tournamentId: data.tournamentId,
      teamA: data.teamA,
      teamB: data.teamB,
      scoreA: data.scoreA !== undefined ? data.scoreA : 0,
      scoreB: data.scoreB !== undefined ? data.scoreB : 0,
      status: data.status || 'SCHEDULED',
      courtNumber: data.courtNumber || 1,
      roundNumber: data.roundNumber || 1,
      stage: data.stage || 'Vòng bảng',
      groupName: data.groupName || null,
      servingTeam: data.servingTeam || 'A',
      scoreOrder: data.scoreOrder || 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.matches.set(id, match);
    return match;
  }

  async updateMatch(id, data) {
    const match = this.matches.get(id);
    if (!match) throw new Error(`Match ${id} not found in memory`);
    Object.assign(match, data, { updatedAt: new Date() });
    return match;
  }

  async getMatches(tournamentId) {
    return [...this.matches.values()].filter((m) => m.tournamentId === tournamentId);
  }

  async close() {
    // Zero teardown required for in-memory
  }
}

class PrismaStore {
  constructor(prisma) {
    this.prisma = prisma;
    this.isInMemory = false;
  }

  async createTournament(data) {
    return await this.prisma.tournament.create({
      data: {
        name: data.name || 'Giải Đấu Pickleball Dynamic',
        venue: data.venue || 'Sân Pickleball Trung Tâm',
        format: data.format || 'GROUP_KNOCKOUT',
        playType: data.playType || 'DOUBLES',
        courtCount: data.courtCount || 3,
        touchScore: data.touchScore || 11,
        maxScore: data.maxScore || 15,
        knockoutTouchScore: data.knockoutTouchScore || 15,
        knockoutMaxScore: data.knockoutMaxScore || 19,
        knockoutQualifierCount: data.knockoutQualifierCount || 8,
      },
    });
  }

  async updateTournament(id, data) {
    try {
      const updateData = {};
      if (data.wildcardTeams !== undefined) updateData.wildcardTeams = data.wildcardTeams;
      if (Object.keys(updateData).length === 0) return null;
      return await this.prisma.tournament.update({
        where: { id },
        data: updateData,
      });
    } catch {
      // If dynamic column not in baseline schema, fail silently
      return null;
    }
  }

  async createMatch(data) {
    return await this.prisma.matchGame.create({
      data: {
        tournamentId: data.tournamentId,
        teamA: data.teamA,
        teamB: data.teamB,
        scoreA: data.scoreA !== undefined ? data.scoreA : 0,
        scoreB: data.scoreB !== undefined ? data.scoreB : 0,
        status: data.status || 'SCHEDULED',
        courtNumber: data.courtNumber || 1,
        roundNumber: data.roundNumber || 1,
        stage: data.stage || 'Vòng bảng',
        groupName: data.groupName || null,
        servingTeam: data.servingTeam || 'A',
        scoreOrder: data.scoreOrder || 2,
      },
    });
  }

  async updateMatch(id, data) {
    return await this.prisma.matchGame.update({
      where: { id },
      data,
    });
  }

  async getMatches(tournamentId) {
    return await this.prisma.matchGame.findMany({
      where: { tournamentId },
      orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }],
    });
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

async function getStorageAdapter(opts) {
  if (opts.dryRun) {
    return new InMemoryStore();
  }

  if (!opts.persist && !process.env.DATABASE_URL) {
    return new InMemoryStore();
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return new PrismaStore(prisma);
  } catch (err) {
    console.log(
      '\n⚠️  Không thể kết nối tới DATABASE_URL. Tự động chuyển sang chế độ mô phỏng trong bộ nhớ (In-Memory Simulation).',
    );
    if (opts.verbose) {
      console.log('   Chi tiết kết nối:', err.message);
    }
    return new InMemoryStore();
  }
}

// ============================================================================
// 4. REALISTIC PICKLEBALL SCORING ENGINE
// ============================================================================

/**
 * Simulates a realistic pickleball match score:
 * - Group stage: touchScore 11, maxScore 15. Win by 2 or hit 15.
 * - Knockout stage: touchScore 15, maxScore 19. Win by 2 or hit 19.
 */
function simulatePickleballScore(touchScore = 11, maxScore = 15, winnerBias = 'A') {
  const isWinnerA = winnerBias === 'A';
  const dice = Math.random();

  let winScore = touchScore;
  let loseScore = Math.floor(Math.random() * (touchScore - 2));

  if (dice > 0.8) {
    // Tight deuce / overtime match
    winScore = Math.min(touchScore + Math.floor(Math.random() * 3), maxScore);
    loseScore = winScore === maxScore ? maxScore - 1 : winScore - 2;
  }

  return {
    scoreA: isWinnerA ? winScore : loseScore,
    scoreB: isWinnerA ? loseScore : winScore,
    status: 'FINISHED',
  };
}

// ============================================================================
// 5. STANDINGS, HEAD-TO-HEAD TIEBREAK & WILDCARD CALCULATIONS
// ============================================================================

function findDirectMatchWinner(matches, teamA, teamB) {
  const match = matches.find(
    (m) =>
      m.status === 'FINISHED' &&
      ((m.teamA === teamA && m.teamB === teamB) || (m.teamA === teamB && m.teamB === teamA)),
  );
  if (!match) return null;
  const scoreA = match.teamA === teamA ? match.scoreA : match.scoreB;
  const scoreB = match.teamA === teamB ? match.scoreA : match.scoreB;
  if (scoreA > scoreB) return teamA;
  if (scoreB > scoreA) return teamB;
  return null;
}

function computeGroupStandings(groupName, matches, teamsInGroup) {
  const statsMap = new Map();

  for (const team of teamsInGroup) {
    statsMap.set(team, {
      teamName: team,
      groupName,
      played: 0,
      won: 0,
      lost: 0,
      rankingPoints: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      rankInGroup: 0,
    });
  }

  const groupMatches = matches.filter((m) => m.groupName === groupName && m.status === 'FINISHED');

  for (const m of groupMatches) {
    const sA = statsMap.get(m.teamA);
    const sB = statsMap.get(m.teamB);
    if (!sA || !sB) continue;

    sA.played++;
    sB.played++;
    sA.pointsFor += m.scoreA;
    sA.pointsAgainst += m.scoreB;
    sB.pointsFor += m.scoreB;
    sB.pointsAgainst += m.scoreA;

    if (m.scoreA > m.scoreB) {
      sA.won++;
      sA.rankingPoints++;
      sB.lost++;
    } else if (m.scoreB > m.scoreA) {
      sB.won++;
      sB.rankingPoints++;
      sA.lost++;
    }

    sA.pointDiff = sA.pointsFor - sA.pointsAgainst;
    sB.pointDiff = sB.pointsFor - sB.pointsAgainst;
  }

  const rows = [...statsMap.values()];

  // Multi-tier sort with Head-to-Head tiebreak
  rows.sort((a, b) => {
    // Tier 1: Wins / Ranking Points
    if (b.won !== a.won) return b.won - a.won;

    // Tier 2: Head-to-Head direct match (if 2 teams tied on wins)
    const h2hWinner = findDirectMatchWinner(groupMatches, a.teamName, b.teamName);
    if (h2hWinner === a.teamName) return -1;
    if (h2hWinner === b.teamName) return 1;

    // Tier 3: Point Differential
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;

    // Tier 4: Total Points Scored
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;

    // Tier 5: Deterministic alphabetical sort
    return a.teamName.localeCompare(b.teamName);
  });

  // Assign 1-based ranks
  rows.forEach((row, idx) => {
    row.rankInGroup = idx + 1;
  });

  return {
    groupName,
    rows,
  };
}

function computeCrossGroupCandidatePool(groupRankings, advancePerGroup) {
  const candidates = [];

  for (const grp of groupRankings) {
    for (let i = advancePerGroup; i < grp.rows.length; i++) {
      candidates.push({ ...grp.rows[i], groupName: grp.groupName });
    }
  }

  // Cross-group ranking priority:
  // 1. Group finishing position (all 3rd-places rank above all 4th-places)
  // 2. Total wins
  // 3. Point differential
  // 4. Points scored
  // 5. Team name
  candidates.sort((a, b) => {
    if (a.rankInGroup !== b.rankInGroup) return a.rankInGroup - b.rankInGroup;
    if (b.won !== a.won) return b.won - a.won;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamName.localeCompare(b.teamName);
  });

  return candidates;
}

// ============================================================================
// 6. WHEEL SPIN PAIRING GENERATOR
// ============================================================================

function wheelSpinPairings(teams, presetPairs = null) {
  if (presetPairs && Array.isArray(presetPairs) && presetPairs.length === Math.floor(teams.length / 2)) {
    return presetPairs;
  }

  const pool = [...teams];
  // Deterministic or pseudo-random Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  const pairs = [];
  for (let i = 0; i < pool.length; i += 2) {
    pairs.push({ teamA: pool[i], teamB: pool[i + 1] });
  }
  return pairs;
}

// ============================================================================
// 7. PRESET REALISTIC SCENARIOS (TIER 4 WORKLOADS)
// ============================================================================

const SCENARIOS = {
  1: {
    id: 1,
    name: '12 Đội: 3 Bảng x Top 2 + 2 Wildcard Gợi Ý -> Tứ Kết Wheel -> Bán Kết Wheel -> Chung Kết & Tranh 3-4',
    teamCount: 12,
    groupCount: 3,
    advancePerGroup: 2,
    knockoutQualifierCount: 8,
    hasThirdPlace: true,
    semiDrawMethod: 'WHEEL',
    groups: {
      A: ['Nguyễn An / Trần Bình', 'Lê Cường / Phạm Dũng', 'Hoàng Em / Đỗ Giang', 'Vũ Hải / Mai Khang'],
      B: ['Võ Kiên / Dương Lâm', 'Đặng Quý / Hồ Sơn', 'Đinh Long / Bùi Minh', 'Ngô Phúc / Lý Quân'],
      C: ['Hà Nghĩa / Chu Phát', 'Cao Uy / Trương Tài', 'Phan Nam / Trịnh Oanh', 'Tạ Sang / Đoàn Tâm'],
    },
    // Exact realistic match scores for scenario reproducibility
    groupScores: [
      // Group A
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Lê Cường / Phạm Dũng', scoreA: 11, scoreB: 6, groupName: 'A' },
      { teamA: 'Hoàng Em / Đỗ Giang', teamB: 'Vũ Hải / Mai Khang', scoreA: 11, scoreB: 7, groupName: 'A' },
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 11, scoreB: 8, groupName: 'A' },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Vũ Hải / Mai Khang', scoreA: 11, scoreB: 5, groupName: 'A' },
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Vũ Hải / Mai Khang', scoreA: 11, scoreB: 4, groupName: 'A' },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 11, scoreB: 9, groupName: 'A' },
      // Group B
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 11, scoreB: 7, groupName: 'B' },
      { teamA: 'Đinh Long / Bùi Minh', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 8, groupName: 'B' },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Đinh Long / Bùi Minh', scoreA: 11, scoreB: 6, groupName: 'B' },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 4, groupName: 'B' },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 5, groupName: 'B' },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Đinh Long / Bùi Minh', scoreA: 11, scoreB: 8, groupName: 'B' },
      // Group C
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Cao Uy / Trương Tài', scoreA: 11, scoreB: 9, groupName: 'C' },
      { teamA: 'Phan Nam / Trịnh Oanh', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 6, groupName: 'C' },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 11, scoreB: 5, groupName: 'C' },
      { teamA: 'Cao Uy / Trương Tài', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 7, groupName: 'C' },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 4, groupName: 'C' },
      { teamA: 'Cao Uy / Trương Tài', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 11, scoreB: 8, groupName: 'C' },
    ],
    // Auto-suggest confirmed by BTC
    manualWildcards: null,
    qfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 15, scoreB: 8 },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Lê Cường / Phạm Dũng', scoreA: 15, scoreB: 11 },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 15, scoreB: 12 },
      { teamA: 'Cao Uy / Trương Tài', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 16, scoreB: 14 },
    ],
    sfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Hà Nghĩa / Chu Phát', scoreA: 15, scoreB: 9 },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Cao Uy / Trương Tài', scoreA: 15, scoreB: 13 },
    ],
    finalScores: {
      championship: { scoreA: 15, scoreB: 10 },
      thirdPlace: { scoreA: 15, scoreB: 11 },
    },
    expectedPodium: {
      firstPlace: 'Nguyễn An / Trần Bình',
      secondPlace: 'Võ Kiên / Dương Lâm',
      thirdPlace: 'Hà Nghĩa / Chu Phát',
      fourthPlace: 'Cao Uy / Trương Tài',
    },
  },

  2: {
    id: 2,
    name: '12 Đội: 3 Bảng x Top 2 + BTC Thay Thế Wildcard -> Tứ Kết Wheel -> Bán Kết Nhánh Cố Định -> Chung Kết & Tranh 3-4',
    teamCount: 12,
    groupCount: 3,
    advancePerGroup: 2,
    knockoutQualifierCount: 8,
    hasThirdPlace: true,
    semiDrawMethod: 'FIXED',
    groups: {
      A: ['Nguyễn An / Trần Bình', 'Lê Cường / Phạm Dũng', 'Hoàng Em / Đỗ Giang', 'Vũ Hải / Mai Khang'],
      B: ['Võ Kiên / Dương Lâm', 'Đặng Quý / Hồ Sơn', 'Đinh Long / Bùi Minh', 'Ngô Phúc / Lý Quân'],
      C: ['Hà Nghĩa / Chu Phát', 'Cao Uy / Trương Tài', 'Phan Nam / Trịnh Oanh', 'Tạ Sang / Đoàn Tâm'],
    },
    groupScores: null, // Uses default realistic scores equivalent to scenario 1
    // BTC substitutes Phan Nam / Trịnh Oanh with Đinh Long / Bùi Minh
    manualWildcards: ['Hoàng Em / Đỗ Giang', 'Đinh Long / Bùi Minh'],
    qfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Đinh Long / Bùi Minh', scoreA: 15, scoreB: 7 },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Cao Uy / Trương Tài', scoreA: 15, scoreB: 13 },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Hà Nghĩa / Chu Phát', scoreA: 15, scoreB: 12 },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 15, scoreB: 10 },
    ],
    // Fixed semifinals: QF1 vs QF2, QF3 vs QF4
    sfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Võ Kiên / Dương Lâm', scoreA: 15, scoreB: 17 },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 11, scoreB: 15 },
    ],
    finalScores: {
      championship: { scoreA: 15, scoreB: 12 },
      thirdPlace: { scoreA: 15, scoreB: 9 },
    },
    expectedPodium: {
      firstPlace: 'Võ Kiên / Dương Lâm',
      secondPlace: 'Đặng Quý / Hồ Sơn',
      thirdPlace: 'Nguyễn An / Trần Bình',
      fourthPlace: 'Lê Cường / Phạm Dũng',
    },
  },

  3: {
    id: 3,
    name: '16 Đội: 4 Bảng x Top 2 (Không Thiếu Suất) -> Tứ Kết Wheel -> Bán Kết Nhánh Cố Định -> Chung Kết & Tranh 3-4',
    teamCount: 16,
    groupCount: 4,
    advancePerGroup: 2,
    knockoutQualifierCount: 8,
    hasThirdPlace: true,
    semiDrawMethod: 'FIXED',
    groups: {
      A: ['Nguyễn An / Trần Bình', 'Lê Cường / Phạm Dũng', 'Hoàng Em / Đỗ Giang', 'Vũ Hải / Mai Khang'],
      B: ['Võ Kiên / Dương Lâm', 'Đặng Quý / Hồ Sơn', 'Đinh Long / Bùi Minh', 'Ngô Phúc / Lý Quân'],
      C: ['Hà Nghĩa / Chu Phát', 'Cao Uy / Trương Tài', 'Phan Nam / Trịnh Oanh', 'Tạ Sang / Đoàn Tâm'],
      D: ['Lưu Hùng / Tạ Phong', 'Bạch Vũ / Nghiêm Trí', 'Thái Việt / Diệp Khánh', 'Ân Cảnh / Doãn Kiệt'],
    },
    groupScores: null,
    manualWildcards: null,
    qfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 15, scoreB: 6 },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Lê Cường / Phạm Dũng', scoreA: 15, scoreB: 9 },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Bạch Vũ / Nghiêm Trí', scoreA: 15, scoreB: 10 },
      { teamA: 'Lưu Hùng / Tạ Phong', teamB: 'Cao Uy / Trương Tài', scoreA: 15, scoreB: 11 },
    ],
    sfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Võ Kiên / Dương Lâm', scoreA: 15, scoreB: 8 },
      { teamA: 'Lưu Hùng / Tạ Phong', teamB: 'Hà Nghĩa / Chu Phát', scoreA: 15, scoreB: 13 },
    ],
    finalScores: {
      championship: { scoreA: 15, scoreB: 9 },
      thirdPlace: { scoreA: 15, scoreB: 11 },
    },
    expectedPodium: {
      firstPlace: 'Nguyễn An / Trần Bình',
      secondPlace: 'Lưu Hùng / Tạ Phong',
      thirdPlace: 'Võ Kiên / Dương Lâm',
      fourthPlace: 'Hà Nghĩa / Chu Phát',
    },
  },

  4: {
    id: 4,
    name: '8 Đội: 2 Bảng x Top 2 (Bỏ Qua Tứ Kết, Vào Thẳng Bán Kết) -> Bán Kết Wheel -> Chung Kết & Tranh 3-4',
    teamCount: 8,
    groupCount: 2,
    advancePerGroup: 2,
    knockoutQualifierCount: 4,
    hasThirdPlace: true,
    semiDrawMethod: 'WHEEL',
    groups: {
      A: ['Nguyễn An / Trần Bình', 'Lê Cường / Phạm Dũng', 'Hoàng Em / Đỗ Giang', 'Vũ Hải / Mai Khang'],
      B: ['Võ Kiên / Dương Lâm', 'Đặng Quý / Hồ Sơn', 'Đinh Long / Bùi Minh', 'Ngô Phúc / Lý Quân'],
    },
    groupScores: null,
    manualWildcards: null,
    qfPairs: null, // QF is completely skipped
    sfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 15, scoreB: 7 },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Võ Kiên / Dương Lâm', scoreA: 16, scoreB: 14 },
    ],
    finalScores: {
      championship: { scoreA: 15, scoreB: 11 },
      thirdPlace: { scoreA: 15, scoreB: 8 },
    },
    expectedPodium: {
      firstPlace: 'Nguyễn An / Trần Bình',
      secondPlace: 'Lê Cường / Phạm Dũng',
      thirdPlace: 'Võ Kiên / Dương Lâm',
      fourthPlace: 'Đặng Quý / Hồ Sơn',
    },
  },

  5: {
    id: 5,
    name: '12 Đội: Đối Đầu Phức Tạp (Head-to-Head Tie-Break) Vòng Bảng -> Tứ Kết Wheel -> Bán Kết Wheel -> Chung Kết & Tranh 3-4',
    teamCount: 12,
    groupCount: 3,
    advancePerGroup: 2,
    knockoutQualifierCount: 8,
    hasThirdPlace: true,
    semiDrawMethod: 'WHEEL',
    groups: {
      A: ['Nguyễn An / Trần Bình', 'Lê Cường / Phạm Dũng', 'Hoàng Em / Đỗ Giang', 'Vũ Hải / Mai Khang'],
      B: ['Võ Kiên / Dương Lâm', 'Đặng Quý / Hồ Sơn', 'Đinh Long / Bùi Minh', 'Ngô Phúc / Lý Quân'],
      C: ['Hà Nghĩa / Chu Phát', 'Cao Uy / Trương Tài', 'Phan Nam / Trịnh Oanh', 'Tạ Sang / Đoàn Tâm'],
    },
    // Tailored matches exercising head-to-head resolution
    groupScores: [
      // Group A: A1 and A2 tied at 2-1 wins. A1 beat A2 direct! (11-8).
      // Also A3 and A4 tied at 1-2 wins. A4 beat A3 direct! (11-9), despite A3 having better diff!
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Lê Cường / Phạm Dũng', scoreA: 11, scoreB: 8, groupName: 'A' },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 11, scoreB: 9, groupName: 'A' },
      { teamA: 'Hoàng Em / Đỗ Giang', teamB: 'Nguyễn An / Trần Bình', scoreA: 11, scoreB: 7, groupName: 'A' },
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Vũ Hải / Mai Khang', scoreA: 11, scoreB: 5, groupName: 'A' },
      { teamA: 'Lê Cường / Phạm Dũng', teamB: 'Vũ Hải / Mai Khang', scoreA: 11, scoreB: 8, groupName: 'A' },
      { teamA: 'Vũ Hải / Mai Khang', teamB: 'Hoàng Em / Đỗ Giang', scoreA: 11, scoreB: 9, groupName: 'A' },
      // Group B: 3-way circular tie among B1, B2, B3 (2-1 each, H2H circular 1-1, resolved by diff)
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 11, scoreB: 9, groupName: 'B' },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Đinh Long / Bùi Minh', scoreA: 11, scoreB: 8, groupName: 'B' },
      { teamA: 'Đinh Long / Bùi Minh', teamB: 'Võ Kiên / Dương Lâm', scoreA: 11, scoreB: 7, groupName: 'B' },
      { teamA: 'Võ Kiên / Dương Lâm', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 4, groupName: 'B' },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 3, groupName: 'B' },
      { teamA: 'Đinh Long / Bùi Minh', teamB: 'Ngô Phúc / Lý Quân', scoreA: 11, scoreB: 6, groupName: 'B' },
      // Group C: Normal clear standings
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Cao Uy / Trương Tài', scoreA: 11, scoreB: 6, groupName: 'C' },
      { teamA: 'Phan Nam / Trịnh Oanh', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 5, groupName: 'C' },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 11, scoreB: 7, groupName: 'C' },
      { teamA: 'Cao Uy / Trương Tài', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 6, groupName: 'C' },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Tạ Sang / Đoàn Tâm', scoreA: 11, scoreB: 3, groupName: 'C' },
      { teamA: 'Cao Uy / Trương Tài', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 11, scoreB: 8, groupName: 'C' },
    ],
    manualWildcards: null,
    qfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Phan Nam / Trịnh Oanh', scoreA: 15, scoreB: 9 },
      { teamA: 'Đặng Quý / Hồ Sơn', teamB: 'Cao Uy / Trương Tài', scoreA: 15, scoreB: 12 },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Lê Cường / Phạm Dũng', scoreA: 15, scoreB: 11 },
      { teamA: 'Đinh Long / Bùi Minh', teamB: 'Vũ Hải / Mai Khang', scoreA: 15, scoreB: 8 },
    ],
    sfPairs: [
      { teamA: 'Nguyễn An / Trần Bình', teamB: 'Đặng Quý / Hồ Sơn', scoreA: 15, scoreB: 11 },
      { teamA: 'Hà Nghĩa / Chu Phát', teamB: 'Đinh Long / Bùi Minh', scoreA: 15, scoreB: 13 },
    ],
    finalScores: {
      championship: { scoreA: 15, scoreB: 12 },
      thirdPlace: { scoreA: 15, scoreB: 10 },
    },
    expectedPodium: {
      firstPlace: 'Nguyễn An / Trần Bình',
      secondPlace: 'Hà Nghĩa / Chu Phát',
      thirdPlace: 'Đặng Quý / Hồ Sơn',
      fourthPlace: 'Đinh Long / Bùi Minh',
    },
  },
};

// ============================================================================
// 8. DYNAMIC TOURNAMENT SIMULATION ENGINE
// ============================================================================

class DynamicTournamentSimulator {
  constructor(store, options = {}) {
    this.store = store;
    this.options = options;
  }

  async runScenario(scenarioConfig) {
    const s = scenarioConfig;
    const verbose = Boolean(this.options.verbose);

    // 1. Create Tournament Entity
    const tournament = await this.store.createTournament({
      name: `Giải Vô Địch Pickleball Mở Rộng 2026 - Scenario ${s.id}`,
      venue: 'Sân Pickleball Trung Tâm Thể Thao',
      format: 'GROUP_KNOCKOUT',
      playType: 'DOUBLES',
      courtCount: 3,
      touchScore: 11,
      maxScore: 15,
      knockoutTouchScore: 15,
      knockoutMaxScore: 19,
      knockoutQualifierCount: s.knockoutQualifierCount,
      groupCount: s.groupCount,
      advancePerGroup: s.advancePerGroup,
      hasThirdPlace: s.hasThirdPlace,
      semiDrawMethod: s.semiDrawMethod,
    });

    if (verbose) {
      console.log(`[Simulator] Tournament created with ID ${tournament.id} (${s.name})`);
    }

    // 2. Schedule and Simulate Group Matches
    const groupMatches = [];
    const groupNames = Object.keys(s.groups);

    // Build round robin pairings for each group
    for (const gName of groupNames) {
      const teams = s.groups[gName];
      let matchIdx = 0;
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          matchIdx++;
          const tA = teams[i];
          const tB = teams[j];

          // Check if predetermined score exists
          let scoreInfo = null;
          if (s.groupScores && Array.isArray(s.groupScores)) {
            const found = s.groupScores.find(
              (gs) =>
                gs.groupName === gName &&
                ((gs.teamA === tA && gs.teamB === tB) || (gs.teamA === tB && gs.teamB === tA)),
            );
            if (found) {
              scoreInfo = {
                scoreA: found.teamA === tA ? found.scoreA : found.scoreB,
                scoreB: found.teamA === tA ? found.scoreB : found.scoreA,
                status: 'FINISHED',
              };
            }
          }

          if (!scoreInfo) {
            // Default realistic simulation with slight advantage to earlier seeds
            scoreInfo = simulatePickleballScore(11, 15, i < j ? 'A' : 'B');
          }

          const match = await this.store.createMatch({
            tournamentId: tournament.id,
            teamA: tA,
            teamB: tB,
            scoreA: scoreInfo.scoreA,
            scoreB: scoreInfo.scoreB,
            status: scoreInfo.status,
            courtNumber: ((matchIdx - 1) % 3) + 1,
            roundNumber: matchIdx,
            stage: 'Vòng bảng',
            groupName: gName,
          });

          groupMatches.push(match);
        }
      }
    }

    // 3. Compute Standings & Head-to-Head Resolution
    const allMatches = await this.store.getMatches(tournament.id);
    const groupRankings = [];
    const directlyQualified = [];

    for (const gName of groupNames) {
      const gStandings = computeGroupStandings(gName, allMatches, s.groups[gName]);
      groupRankings.push(gStandings);

      for (let i = 0; i < Math.min(s.advancePerGroup, gStandings.rows.length); i++) {
        directlyQualified.push(gStandings.rows[i].teamName);
      }
    }

    // 4. Shortage Detection & Cross-Group Wildcards
    const targetCount = s.knockoutQualifierCount;
    const shortage = Math.max(0, targetCount - directlyQualified.length);
    const candidates = computeCrossGroupCandidatePool(groupRankings, s.advancePerGroup);
    const suggested = candidates.slice(0, shortage).map((c) => c.teamName);

    let selectedWildcards = [];
    if (shortage > 0) {
      if (s.manualWildcards && Array.isArray(s.manualWildcards) && s.manualWildcards.length === shortage) {
        selectedWildcards = [...s.manualWildcards];
      } else {
        selectedWildcards = [...suggested];
      }
      await this.store.updateTournament(tournament.id, {
        wildcardTeams: JSON.stringify(selectedWildcards),
      });
    }

    const qualifiedTeams = [...directlyQualified, ...selectedWildcards];

    const wildcardStatus = {
      directlyQualified,
      shortage,
      targetCount,
      suggested,
      candidates,
      selected: selectedWildcards,
    };

    // 5. Knockout Stage Execution
    const knockoutMatches = [];
    let qfWinners = [];

    if (targetCount >= 8) {
      // 5.1 Quarterfinals (Round 100, Stage 'Tứ kết')
      const pairs = wheelSpinPairings(qualifiedTeams, s.qfPairs);
      let court = 1;

      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        let scoreInfo = null;
        if (s.qfPairs && s.qfPairs[i] && s.qfPairs[i].scoreA !== undefined) {
          scoreInfo = {
            scoreA: s.qfPairs[i].scoreA,
            scoreB: s.qfPairs[i].scoreB,
            status: 'FINISHED',
          };
        } else {
          scoreInfo = simulatePickleballScore(15, 19, 'A');
        }

        const qfMatch = await this.store.createMatch({
          tournamentId: tournament.id,
          teamA: p.teamA,
          teamB: p.teamB,
          scoreA: scoreInfo.scoreA,
          scoreB: scoreInfo.scoreB,
          status: scoreInfo.status,
          courtNumber: court++,
          roundNumber: 100,
          stage: 'Tứ kết',
        });

        knockoutMatches.push(qfMatch);
        qfWinners.push(scoreInfo.scoreA > scoreInfo.scoreB ? p.teamA : p.teamB);
      }
    } else {
      // Skip QF, direct to SF (e.g. 4 teams)
      qfWinners = [...qualifiedTeams];
    }

    // 5.2 Semifinals (Round 101, Stage 'Bán kết')
    let sfPairs = [];
    if (s.semiDrawMethod === 'FIXED' && targetCount >= 8) {
      // QF1 vs QF2, QF3 vs QF4
      sfPairs = [
        { teamA: qfWinners[0], teamB: qfWinners[1] },
        { teamA: qfWinners[2], teamB: qfWinners[3] },
      ];
    } else if (s.sfPairs && Array.isArray(s.sfPairs) && s.sfPairs.length === 2) {
      sfPairs = s.sfPairs.map((pair) => ({ teamA: pair.teamA, teamB: pair.teamB }));
    } else {
      sfPairs = wheelSpinPairings(qfWinners);
    }

    const sfWinners = [];
    const sfLosers = [];

    for (let i = 0; i < sfPairs.length; i++) {
      const p = sfPairs[i];
      let scoreInfo = null;
      if (s.sfPairs && s.sfPairs[i] && s.sfPairs[i].scoreA !== undefined) {
        scoreInfo = {
          scoreA: s.sfPairs[i].scoreA,
          scoreB: s.sfPairs[i].scoreB,
          status: 'FINISHED',
        };
      } else {
        scoreInfo = simulatePickleballScore(15, 19, 'A');
      }

      const sfMatch = await this.store.createMatch({
        tournamentId: tournament.id,
        teamA: p.teamA,
        teamB: p.teamB,
        scoreA: scoreInfo.scoreA,
        scoreB: scoreInfo.scoreB,
        status: scoreInfo.status,
        courtNumber: i + 1,
        roundNumber: 101,
        stage: 'Bán kết',
      });

      knockoutMatches.push(sfMatch);
      const isWinnerA = scoreInfo.scoreA > scoreInfo.scoreB;
      sfWinners.push(isWinnerA ? p.teamA : p.teamB);
      sfLosers.push(isWinnerA ? p.teamB : p.teamA);
    }

    // 5.3 Finals & 3rd-Place Match (Round 102 & 103)
    let thirdPlaceMatch = null;
    let bronzeWinner = null;
    let fourthPlace = null;

    if (s.hasThirdPlace) {
      let tpScore = null;
      if (s.finalScores && s.finalScores.thirdPlace) {
        tpScore = {
          scoreA: s.finalScores.thirdPlace.scoreA,
          scoreB: s.finalScores.thirdPlace.scoreB,
          status: 'FINISHED',
        };
      } else {
        tpScore = simulatePickleballScore(15, 19, 'A');
      }

      thirdPlaceMatch = await this.store.createMatch({
        tournamentId: tournament.id,
        teamA: sfLosers[0],
        teamB: sfLosers[1],
        scoreA: tpScore.scoreA,
        scoreB: tpScore.scoreB,
        status: tpScore.status,
        courtNumber: 2,
        roundNumber: 103,
        stage: 'Tranh hạng 3-4',
      });

      knockoutMatches.push(thirdPlaceMatch);
      bronzeWinner = tpScore.scoreA > tpScore.scoreB ? sfLosers[0] : sfLosers[1];
      fourthPlace = tpScore.scoreA > tpScore.scoreB ? sfLosers[1] : sfLosers[0];
    }

    let finalScore = null;
    if (s.finalScores && s.finalScores.championship) {
      finalScore = {
        scoreA: s.finalScores.championship.scoreA,
        scoreB: s.finalScores.championship.scoreB,
        status: 'FINISHED',
      };
    } else {
      finalScore = simulatePickleballScore(15, 19, 'A');
    }

    const finalMatch = await this.store.createMatch({
      tournamentId: tournament.id,
      teamA: sfWinners[0],
      teamB: sfWinners[1],
      scoreA: finalScore.scoreA,
      scoreB: finalScore.scoreB,
      status: finalScore.status,
      courtNumber: 1,
      roundNumber: 102,
      stage: 'Chung kết',
    });

    knockoutMatches.push(finalMatch);

    const champion = finalScore.scoreA > finalScore.scoreB ? sfWinners[0] : sfWinners[1];
    const runnerUp = finalScore.scoreA > finalScore.scoreB ? sfWinners[1] : sfWinners[0];

    const podium = {
      firstPlace: champion,
      secondPlace: runnerUp,
      thirdPlace: bronzeWinner,
      fourthPlace: fourthPlace,
    };

    const updatedMatches = await this.store.getMatches(tournament.id);

    return {
      store: this.store,
      tournament,
      scenario: s,
      matches: updatedMatches,
      groupMatches,
      knockoutMatches,
      groupRankings,
      wildcardStatus,
      podium,
    };
  }
}

// ============================================================================
// 9. PUBLICATION-GRADE ASCII OUTPUT RENDERER
// ============================================================================

class TournamentAsciiRenderer {
  static render(simResult, options = {}) {
    const { tournament, scenario, matches, groupRankings, wildcardStatus, podium } = simResult;
    const isStoreInMemory = simResult.store ? simResult.store.isInMemory : true;
    const isExplicitDryRun = options.dryRun || !process.env.DATABASE_URL;

    let envLabel = '';
    if (isStoreInMemory && !isExplicitDryRun) {
      envLabel = '[IN-MEMORY SIMULATION (FALLBACK)] (DB offline, tự động chuyển in-memory an toàn)';
    } else if (isStoreInMemory) {
      envLabel = '[IN-MEMORY SIMULATION] (--dry-run: Zero external dependencies)';
    } else {
      envLabel = '[POSTGRESQL LIVE PERSIST] (DATABASE_URL connected & verified)';
    }

    console.log('');
    // ------------------------------------------------------------------------
    // SECTION 1: HEADER & BANNER
    // ------------------------------------------------------------------------
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║            MÔ PHỎNG TIẾN TRÌNH GIẢI ĐẤU PICKLEBALL KNOCKOUT ĐỘNG             ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log(`  ⚙️  Tên giải đấu  : ${tournament.name}`);
    console.log(`  ⚙️  Kịch bản      : [${scenario.id}] ${scenario.name}`);
    console.log(`  ⚙️  Môi trường    : ${envLabel}`);
    console.log(`  ⚙️  Thể thức      : Vòng bảng + Vòng loại trực tiếp động (GROUP_KNOCKOUT)`);
    console.log(
      `  ⚙️  Cấu hình      : ${scenario.groupCount} Bảng (${scenario.teamCount} đội) | Lấy Top ${scenario.advancePerGroup} đi tiếp/bảng | Cần ${scenario.knockoutQualifierCount} đội Knockout`,
    );
    console.log(
      `  ⚙️  Luật tính điểm : Vòng bảng (chạm 11, max 15) | Vòng knockout (chạm 15, max 19) | Tranh hạng 3: ${scenario.hasThirdPlace ? 'CÓ' : 'KHÔNG'}`,
    );
    console.log('');

    // ------------------------------------------------------------------------
    // SECTION 2: GROUP STAGE STANDINGS & RESULTS
    // ------------------------------------------------------------------------
    console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ VÒNG BẢNG - BẢNG XẾP HẠNG & KẾT QUẢ THI ĐẤU                                  │');
    console.log('└──────────────────────────────────────────────────────────────────────────────┘');

    const colWidths = [3, 26, 5, 4, 4, 8, 5, 9];
    const colHeaders = ['H.', 'Đội thi đấu', 'Trận', 'T', 'B', 'Hiệu số', 'Điểm', 'Vé KN'];
    const colAligns = ['center', 'left', 'center', 'center', 'center', 'center', 'center', 'center'];

    for (const grp of groupRankings) {
      console.log(`\n[BẢNG ${grp.groupName}]`);

      // Print match scores
      const gMatches = matches.filter((m) => m.stage === 'Vòng bảng' && m.groupName === grp.groupName);
      for (const m of gMatches) {
        const scoreStr = `${pad(m.scoreA, 2, 'right')} - ${pad(m.scoreB, 2, 'left')}`;
        console.log(
          `  Trận: ${pad(m.teamA, 22, 'left')} ${scoreStr}  ${pad(m.teamB, 22, 'left')}  [${m.status === 'FINISHED' ? 'KẾT THÚC' : m.status}]`,
        );
      }

      console.log(formatTableSeparator(colWidths, 'top'));
      console.log(formatTableRow(colHeaders, colWidths, colAligns));
      console.log(formatTableSeparator(colWidths, 'middle'));

      for (const row of grp.rows) {
        const isDirect = row.rankInGroup <= scenario.advancePerGroup;
        const statusText = isDirect ? 'VÀO KN' : scenario.knockoutQualifierCount >= 8 ? 'Xét WC' : 'Bị loại';
        const sign = row.pointDiff > 0 ? '+' : '';
        const diffStr = `${sign}${row.pointDiff}`;

        console.log(
          formatTableRow(
            [
              row.rankInGroup,
              row.teamName,
              row.played,
              row.won,
              row.lost,
              diffStr,
              row.rankingPoints,
              statusText,
            ],
            colWidths,
            colAligns,
          ),
        );
      }
      console.log(formatTableSeparator(colWidths, 'bottom'));
    }
    console.log('');

    // ------------------------------------------------------------------------
    // SECTION 3: WILDCARD SHORTAGE DETECTION & CROSS-GROUP SELECTION
    // ------------------------------------------------------------------------
    if (wildcardStatus.shortage > 0) {
      console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ ⚠️  CẢNH BÁO THIẾU SUẤT VÒNG LOẠI TRỰC TIẾP (KNOCKOUT SHORTAGE)              │');
      console.log('└──────────────────────────────────────────────────────────────────────────────┘');
      console.log(`  • Số đội yêu cầu cho Knockout : ${wildcardStatus.targetCount} đội`);
      console.log(
        `  • Số đội vào thẳng từ bảng    : ${wildcardStatus.directlyQualified.length} đội (${scenario.groupCount} bảng x top ${scenario.advancePerGroup})`,
      );
      console.log(
        `  • Số suất còn thiếu           : ${wildcardStatus.shortage} đội (HỆ THỐNG KÍCH HOẠT QUY TRÌNH WILDCARD!)`,
      );
      console.log('');
      console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ BẢNG XẾP HẠNG TỔNG HỢP LIÊN BẢNG (DÀNH CHO CÁC ĐỘI CHƯA VÀO THẲNG)           │');
      console.log('└──────────────────────────────────────────────────────────────────────────────┘');

      const wcWidths = [4, 25, 6, 5, 4, 8, 5, 11];
      const wcHeaders = ['Hạng', 'Đội thi đấu', 'Bảng', 'Trận', 'T', 'Hiệu số', 'Điểm', 'Trạng thái'];
      const wcAligns = ['center', 'left', 'center', 'center', 'center', 'center', 'center', 'center'];

      console.log(formatTableSeparator(wcWidths, 'top'));
      console.log(formatTableRow(wcHeaders, wcWidths, wcAligns));
      console.log(formatTableSeparator(wcWidths, 'middle'));

      wildcardStatus.candidates.forEach((cand, idx) => {
        const overallRank = scenario.advancePerGroup * scenario.groupCount + idx + 1;
        const isSuggested = wildcardStatus.suggested.includes(cand.teamName);
        const isSelected = wildcardStatus.selected.includes(cand.teamName);
        let tag = 'Dự bị';
        if (isSelected) tag = 'CHỌN WC ⭐';
        else if (isSuggested) tag = 'GỢI Ý';

        const sign = cand.pointDiff > 0 ? '+' : '';
        console.log(
          formatTableRow(
            [
              overallRank,
              cand.teamName,
              cand.groupName,
              cand.played,
              cand.won,
              `${sign}${cand.pointDiff}`,
              cand.rankingPoints,
              tag,
            ],
            wcWidths,
            wcAligns,
          ),
        );
      });
      console.log(formatTableSeparator(wcWidths, 'bottom'));

      console.log('\n  👉 Kết quả bổ sung suất Wildcard vào vòng Knockout:');
      wildcardStatus.selected.forEach((t, i) => {
        console.log(`     [WC ${i + 1}] ${t}`);
      });
      console.log(
        `  ✅ ĐÃ HOÀN TẤT ĐỦ ${wildcardStatus.targetCount} ĐỘI THAM GIA VÒNG LOẠI TRỰC TIẾP!\n`,
      );
    } else {
      console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ ℹ️  TRẠNG THÁI VÒNG KNOCKOUT: KHÔNG THIẾU SUẤT                                │');
      console.log('└──────────────────────────────────────────────────────────────────────────────┘');
      console.log(
        `  • Số đội vào thẳng: ${wildcardStatus.directlyQualified.length}/${wildcardStatus.targetCount} đội. Tự động chuyển thẳng vào vòng Knockout!`,
      );
      console.log('');
    }

    // ------------------------------------------------------------------------
    // SECTION 4: QUARTERFINALS WHEEL DRAW & SCORES (ROUND 100)
    // ------------------------------------------------------------------------
    const qfMatches = matches.filter((m) => m.stage === 'Tứ kết');
    if (qfMatches.length > 0) {
      console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ 🎡 BỐC THĂM VÒNG QUAY TỨ KẾT (QUARTERFINALS WHEEL DRAW)                     │');
      console.log('└──────────────────────────────────────────────────────────────────────────────┘');
      console.log('  Danh sách 8 đội vào vòng quay Tứ kết:');
      const allKnockoutTeams = [...wildcardStatus.directlyQualified, ...wildcardStatus.selected];
      for (let i = 0; i < allKnockoutTeams.length; i += 2) {
        const t1 = `(${i + 1}) ${allKnockoutTeams[i]}`;
        const t2 = allKnockoutTeams[i + 1] ? `(${i + 2}) ${allKnockoutTeams[i + 1]}` : '';
        console.log(`   ${pad(t1, 36)}  ${pad(t2, 36)}`);
      }

      console.log('\n  🏆 KẾT QUẢ THI ĐẤU TỨ KẾT:');
      qfMatches.forEach((m, idx) => {
        const winner = m.scoreA > m.scoreB ? m.teamA : m.teamB;
        console.log(
          `  • QF ${idx + 1}: ${pad(m.teamA, 22)} ${pad(m.scoreA, 2, 'right')} - ${pad(m.scoreB, 2, 'left')}  ${pad(m.teamB, 22)} -> Thắng: ${winner}`,
        );
      });
      console.log('');
    } else {
      console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ ℹ️  VÒNG TỨ KẾT ĐƯỢC BỎ QUA: TIẾN THẲNG VÀO VÒNG BÁN KẾT (SEMIFINALS)         │');
      console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');
    }

    // ------------------------------------------------------------------------
    // SECTION 5: SEMIFINALS PROGRESSION & RESULTS (ROUND 101)
    // ------------------------------------------------------------------------
    const sfMatches = matches.filter((m) => m.stage === 'Bán kết');
    console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ ⚔️  VÒNG BÁN KẾT (SEMIFINALS)                                                 │');
    console.log('└──────────────────────────────────────────────────────────────────────────────┘');
    console.log(
      `  Thể thức bốc thăm Bán kết: [${scenario.semiDrawMethod === 'WHEEL' ? 'VÒNG QUAY NGẪU NHIÊN - WHEEL DRAW' : 'NHÁNH ĐẤU CỐ ĐỊNH - FIXED BRANCH'}]`,
    );

    sfMatches.forEach((m, idx) => {
      const winner = m.scoreA > m.scoreB ? m.teamA : m.teamB;
      console.log(
        `  • SF ${idx + 1}: ${pad(m.teamA, 22)} ${pad(m.scoreA, 2, 'right')} - ${pad(m.scoreB, 2, 'left')}  ${pad(m.teamB, 22)} -> Vào Chung kết: ${winner}`,
      );
    });
    console.log('');

    // ------------------------------------------------------------------------
    // SECTION 6: FINALS & 3RD-PLACE RESULTS (ROUND 102 & 103)
    // ------------------------------------------------------------------------
    console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ 🥇 CHUNG KẾT & TRANH HẠNG 3-4 (FINALS & 3RD-PLACE MATCHES)                   │');
    console.log('└──────────────────────────────────────────────────────────────────────────────┘');

    const tpMatch = matches.find((m) => m.stage === 'Tranh hạng 3-4');
    if (tpMatch) {
      console.log('  🥉 Trận Tranh Hạng 3-4:');
      console.log(
        `     ${pad(tpMatch.teamA, 22)} ${pad(tpMatch.scoreA, 2, 'right')} - ${pad(tpMatch.scoreB, 2, 'left')}  ${pad(tpMatch.teamB, 22)}`,
      );
      console.log(`     -> Đội giành hạng 3 (Quý quân) : ${podium.thirdPlace}`);
      console.log(`     -> Đội xếp hạng 4              : ${podium.fourthPlace}\n`);
    }

    const finalMatch = matches.find((m) => m.stage === 'Chung kết');
    if (finalMatch) {
      console.log('  🏆 Trận Chung Kết (Tranh Ngôi Vô Địch):');
      console.log(
        `     ${pad(finalMatch.teamA, 22)} ${pad(finalMatch.scoreA, 2, 'right')} - ${pad(finalMatch.scoreB, 2, 'left')}  ${pad(finalMatch.teamB, 22)}`,
      );
      console.log(`     -> ĐỘI VÔ ĐỊCH (QUÁN QUÂN)    : ${podium.firstPlace}`);
      console.log(`     -> ĐỘI HẠNG NHÌ (Á QUÂN)      : ${podium.secondPlace}\n`);
    }

    // ------------------------------------------------------------------------
    // SECTION 7: GRAND PODIUM TABLE
    // ------------------------------------------------------------------------
    const podWidth = 80;
    console.log('╔' + '═'.repeat(podWidth - 2) + '╗');
    console.log('║ ' + pad('BẢNG VINH DANH GIẢI ĐẤU (GRAND PODIUM)', podWidth - 4, 'center') + ' ║');
    console.log('╠' + '═'.repeat(podWidth - 2) + '╣');
    console.log('║' + ' '.repeat(podWidth - 2) + '║');

    const podiumLines = [
      `  🥇 QUÁN QUÂN (VÔ ĐỊCH) : ${podium.firstPlace}`,
      `  🥈 Á QUÂN (HẠNG NHÌ)   : ${podium.secondPlace}`,
      podium.thirdPlace ? `  🥉 QUÝ QUÂN (HẠNG BA)  : ${podium.thirdPlace}` : null,
      podium.fourthPlace ? `  🎖️  HẠNG TƯ             : ${podium.fourthPlace}` : null,
    ].filter(Boolean);

    for (const pLine of podiumLines) {
      console.log('║ ' + pad(pLine, podWidth - 4, 'left') + ' ║');
    }

    console.log('║' + ' '.repeat(podWidth - 2) + '║');
    console.log('╚' + '═'.repeat(podWidth - 2) + '╝');
    console.log('');
  }
}

// ============================================================================
// 10. PROGRAMMATIC API & CLI RUNNER
// ============================================================================

async function simulateTournament(scenarioOrId, options = {}) {
  let scenario = null;
  if (typeof scenarioOrId === 'number' || typeof scenarioOrId === 'string') {
    scenario = SCENARIOS[parseInt(scenarioOrId, 10)] || SCENARIOS[1];
  } else if (scenarioOrId && typeof scenarioOrId === 'object') {
    scenario = scenarioOrId;
  } else {
    scenario = SCENARIOS[1];
  }

  const store = options.store || (await getStorageAdapter(options));
  const simulator = new DynamicTournamentSimulator(store, options);
  const result = await simulator.runScenario(scenario);

  if (options.printOutput !== false) {
    TournamentAsciiRenderer.render(result, options);
  }

  if (!options.store && store.close) {
    await store.close();
  }

  return result;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.help) {
    printCliHelp();
    process.exit(0);
  }

  try {
    const selectedScenario = SCENARIOS[opts.scenario] || SCENARIOS[1];
    await simulateTournament(selectedScenario, {
      ...opts,
      printOutput: true,
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi thực thi giải lập giải đấu:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCliArgs,
  printCliHelp,
  stringVisualWidth,
  pad,
  InMemoryStore,
  PrismaStore,
  simulatePickleballScore,
  computeGroupStandings,
  computeCrossGroupCandidatePool,
  wheelSpinPairings,
  SCENARIOS,
  DynamicTournamentSimulator,
  TournamentAsciiRenderer,
  simulateTournament,
};
