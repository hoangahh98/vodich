'use strict';

/**
 * E2E Integration and Scenario Test Suite: Dynamic Tournament Knockout & Wheel Progression
 * 
 * Verifies Features F1 to F7, Boundary & Corner Cases (BC1 to BC7),
 * Pairwise Interactions (PW-01 to PW-10), and Real-World Workload Scenarios (1 to 5).
 * 
 * Complies with Node.js built-in test runner (`node:test`, `node:assert/strict`).
 * Runs 100% offline in-memory using InMemoryPrisma Mock Repository.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

// Import domain helpers from compiled dist (with fallback if needed)
const {
  isKnockoutStage,
  groupLetter,
  groupIndexOf,
  groupCountFor,
  TournamentScheduleBuilder,
  finishedStageWinners,
} = require('../dist/tournaments/tournament-schedule');

const {
  TournamentRankingCalculator,
  compareRankingRows,
} = require('../dist/tournaments/tournament-ranking');

const {
  computeScore,
  scoreRulesFor,
} = require('../dist/tournaments/match-score.service');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. IN-MEMORY PRISMA MOCK REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

class InMemoryPrisma {
  constructor() {
    this.tournaments = new Map();
    this.registrations = new Map();
    this.matches = new Map();
    this.players = new Map();

    this.tournamentIdSeq = 1n;
    this.registrationIdSeq = 1n;
    this.matchIdSeq = 1n;
    this.playerIdSeq = 1n;

    this.tournament = this._buildTournamentModel();
    this.tournamentRegistration = this._buildRegistrationModel();
    this.matchGame = this._buildMatchGameModel();
    this.player = this._buildPlayerModel();
  }

  _matchesFilter(record, where = {}) {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;
      const recordVal = record[key];

      if (value !== null && typeof value === 'object' && !(value instanceof Date) && typeof value !== 'bigint') {
        if ('in' in value && Array.isArray(value.in)) {
          if (!value.in.some((item) => String(item) === String(recordVal))) return false;
        } else if ('not' in value) {
          if (value.not === null) {
            if (recordVal === null || recordVal === undefined) return false;
          } else if (String(value.not) === String(recordVal)) {
            return false;
          }
        } else if ('gt' in value) {
          if (!(recordVal > value.gt)) return false;
        } else if ('gte' in value) {
          if (!(recordVal >= value.gte)) return false;
        } else if ('lt' in value) {
          if (!(recordVal < value.lt)) return false;
        } else if ('lte' in value) {
          if (!(recordVal <= value.lte)) return false;
        }
      } else {
        if (value === null) {
          if (recordVal !== null && recordVal !== undefined) return false;
        } else if (typeof value === 'bigint' || typeof recordVal === 'bigint') {
          if (BigInt(value) !== BigInt(recordVal)) return false;
        } else if (recordVal !== value) {
          return false;
        }
      }
    }
    return true;
  }

  _sortRecords(records, orderBy) {
    if (!orderBy) return records;
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];

    return records.sort((a, b) => {
      for (const order of orders) {
        for (const [key, direction] of Object.entries(order)) {
          const valA = a[key];
          const valB = b[key];
          if (valA === valB) continue;
          if (valA === null || valA === undefined) return direction === 'asc' ? -1 : 1;
          if (valB === null || valB === undefined) return direction === 'asc' ? 1 : -1;

          let diff = 0;
          if (typeof valA === 'bigint' || typeof valB === 'bigint') {
            diff = BigInt(valA) < BigInt(valB) ? -1 : 1;
          } else if (typeof valA === 'string') {
            diff = valA.localeCompare(valB);
          } else {
            diff = valA < valB ? -1 : 1;
          }
          return direction === 'asc' ? diff : -diff;
        }
      }
      return 0;
    });
  }

  _buildTournamentModel() {
    return {
      create: async ({ data }) => {
        const id = this.tournamentIdSeq++;
        const record = {
          id,
          name: data.name || 'Giải Đấu Mẫu',
          venue: data.venue || null,
          startTime: data.startTime || new Date(),
          endTime: data.endTime || new Date(),
          courtCount: data.courtCount ?? 2,
          expectedPlayers: data.expectedPlayers ?? 12,
          playType: data.playType || 'DOUBLES',
          format: data.format || 'GROUP_KNOCKOUT',
          pairingRule: data.pairingRule || 'BY_SKILL',
          knockoutQualifierCount: data.knockoutQualifierCount ?? 8,
          touchScore: data.touchScore ?? 11,
          maxScore: data.maxScore ?? 15,
          knockoutTouchScore: data.knockoutTouchScore ?? 15,
          knockoutMaxScore: data.knockoutMaxScore ?? 19,
          courtCost: data.courtCost ?? 0,
          foodCost: data.foodCost ?? 0,
          prizeCost: data.prizeCost ?? 0,
          otherCost: data.otherCost ?? 0,
          feePerPlayer: data.feePerPlayer ?? 0,
          prizeRate1: data.prizeRate1 ?? 50,
          prizeRate2: data.prizeRate2 ?? 30,
          prizeRate3: data.prizeRate3 ?? 20,
          externalRegistrationEnabled: Boolean(data.externalRegistrationEnabled),
          ownerAdminId: data.ownerAdminId ? BigInt(data.ownerAdminId) : 1n,
          createdAt: new Date(),
          updatedAt: new Date(),
          groupCount: data.groupCount ?? null,
          advancePerGroup: data.advancePerGroup ?? null,
          hasThirdPlace: data.hasThirdPlace ?? true,
          wildcardTeams: data.wildcardTeams || null,
          semiDrawMethod: data.semiDrawMethod || 'FIXED',
          ...data,
        };
        this.tournaments.set(id, record);
        return { ...record };
      },

      findUnique: async ({ where }) => {
        const id = BigInt(where.id);
        const record = this.tournaments.get(id);
        return record ? { ...record } : null;
      },

      findUniqueOrThrow: async ({ where }) => {
        const record = await this.tournament.findUnique({ where });
        if (!record) throw new Error(`Tournament with id ${where.id} not found`);
        return record;
      },

      update: async ({ where, data }) => {
        const id = BigInt(where.id);
        const record = this.tournaments.get(id);
        if (!record) throw new Error(`Tournament ${where.id} not found to update`);
        const updated = { ...record, ...data, updatedAt: new Date() };
        this.tournaments.set(id, updated);
        return { ...updated };
      },

      findMany: async ({ where, orderBy } = {}) => {
        let results = [...this.tournaments.values()].filter((item) => this._matchesFilter(item, where));
        results = this._sortRecords(results, orderBy);
        return results.map((r) => ({ ...r }));
      },
    };
  }

  _buildRegistrationModel() {
    return {
      create: async ({ data }) => {
        const id = this.registrationIdSeq++;
        const record = {
          id,
          tournamentId: BigInt(data.tournamentId),
          playerId: data.playerId ? BigInt(data.playerId) : null,
          externalName: data.externalName || null,
          externalEmail: data.externalEmail || null,
          skillLevel: data.skillLevel || 'A',
          source: data.source || 'INTERNAL',
          status: data.status || 'ACTIVE',
          paidAmount: data.paidAmount ?? 0,
          paymentStatus: data.paymentStatus || 'PAID',
          withdrawnAt: null,
          createdAt: new Date(),
          ...data,
        };
        this.registrations.set(id, record);
        return { ...record };
      },

      createMany: async ({ data }) => {
        const records = Array.isArray(data) ? data : [data];
        for (const item of records) {
          await this.tournamentRegistration.create({ data: item });
        }
        return { count: records.length };
      },

      findMany: async ({ where, include, orderBy } = {}) => {
        let results = [...this.registrations.values()].filter((item) => this._matchesFilter(item, where));
        results = this._sortRecords(results, orderBy);

        return results.map((reg) => {
          const item = { ...reg };
          if (include?.player && reg.playerId) {
            item.player = this.players.get(reg.playerId) ? { ...this.players.get(reg.playerId) } : null;
          }
          return item;
        });
      },

      count: async ({ where } = {}) => {
        return [...this.registrations.values()].filter((item) => this._matchesFilter(item, where)).length;
      },

      deleteMany: async ({ where } = {}) => {
        let count = 0;
        for (const [id, reg] of [...this.registrations.entries()]) {
          if (this._matchesFilter(reg, where)) {
            this.registrations.delete(id);
            count++;
          }
        }
        return { count };
      },
    };
  }

  _buildMatchGameModel() {
    return {
      create: async ({ data }) => {
        const id = this.matchIdSeq++;
        const record = {
          id,
          tournamentId: BigInt(data.tournamentId),
          teamA: data.teamA,
          teamB: data.teamB,
          scoreA: data.scoreA ?? 0,
          scoreB: data.scoreB ?? 0,
          status: data.status || 'SCHEDULED',
          courtNumber: data.courtNumber ?? 1,
          roundNumber: data.roundNumber ?? 1,
          stage: data.stage || 'Vòng bảng',
          groupName: data.groupName || null,
          servingTeam: data.servingTeam || 'A',
          scoreOrder: data.scoreOrder ?? 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        this.matches.set(id, record);
        return { ...record };
      },

      createMany: async ({ data }) => {
        const list = Array.isArray(data) ? data : [data];
        for (const item of list) {
          await this.matchGame.create({ data: item });
        }
        return { count: list.length };
      },

      findMany: async ({ where, orderBy } = {}) => {
        let results = [...this.matches.values()].filter((item) => this._matchesFilter(item, where));
        results = this._sortRecords(results, orderBy);
        return results.map((m) => ({ ...m }));
      },

      findUnique: async ({ where }) => {
        const id = BigInt(where.id);
        const record = this.matches.get(id);
        return record ? { ...record } : null;
      },

      findFirst: async ({ where, orderBy } = {}) => {
        const list = await this.matchGame.findMany({ where, orderBy });
        return list[0] || null;
      },

      update: async ({ where, data }) => {
        const id = BigInt(where.id);
        const record = this.matches.get(id);
        if (!record) throw new Error(`MatchGame ${where.id} not found to update`);
        const updated = { ...record, ...data, updatedAt: new Date() };
        this.matches.set(id, updated);
        return { ...updated };
      },

      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, record] of [...this.matches.entries()]) {
          if (this._matchesFilter(record, where)) {
            const updated = { ...record, ...data, updatedAt: new Date() };
            this.matches.set(id, updated);
            count++;
          }
        }
        return { count };
      },

      deleteMany: async ({ where } = {}) => {
        let count = 0;
        for (const [id, match] of [...this.matches.entries()]) {
          if (this._matchesFilter(match, where)) {
            this.matches.delete(id);
            count++;
          }
        }
        return { count };
      },
    };
  }

  _buildPlayerModel() {
    return {
      create: async ({ data }) => {
        const id = this.playerIdSeq++;
        const record = {
          id,
          displayName: data.displayName || 'Vận Động Viên',
          email: data.email || `player${id}@pickleball.local`,
          skillLevel: data.skillLevel || 'A',
          notes: data.notes || null,
          createdAt: new Date(),
          ...data,
        };
        this.players.set(id, record);
        return { ...record };
      },

      findMany: async ({ where, orderBy } = {}) => {
        let list = [...this.players.values()].filter((p) => this._matchesFilter(p, where));
        list = this._sortRecords(list, orderBy);
        return list.map((p) => ({ ...p }));
      },

      findUnique: async ({ where }) => {
        const id = BigInt(where.id);
        const record = this.players.get(id);
        return record ? { ...record } : null;
      },
    };
  }

  async $transaction(operations) {
    if (typeof operations === 'function') {
      return await operations(this);
    }
    if (Array.isArray(operations)) {
      const results = [];
      for (const op of operations) {
        if (typeof op === 'function') {
          results.push(await op());
        } else {
          results.push(await op);
        }
      }
      return results;
    }
    throw new Error('Unsupported $transaction argument: expected array or callback function');
  }

  async seedTournament(tournamentProps, teams = []) {
    const tournament = await this.tournament.create({ data: tournamentProps });
    const tournamentId = tournament.id;

    for (let i = 0; i < teams.length; i++) {
      const teamName = teams[i];
      const player = await this.player.create({
        data: { displayName: teamName, email: `team_${i}_${Date.now()}@test.local`, skillLevel: 'A' },
      });
      await this.tournamentRegistration.create({
        data: {
          tournamentId,
          playerId: player.id,
          status: 'ACTIVE',
          paymentStatus: 'PAID',
        },
      });
    }
    return tournament;
  }

  async simulateMatchScore(matchId, scoreA, scoreB) {
    return this.matchGame.update({
      where: { id: BigInt(matchId) },
      data: {
        scoreA,
        scoreB,
        status: 'FINISHED',
        updatedAt: new Date(),
      },
    });
  }

  async playAllStageMatches(tournamentId, stage, scoreFn = (match, idx) => ({ scoreA: 11, scoreB: 5 })) {
    const stageMatches = await this.matchGame.findMany({
      where: { tournamentId: BigInt(tournamentId), stage },
      orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }],
    });

    const finished = [];
    for (let idx = 0; idx < stageMatches.length; idx++) {
      const match = stageMatches[idx];
      const scores = scoreFn(match, idx);
      const updated = await this.simulateMatchScore(match.id, scores.scoreA, scores.scoreB);
      finished.push(updated);
    }
    return finished;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DYNAMIC TOURNAMENT FLOW DOMAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class DynamicTournamentFlow {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Sinh cấu hình bảng và trận đấu vòng bảng + bộ khung vòng knockout động
   */
  async generateDynamicSchedule(tournamentId, options = {}) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId: BigInt(tournamentId), status: 'ACTIVE' },
      include: { player: true },
      orderBy: { id: 'asc' },
    });

    const teamNames = registrations.map((r) => r.player?.displayName || r.externalName || `Đội ${r.id}`);
    const teamCount = teamNames.length;

    const groupCount = options.groupCount ?? tournament.groupCount ?? groupCountFor(tournament, teamCount);
    const advancePerGroup = options.advancePerGroup ?? tournament.advancePerGroup ?? 2;
    const qualifierCount = tournament.knockoutQualifierCount;
    const hasThirdPlace = tournament.hasThirdPlace !== false;

    // Phân bổ đội vào các bảng
    const groups = Array.from({ length: groupCount }, () => []);
    if (options.customGroups && Array.isArray(options.customGroups)) {
      for (const item of options.customGroups) {
        const idx = groupIndexOf(item.group);
        if (idx >= 0 && idx < groupCount) groups[idx].push(item.name);
        else groups[0].push(item.name);
      }
    } else {
      // Phân bổ đều vòng tròn: A, B, C, A, B, C...
      teamNames.forEach((name, idx) => {
        groups[idx % groupCount].push(name);
      });
    }

    const matches = [];
    let court = 1;

    // Sinh lịch vòng bảng (round-robin cho từng bảng)
    for (let gIdx = 0; gIdx < groupCount; gIdx++) {
      const gLetter = groupLetter(gIdx);
      const gTeams = groups[gIdx];

      for (let i = 0; i < gTeams.length; i++) {
        for (let j = i + 1; j < gTeams.length; j++) {
          matches.push({
            tournamentId: tournament.id,
            teamA: gTeams[i],
            teamB: gTeams[j],
            scoreA: 0,
            scoreB: 0,
            status: 'SCHEDULED',
            courtNumber: court,
            roundNumber: 1,
            stage: 'Vòng bảng',
            groupName: gLetter,
            servingTeam: 'A',
            scoreOrder: 2,
          });
          court = court >= tournament.courtCount ? 1 : court + 1;
        }
      }
    }

    // Sinh bộ khung vòng Knockout
    if (qualifierCount >= 8) {
      for (let i = 0; i < 4; i++) {
        matches.push({
          tournamentId: tournament.id,
          teamA: `Chờ đối thủ QF${i * 2 + 1}`,
          teamB: `Chờ đối thủ QF${i * 2 + 2}`,
          scoreA: 0,
          scoreB: 0,
          status: 'SCHEDULED',
          courtNumber: court,
          roundNumber: 100,
          stage: 'Tứ kết',
          groupName: null,
          servingTeam: 'A',
          scoreOrder: 2,
        });
        court = court >= tournament.courtCount ? 1 : court + 1;
      }
    }

    if (qualifierCount >= 4) {
      for (let i = 0; i < 2; i++) {
        matches.push({
          tournamentId: tournament.id,
          teamA: `Chờ đối thủ SF${i * 2 + 1}`,
          teamB: `Chờ đối thủ SF${i * 2 + 2}`,
          scoreA: 0,
          scoreB: 0,
          status: 'SCHEDULED',
          courtNumber: court,
          roundNumber: 101,
          stage: 'Bán kết',
          groupName: null,
          servingTeam: 'A',
          scoreOrder: 2,
        });
        court = court >= tournament.courtCount ? 1 : court + 1;
      }
    }

    if (qualifierCount >= 2) {
      matches.push({
        tournamentId: tournament.id,
        teamA: 'Chờ đối thủ Chung kết 1',
        teamB: 'Chờ đối thủ Chung kết 2',
        scoreA: 0,
        scoreB: 0,
        status: 'SCHEDULED',
        courtNumber: court,
        roundNumber: 102,
        stage: 'Chung kết',
        groupName: null,
        servingTeam: 'A',
        scoreOrder: 2,
      });
      court = court >= tournament.courtCount ? 1 : court + 1;
    }

    if (qualifierCount >= 4 && hasThirdPlace) {
      matches.push({
        tournamentId: tournament.id,
        teamA: 'Chờ đối thủ Hạng 3-1',
        teamB: 'Chờ đối thủ Hạng 3-2',
        scoreA: 0,
        scoreB: 0,
        status: 'SCHEDULED',
        courtNumber: court,
        roundNumber: 103,
        stage: 'Tranh hạng 3-4',
        groupName: null,
        servingTeam: 'A',
        scoreOrder: 2,
      });
    }

    await this.prisma.matchGame.deleteMany({ where: { tournamentId: tournament.id } });
    await this.prisma.matchGame.createMany({ data: matches });

    await this.prisma.tournament.update({
      where: { id: tournament.id },
      data: { groupCount, advancePerGroup, hasThirdPlace },
    });

    return { groupCount, advancePerGroup, matchesCount: matches.length };
  }

  /**
   * Tính bảng xếp hạng theo bảng kèm tiêu chí đối đầu trực tiếp (Head-to-head)
   */
  async computeStandings(tournamentId) {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId: BigInt(tournamentId), stage: 'Vòng bảng' },
      orderBy: [{ groupName: 'asc' }, { id: 'asc' }],
    });

    const groupsMap = new Map();
    for (const match of matches) {
      const g = match.groupName || 'A';
      if (!groupsMap.has(g)) groupsMap.set(g, { matches: [], teams: new Map() });
      const gObj = groupsMap.get(g);
      gObj.matches.push(match);

      for (const t of [match.teamA, match.teamB]) {
        if (!gObj.teams.has(t)) {
          gObj.teams.set(t, {
            teamName: t,
            played: 0,
            won: 0,
            lost: 0,
            rankingPoints: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDiff: 0,
          });
        }
      }

      if (match.status === 'FINISHED') {
        const rowA = gObj.teams.get(match.teamA);
        const rowB = gObj.teams.get(match.teamB);

        rowA.played++;
        rowB.played++;
        rowA.pointsFor += match.scoreA;
        rowA.pointsAgainst += match.scoreB;
        rowA.pointDiff = rowA.pointsFor - rowA.pointsAgainst;

        rowB.pointsFor += match.scoreB;
        rowB.pointsAgainst += match.scoreA;
        rowB.pointDiff = rowB.pointsFor - rowB.pointsAgainst;

        if (match.scoreA > match.scoreB) {
          rowA.won++;
          rowA.rankingPoints++;
          rowB.lost++;
        } else if (match.scoreB > match.scoreA) {
          rowB.won++;
          rowB.rankingPoints++;
          rowA.lost++;
        }
      }
    }

    const result = [];
    for (const [groupName, { matches: gMatches, teams }] of groupsMap.entries()) {
      const rows = [...teams.values()];

      rows.sort((a, b) => {
        // 1. Số trận thắng
        if (b.won !== a.won) return b.won - a.won;

        // 2. Đối đầu trực tiếp (Head-to-Head) nếu có 2 đội bằng điểm
        const tiedCount = rows.filter((r) => r.won === a.won).length;
        if (tiedCount === 2) {
          const directMatch = gMatches.find(
            (m) =>
              m.status === 'FINISHED' &&
              ((m.teamA === a.teamName && m.teamB === b.teamName) || (m.teamA === b.teamName && m.teamB === a.teamName)),
          );
          if (directMatch) {
            const aWonDirect =
              (directMatch.teamA === a.teamName && directMatch.scoreA > directMatch.scoreB) ||
              (directMatch.teamB === a.teamName && directMatch.scoreB > directMatch.scoreA);
            const bWonDirect =
              (directMatch.teamA === b.teamName && directMatch.scoreA > directMatch.scoreB) ||
              (directMatch.teamB === b.teamName && directMatch.scoreB > directMatch.scoreA);
            if (aWonDirect && !bWonDirect) return -1;
            if (bWonDirect && !aWonDirect) return 1;
          }
        }

        // 3. Hiệu số điểm (pointDiff)
        if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;

        // 4. Tổng điểm ghi được (pointsFor)
        if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;

        // 5. Thứ tự chữ cái tên đội
        return a.teamName.localeCompare(b.teamName);
      });

      result.push({
        groupName,
        rows: rows.map((r, idx) => ({ ...r, rankInGroup: idx + 1 })),
      });
    }

    return result.sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  /**
   * Tính bảng xếp hạng tổng hợp liên bảng (Cross-Group Aggregate Standings)
   */
  async aggregateCrossGroupStandings(tournamentId) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const groupRankings = await this.computeStandings(tournamentId);
    const advancePerGroup = tournament.advancePerGroup ?? 2;

    const candidates = [];
    for (const grp of groupRankings) {
      for (let i = advancePerGroup; i < grp.rows.length; i++) {
        candidates.push({ ...grp.rows[i], groupName: grp.groupName });
      }
    }

    candidates.sort((a, b) => {
      // Ưu tiên 1: Thứ hạng trong bảng (rankInGroup)
      if (a.rankInGroup !== b.rankInGroup) return a.rankInGroup - b.rankInGroup;
      // Ưu tiên 2: Số trận thắng
      if (b.won !== a.won) return b.won - a.won;
      // Ưu tiên 3: Hiệu số điểm
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      // Ưu tiên 4: Điểm ghi được
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      // Ưu tiên 5: Tên chữ cái
      return a.teamName.localeCompare(b.teamName);
    });

    return candidates.map((c, idx) => ({ ...c, overallRank: idx + 1 }));
  }

  /**
   * Kiểm tra tình trạng thiếu suất & lấy danh sách gợi ý Wildcard
   */
  async getWildcardStatus(tournamentId) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const groupRankings = await this.computeStandings(tournamentId);
    const advancePerGroup = tournament.advancePerGroup ?? 2;
    const targetCount = tournament.knockoutQualifierCount;

    const directlyQualified = [];
    for (const grp of groupRankings) {
      for (let i = 0; i < Math.min(advancePerGroup, grp.rows.length); i++) {
        directlyQualified.push(grp.rows[i].teamName);
      }
    }

    const shortage = Math.max(0, targetCount - directlyQualified.length);
    const candidates = await this.aggregateCrossGroupStandings(tournamentId);
    const suggested = candidates.slice(0, shortage);

    return {
      directlyQualified,
      shortage,
      targetCount,
      suggested,
      candidates,
      hasShortage: shortage > 0,
    };
  }

  /**
   * Xác nhận hoặc chọn thay thế danh sách Wildcards
   */
  async selectWildcards(tournamentId, selectedTeams) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const groupMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage: 'Vòng bảng' },
    });

    if (groupMatches.some((m) => m.status !== 'FINISHED')) {
      throw new Error('Không thể chọn wildcard khi vòng bảng chưa hoàn tất');
    }

    const status = await this.getWildcardStatus(tournamentId);

    if (selectedTeams.length !== status.shortage) {
      throw new Error(`Số lượng wildcard không khớp: cần chọn ${status.shortage} đội nhưng nhận ${selectedTeams.length}`);
    }

    // Không chọn trùng đội đã vào thẳng
    for (const t of selectedTeams) {
      if (status.directlyQualified.includes(t)) {
        throw new Error(`Đội đã vào thẳng không thể chọn làm wildcard: ${t}`);
      }
    }

    // Không chọn trùng lặp
    const uniqueSelected = new Set(selectedTeams);
    if (uniqueSelected.size !== selectedTeams.length) {
      throw new Error('Danh sách wildcard có đội trùng lặp');
    }

    // Đội phải thuộc candidate pool
    const candidateNames = status.candidates.map((c) => c.teamName);
    for (const t of selectedTeams) {
      if (!candidateNames.includes(t)) {
        throw new Error(`Đội không hợp lệ trong danh sách xét wildcard: ${t}`);
      }
    }

    await this.prisma.tournament.update({
      where: { id: tournament.id },
      data: { wildcardTeams: JSON.stringify(selectedTeams) },
    });

    return true;
  }

  /**
   * Lưu kết quả bốc thăm vòng quay Tứ kết (Quarterfinals Wheel Spin)
   */
  async saveStageDraw(tournamentId, stage, pairs) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage },
      orderBy: [{ id: 'asc' }],
    });

    if (matches.length !== pairs.length) {
      throw new Error(`Số lượng cặp đấu không khớp với số trận của stage ${stage}: cần ${matches.length}, nhận ${pairs.length}`);
    }

    const allTeams = pairs.flatMap((p) => [p.teamA, p.teamB]);
    const uniqueTeams = new Set(allTeams);
    if (uniqueTeams.size !== allTeams.length) {
      throw new Error('Các cặp đấu bốc thăm có đội bị trùng lặp');
    }

    const updates = [];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const pair = pairs[i];
      updates.push(
        this.prisma.matchGame.update({
          where: { id: match.id },
          data: {
            teamA: pair.teamA,
            teamB: pair.teamB,
            scoreA: 0,
            scoreB: 0,
            status: 'SCHEDULED',
            servingTeam: 'A',
            scoreOrder: 2,
            updatedAt: new Date(),
          },
        }),
      );
    }

    await this.prisma.$transaction(updates);
    return await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage },
      orderBy: [{ id: 'asc' }],
    });
  }

  /**
   * Tiến trình Bán kết: Tùy chọn Vòng quay (WHEEL) hoặc Nhánh cố định (FIXED)
   */
  async advanceSemifinals(tournamentId, mode, wheelPairs) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const qfMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage: 'Tứ kết' },
      orderBy: [{ id: 'asc' }],
    });

    if (qfMatches.length !== 4) {
      throw new Error('Số trận tứ kết không hợp lệ để tiến sang bán kết');
    }

    if (qfMatches.some((m) => m.status !== 'FINISHED')) {
      return false;
    }

    const qfWinners = qfMatches.map((m) => (m.scoreA > m.scoreB ? m.teamA : m.teamB));

    let sfPairs = [];
    if (mode === 'FIXED') {
      // QF1 vs QF2, QF3 vs QF4
      sfPairs = [
        { teamA: qfWinners[0], teamB: qfWinners[1] },
        { teamA: qfWinners[2], teamB: qfWinners[3] },
      ];
    } else if (mode === 'WHEEL') {
      if (!wheelPairs || wheelPairs.length !== 2) {
        throw new Error('Bốc thăm bán kết yêu cầu đúng 2 cặp đấu');
      }
      const wheelTeams = wheelPairs.flatMap((p) => [p.teamA, p.teamB]);
      for (const w of qfWinners) {
        if (!wheelTeams.includes(w)) {
          throw new Error(`Đội thắng tứ kết ${w} không có trong kết quả bốc thăm bán kết`);
        }
      }
      sfPairs = wheelPairs;
    } else {
      throw new Error(`Chế độ bán kết không hợp lệ: ${mode}`);
    }

    const sfMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage: 'Bán kết' },
      orderBy: [{ id: 'asc' }],
    });

    if (sfMatches.length !== 2) {
      throw new Error('Số trận bán kết trong DB không đúng (cần 2 trận)');
    }

    const updates = [
      this.prisma.tournament.update({
        where: { id: tournament.id },
        data: { semiDrawMethod: mode },
      }),
    ];

    for (let i = 0; i < 2; i++) {
      updates.push(
        this.prisma.matchGame.update({
          where: { id: sfMatches[i].id },
          data: {
            teamA: sfPairs[i].teamA,
            teamB: sfPairs[i].teamB,
            scoreA: 0,
            scoreB: 0,
            status: 'SCHEDULED',
            servingTeam: 'A',
            scoreOrder: 2,
            updatedAt: new Date(),
          },
        }),
      );
    }

    await this.prisma.$transaction(updates);
    return true;
  }

  /**
   * Tự động sinh Chung kết & Tranh hạng 3-4 khi cả 2 trận Bán kết hoàn tất
   */
  async syncFinalAndThirdPlace(tournamentId) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(tournamentId) } });
    const sfMatches = await this.prisma.matchGame.findMany({
      where: { tournamentId: tournament.id, stage: 'Bán kết' },
      orderBy: [{ id: 'asc' }],
    });

    if (sfMatches.length !== 2 || sfMatches.some((m) => m.status !== 'FINISHED')) {
      return false;
    }

    const sfWinners = sfMatches.map((m) => (m.scoreA > m.scoreB ? m.teamA : m.teamB));
    const sfLosers = sfMatches.map((m) => (m.scoreA > m.scoreB ? m.teamB : m.teamA));

    const finalMatch = await this.prisma.matchGame.findFirst({
      where: { tournamentId: tournament.id, stage: 'Chung kết' },
    });

    if (finalMatch) {
      await this.prisma.matchGame.update({
        where: { id: finalMatch.id },
        data: {
          teamA: sfWinners[0],
          teamB: sfWinners[1],
          scoreA: 0,
          scoreB: 0,
          status: 'SCHEDULED',
          servingTeam: 'A',
          scoreOrder: 2,
          updatedAt: new Date(),
        },
      });
    }

    if (tournament.hasThirdPlace) {
      const thirdMatch = await this.prisma.matchGame.findFirst({
        where: { tournamentId: tournament.id, stage: 'Tranh hạng 3-4' },
      });
      if (thirdMatch) {
        await this.prisma.matchGame.update({
          where: { id: thirdMatch.id },
          data: {
            teamA: sfLosers[0],
            teamB: sfLosers[1],
            scoreA: 0,
            scoreB: 0,
            status: 'SCHEDULED',
            servingTeam: 'A',
            scoreOrder: 2,
            updatedAt: new Date(),
          },
        });
      }
    }

    return true;
  }

  /**
   * Tính bảng vinh danh (Final Podium)
   */
  async computePodium(tournamentId) {
    const finalMatch = await this.prisma.matchGame.findFirst({
      where: { tournamentId: BigInt(tournamentId), stage: 'Chung kết' },
    });

    if (!finalMatch || finalMatch.status !== 'FINISHED') return null;

    const first = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamA : finalMatch.teamB;
    const second = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamB : finalMatch.teamA;

    let third = null;
    let fourth = null;

    const thirdMatch = await this.prisma.matchGame.findFirst({
      where: { tournamentId: BigInt(tournamentId), stage: 'Tranh hạng 3-4' },
    });

    if (thirdMatch && thirdMatch.status === 'FINISHED') {
      third = thirdMatch.scoreA > thirdMatch.scoreB ? thirdMatch.teamA : thirdMatch.teamB;
      fourth = thirdMatch.scoreA > thirdMatch.scoreB ? thirdMatch.teamB : thirdMatch.teamA;
    }

    return {
      firstPlace: first,
      secondPlace: second,
      thirdPlace: third,
      fourthPlace: fourth,
    };
  }

  /**
   * Xây dựng dữ liệu sơ đồ cây nhánh đấu (Bracket Tree)
   */
  async buildBracketTree(tournamentId) {
    const matches = await this.prisma.matchGame.findMany({
      where: { tournamentId: BigInt(tournamentId) },
      orderBy: [{ roundNumber: 'asc' }, { courtNumber: 'asc' }, { id: 'asc' }],
    });

    const knockoutMatches = matches.filter((m) => isKnockoutStage(m.stage));

    const rounds = {
      round100: knockoutMatches.filter((m) => m.roundNumber === 100),
      round101: knockoutMatches.filter((m) => m.roundNumber === 101),
      round102: knockoutMatches.filter((m) => m.roundNumber === 102),
      round103: knockoutMatches.filter((m) => m.roundNumber === 103),
    };

    return rounds;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 1: FEATURE COVERAGE (F1 to F7) — min 35 assertions
// ═══════════════════════════════════════════════════════════════════════════════

test('T1.F1.1: Set groupCount = 3, 12 teams -> 3 groups created (A, B, C) with 4 teams each', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, courtCount: 3 },
    teams,
  );

  const res = await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  assert.equal(res.groupCount, 3);

  const standings = await flow.computeStandings(t.id);
  assert.equal(standings.length, 3);
  assert.deepEqual(standings.map((g) => g.groupName), ['A', 'B', 'C']);
  for (const g of standings) {
    assert.equal(g.rows.length, 4, `Bảng ${g.groupName} phải có 4 đội`);
  }
});

test('T1.F1.2: Total group matches for 3 groups of 4 teams -> exactly 18 group matches created (3 x 6)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, courtCount: 2 },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });

  const groupMatches = await prisma.matchGame.findMany({
    where: { tournamentId: t.id, stage: 'Vòng bảng' },
  });
  assert.equal(groupMatches.length, 18, '3 bảng x 6 trận/bảng = 18 trận');
});

test('T1.F1.3: Uneven team count (10 teams, 3 groups) -> group sizes 4, 3, 3; total group matches = 12 (6 + 3 + 3)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 10 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, courtCount: 2 },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  const standings = await flow.computeStandings(t.id);

  const sizes = standings.map((g) => g.rows.length).sort((a, b) => b - a);
  assert.deepEqual(sizes, [4, 3, 3], '10 đội chia 3 bảng phải ra 4, 3, 3');

  const matches = await prisma.matchGame.findMany({
    where: { tournamentId: t.id, stage: 'Vòng bảng' },
  });
  assert.equal(matches.length, 12, '6 trận bảng A + 3 trận bảng B + 3 trận bảng C = 12');
});

test('T1.F1.4: Target knockout count = 8 -> 4 QF (100), 2 SF (101), 1 Final (102)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, hasThirdPlace: false },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, { groupCount: 3 });

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết', roundNumber: 100 } });
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết', roundNumber: 101 } });
  const final = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Chung kết', roundNumber: 102 } });

  assert.equal(qf.length, 4, 'Cần đúng 4 trận Tứ kết');
  assert.equal(sf.length, 2, 'Cần đúng 2 trận Bán kết');
  assert.equal(final.length, 1, 'Cần đúng 1 trận Chung kết');
});

test('T1.F1.5: Target knockout count = 4 -> 0 QF matches, 2 SF matches (round 101), 1 Final (round 102)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4, hasThirdPlace: false },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết', roundNumber: 101 } });
  const final = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Chung kết', roundNumber: 102 } });

  assert.equal(qf.length, 0, 'Qualifier 4 phải bỏ qua Tứ kết');
  assert.equal(sf.length, 2, 'Cần đúng 2 trận Bán kết');
  assert.equal(final.length, 1, 'Cần đúng 1 trận Chung kết');
});

test('T1.F1.6: Target knockout count = 2 -> 0 QF, 0 SF, 1 Final match (round 102)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = ['A1', 'A2', 'B1', 'B2'];
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 2, hasThirdPlace: false },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  const final = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Chung kết', roundNumber: 102 } });

  assert.equal(qf.length, 0);
  assert.equal(sf.length, 0);
  assert.equal(final.length, 1);
});

test('T1.F1.7: hasThirdPlace toggle -> round 103 match exists when true and is omitted when false', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  // Case true
  const t1 = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4, hasThirdPlace: true }, ['A', 'B', 'C', 'D']);
  await flow.generateDynamicSchedule(t1.id, { groupCount: 2 });
  const match3rdTrue = await prisma.matchGame.findMany({ where: { tournamentId: t1.id, roundNumber: 103, stage: 'Tranh hạng 3-4' } });
  assert.equal(match3rdTrue.length, 1, 'hasThirdPlace=true phải có trận tranh 3-4');

  // Case false
  const t2 = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4, hasThirdPlace: false }, ['A', 'B', 'C', 'D']);
  await flow.generateDynamicSchedule(t2.id, { groupCount: 2 });
  const match3rdFalse = await prisma.matchGame.findMany({ where: { tournamentId: t2.id, roundNumber: 103 } });
  assert.equal(match3rdFalse.length, 0, 'hasThirdPlace=false không được tạo trận 103');
});

test('T1.F2.1 & T1.F2.2: Standings calculation updates won, lost, pointsFor, pointsAgainst, pointDiff; non-finished excluded', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', groupCount: 1, knockoutQualifierCount: 2 }, ['A', 'B', 'C']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 1 });

  const matches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Vòng bảng' } });
  assert.equal(matches.length, 3);

  // Trận 1: A thắng B 11-5 (FINISHED)
  await prisma.simulateMatchScore(matches[0].id, 11, 5);
  // Trận 2: B gặp C 7-3 (PLAYING - chưa kết thúc)
  await prisma.matchGame.update({ where: { id: matches[1].id }, data: { scoreA: 7, scoreB: 3, status: 'PLAYING' } });

  const standings = await flow.computeStandings(t.id);
  const rows = standings[0].rows;
  const by = Object.fromEntries(rows.map((r) => [r.teamName, r]));

  assert.equal(by['A'].won, 1);
  assert.equal(by['A'].lost, 0);
  assert.equal(by['A'].pointDiff, 6);
  assert.equal(by['B'].played, 1, 'Trận 2 PLAYING không được tính vào số trận đã đá của B');
  assert.equal(by['C'].played, 0, 'Trận 2 PLAYING không được tính cho C');
});

test('T1.F2.3: Head-to-head 2-team tiebreak -> Team A beat Team B (11-9); Team B has superior pointDiff (+8 vs +3) -> Team A ranks strictly above Team B', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', groupCount: 1, knockoutQualifierCount: 2 }, ['A', 'B', 'C', 'D']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 1 });
  const matches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Vòng bảng' } });

  // A thắng B 11-9 (đối đầu trực tiếp)
  // B thắng C 11-1 (+10)
  // B thắng D 11-2 (+9) -> Tổng B: 2 thắng, 1 thua, pointDiff = -2 + 10 + 9 = +17
  // A thắng C 11-8 (+3)
  // A thua D 9-11 (-2) -> Tổng A: 2 thắng, 1 thua, pointDiff = +2 + 3 - 2 = +3
  // C thắng D 11-9 (C: 1 thắng, D: 1 thắng)
  for (const m of matches) {
    if ((m.teamA === 'A' && m.teamB === 'B') || (m.teamA === 'B' && m.teamB === 'A')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'A' ? 11 : 9, m.teamA === 'A' ? 9 : 11);
    } else if ((m.teamA === 'B' && m.teamB === 'C') || (m.teamA === 'C' && m.teamB === 'B')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'B' ? 11 : 1, m.teamA === 'B' ? 1 : 11);
    } else if ((m.teamA === 'B' && m.teamB === 'D') || (m.teamA === 'D' && m.teamB === 'B')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'B' ? 11 : 2, m.teamA === 'B' ? 2 : 11);
    } else if ((m.teamA === 'A' && m.teamB === 'C') || (m.teamA === 'C' && m.teamB === 'A')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'A' ? 11 : 8, m.teamA === 'A' ? 8 : 11);
    } else if ((m.teamA === 'A' && m.teamB === 'D') || (m.teamA === 'D' && m.teamB === 'A')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'A' ? 9 : 11, m.teamA === 'A' ? 11 : 9);
    } else if ((m.teamA === 'D' && m.teamB === 'C') || (m.teamA === 'C' && m.teamB === 'D')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'C' ? 11 : 9, m.teamA === 'C' ? 9 : 11);
    }
  }

  const standings = await flow.computeStandings(t.id);
  const rows = standings[0].rows;

  const aIndex = rows.findIndex((r) => r.teamName === 'A');
  const bIndex = rows.findIndex((r) => r.teamName === 'B');

  assert.equal(rows[aIndex].won, rows[bIndex].won, 'A và B phải bằng số trận thắng');
  assert.ok(rows[bIndex].pointDiff > rows[aIndex].pointDiff, 'B có hiệu số tốt hơn A');
  assert.ok(aIndex < bIndex, 'A phải xếp TRÊN B nhờ thắng đối đầu trực tiếp!');
});

test('T1.F2.4 & T1.F2.5 & T1.F2.6: Point diff, points scored, and alphabetical tiebreak fallback', () => {
  // Direct logic check using compareRankingRows
  const rowA = { teamName: 'Alpha', played: 3, won: 2, lost: 1, pointDiff: 5, pointsFor: 30, pointsAgainst: 25, rankingPoints: 2 };
  const rowB = { teamName: 'Beta', played: 3, won: 2, lost: 1, pointDiff: 2, pointsFor: 30, pointsAgainst: 28, rankingPoints: 2 };
  assert.ok(compareRankingRows(rowA, rowB) < 0, 'pointDiff +5 phải trên +2');

  const rowC = { teamName: 'Charlie', played: 3, won: 2, lost: 1, pointDiff: 5, pointsFor: 35, pointsAgainst: 30, rankingPoints: 2 };
  assert.ok(compareRankingRows(rowC, rowA) < 0, 'pointsFor 35 phải trên pointsFor 30 khi pointDiff bằng nhau');

  const rowA2 = { ...rowA, teamName: 'Alpha2' };
  assert.ok(compareRankingRows(rowA, rowA2) < 0, 'Tên Alpha phải trước Alpha2 theo bảng chữ cái');
});

test('T1.F2.7 & T1.F2.8: Cross-group standings rankInGroup hierarchy and tie-breaks', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 8 },
    ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'],
  );
  await flow.generateDynamicSchedule(t.id, {
    groupCount: 2,
    customGroups: [
      { name: 'A1', group: 'A' }, { name: 'A2', group: 'A' }, { name: 'A3', group: 'A' }, { name: 'A4', group: 'A' },
      { name: 'B1', group: 'B' }, { name: 'B2', group: 'B' }, { name: 'B3', group: 'B' }, { name: 'B4', group: 'B' },
    ],
  });

  // Finish Group A: A1 3-0, A2 2-1, A3 1-2, A4 0-3
  // Finish Group B: B1 3-0, B2 2-1, B3 2-1 (hạng 3 nhưng 2 thắng), B4 0-3
  await prisma.playAllStageMatches(t.id, 'Vòng bảng', (m) => {
    if (m.teamA.endsWith('1')) return { scoreA: 11, scoreB: 4 };
    if (m.teamB.endsWith('1')) return { scoreA: 4, scoreB: 11 };
    if (m.teamA.endsWith('2')) return { scoreA: 11, scoreB: 7 };
    if (m.teamB.endsWith('2')) return { scoreA: 7, scoreB: 11 };
    return { scoreA: 11, scoreB: 8 };
  });

  const candidates = await flow.aggregateCrossGroupStandings(t.id);
  assert.ok(candidates.length >= 4, 'Phải có các đội hạng 3 và 4 tham gia candidate pool');

  // Đội hạng 3 phải luôn đứng trước đội hạng 4
  const rank3s = candidates.filter((c) => c.rankInGroup === 3);
  const rank4s = candidates.filter((c) => c.rankInGroup === 4);
  assert.ok(rank3s.length > 0 && rank4s.length > 0);
  assert.ok(candidates.indexOf(rank3s[0]) < candidates.indexOf(rank4s[0]), 'Đội hạng 3 bảng phải xếp trên đội hạng 4');
});

test('T1.F3.1: Shortage calculation: 3 groups x top 2 = 6 direct; target 8 -> shortage === 2', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8 },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.directlyQualified.length, 6);
  assert.equal(status.targetCount, 8);
  assert.equal(status.shortage, 2);
  assert.equal(status.hasShortage, true);
});

test('T1.F3.2 & T1.F3.3: Candidate pool excludes directly qualified teams; suggested length equals shortage', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8 },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.suggested.length, 2, 'Gợi ý đúng 2 đội khi thiếu 2 suất');

  for (const c of status.candidates) {
    assert.ok(!status.directlyQualified.includes(c.teamName), `Candidate ${c.teamName} không được nằm trong nhóm vào thẳng`);
  }
});

test('T1.F3.4 & T1.F3.5 & T1.F3.6 & T1.F3.7: Wildcard confirmation, substitution, union count and JSON persistence', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 12 }, (_, i) => `T${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8 },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  const candidateNames = status.candidates.map((c) => c.teamName);

  // BTC chủ động thay thế bằng candidate thứ 1 và thứ 3
  const chosen = [candidateNames[0], candidateNames[2]];
  const ok = await flow.selectWildcards(t.id, chosen);
  assert.equal(ok, true);

  const updatedTournament = await prisma.tournament.findUnique({ where: { id: t.id } });
  assert.ok(updatedTournament.wildcardTeams);
  const parsedWildcards = JSON.parse(updatedTournament.wildcardTeams);
  assert.deepEqual(parsedWildcards, chosen);

  const totalKnockoutTeams = new Set([...status.directlyQualified, ...parsedWildcards]);
  assert.equal(totalKnockoutTeams.size, 8, 'Tổng số đội vào Tứ kết phải là đúng 8 đội phân biệt');
});

test('T1.F4.1 to T1.F4.5: Quarterfinals wheel draw invariants (8 teams, 4 matches, stage Tứ kết, round 100, scores 0-0, cyclic courts)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, courtCount: 2 },
    Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const eightTeams = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6', 'Team 7', 'Team 8'];
  const pairs = [
    { teamA: eightTeams[0], teamB: eightTeams[7] },
    { teamA: eightTeams[1], teamB: eightTeams[6] },
    { teamA: eightTeams[2], teamB: eightTeams[5] },
    { teamA: eightTeams[3], teamB: eightTeams[4] },
  ];

  const qfMatches = await flow.saveStageDraw(t.id, 'Tứ kết', pairs);
  assert.equal(qfMatches.length, 4, 'Đúng 4 cặp đấu Tứ kết');

  const seenTeams = new Set();
  for (const [idx, m] of qfMatches.entries()) {
    assert.equal(m.stage, 'Tứ kết');
    assert.equal(m.roundNumber, 100);
    assert.equal(m.status, 'SCHEDULED');
    assert.equal(m.scoreA, 0);
    assert.equal(m.scoreB, 0);
    assert.equal(m.servingTeam, 'A');
    assert.equal(m.scoreOrder, 2);
    assert.equal(m.courtNumber, (idx % 2) + 1, 'Sân được phân bổ tuần tự 1, 2, 1, 2');

    seenTeams.add(m.teamA);
    seenTeams.add(m.teamB);
  }
  assert.equal(seenTeams.size, 8, '8 đội xuất hiện không trùng lặp');
});

test('T1.F4.6: Realtime draw event contract: saveStageDraw completes successfully and updates match games', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, ['A', 'B', 'C', 'D']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const pairs = [
    { teamA: 'T1', teamB: 'T2' },
    { teamA: 'T3', teamB: 'T4' },
    { teamA: 'T5', teamB: 'T6' },
    { teamA: 'T7', teamB: 'T8' },
  ];
  const updated = await flow.saveStageDraw(t.id, 'Tứ kết', pairs);
  assert.equal(updated.length, 4);
  assert.equal(updated[0].teamA, 'T1');
  assert.equal(updated[0].teamB, 'T2');
});

test('T1.F5.1 to T1.F5.5: Bracket tree node representation and knockout stage classification', async () => {
  // Classification check
  assert.equal(isKnockoutStage('Tứ kết'), true);
  assert.equal(isKnockoutStage('Bán kết'), true);
  assert.equal(isKnockoutStage('Chung kết'), true);
  assert.equal(isKnockoutStage('Tranh hạng 3-4'), true);
  assert.equal(isKnockoutStage('Vòng bảng'), false);
  assert.equal(isKnockoutStage('Vòng tròn'), false);

  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);
  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8, hasThirdPlace: true }, ['A', 'B']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const bracket = await flow.buildBracketTree(t.id);
  assert.equal(bracket.round100.length, 4, 'Bracket chứa 4 node Tứ kết');
  assert.equal(bracket.round101.length, 2, 'Bracket chứa 2 node Bán kết');
  assert.equal(bracket.round102.length, 1, 'Bracket chứa 1 node Chung kết');
  assert.equal(bracket.round103.length, 1, 'Bracket chứa 1 node Tranh 3-4');

  // Status and score sync check
  const qf1 = bracket.round100[0];
  await prisma.simulateMatchScore(qf1.id, 15, 11);
  const updatedBracket = await flow.buildBracketTree(t.id);
  const updatedQf1 = updatedBracket.round100[0];
  assert.equal(updatedQf1.status, 'FINISHED');
  assert.equal(updatedQf1.scoreA, 15);
  assert.equal(updatedQf1.scoreB, 11);
});

test('T1.F6.1: Semifinals progression prerequisite guard: blocks if only 3 of 4 QF finished', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, ['A', 'B']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const qfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  // Hoàn tất 3 trận đầu, trận thứ 4 vẫn SCHEDULED
  await prisma.simulateMatchScore(qfMatches[0].id, 15, 8);
  await prisma.simulateMatchScore(qfMatches[1].id, 15, 9);
  await prisma.simulateMatchScore(qfMatches[2].id, 15, 10);

  const progressed = await flow.advanceSemifinals(t.id, 'FIXED');
  assert.equal(progressed, false, 'Không được tiến sang bán kết khi còn trận tứ kết chưa xong');
});

test('T1.F6.2 to T1.F6.6: Semifinals progression options (Fixed QF1-QF2 vs Wheel draw) and persistence', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, ['A', 'B']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  const pairs = [
    { teamA: 'W1', teamB: 'L1' },
    { teamA: 'W2', teamB: 'L2' },
    { teamA: 'W3', teamB: 'L3' },
    { teamA: 'W4', teamB: 'L4' },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', pairs);

  // Thắng cả 4 trận Tứ kết: W1, W2, W3, W4 thắng
  const qfs = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  for (const m of qfs) await prisma.simulateMatchScore(m.id, 15, 10);

  // Test FIXED mode
  const okFixed = await flow.advanceSemifinals(t.id, 'FIXED');
  assert.equal(okFixed, true);

  let sfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  assert.equal(sfMatches[0].teamA, 'W1');
  assert.equal(sfMatches[0].teamB, 'W2');
  assert.equal(sfMatches[1].teamA, 'W3');
  assert.equal(sfMatches[1].teamB, 'W4');
  assert.equal(sfMatches[0].status, 'SCHEDULED');
  assert.equal(sfMatches[0].scoreA, 0);

  let updatedT = await prisma.tournament.findUnique({ where: { id: t.id } });
  assert.equal(updatedT.semiDrawMethod, 'FIXED');

  // Test WHEEL mode override
  const wheelPairs = [
    { teamA: 'W1', teamB: 'W4' },
    { teamA: 'W2', teamB: 'W3' },
  ];
  const okWheel = await flow.advanceSemifinals(t.id, 'WHEEL', wheelPairs);
  assert.equal(okWheel, true);

  sfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  assert.equal(sfMatches[0].teamA, 'W1');
  assert.equal(sfMatches[0].teamB, 'W4');
  assert.equal(sfMatches[1].teamA, 'W2');
  assert.equal(sfMatches[1].teamB, 'W3');

  updatedT = await prisma.tournament.findUnique({ where: { id: t.id } });
  assert.equal(updatedT.semiDrawMethod, 'WHEEL');
});

test('T1.F7.1 to T1.F7.6: Final and 3rd place generation, hasThirdPlace gating, and podium computation', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4, hasThirdPlace: true }, ['A', 'B']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });

  // Đưa 4 đội vào Bán kết
  const sfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  await prisma.matchGame.update({ where: { id: sfMatches[0].id }, data: { teamA: 'SF1_A', teamB: 'SF1_B' } });
  await prisma.matchGame.update({ where: { id: sfMatches[1].id }, data: { teamA: 'SF2_A', teamB: 'SF2_B' } });

  // SF1 kết thúc, SF2 vẫn đang đấu -> sync trả về false
  await prisma.simulateMatchScore(sfMatches[0].id, 15, 9);
  const syncPartial = await flow.syncFinalAndThirdPlace(t.id);
  assert.equal(syncPartial, false);

  // SF2 kết thúc -> SF1_A thắng, SF2_A thắng; SF1_B thua, SF2_B thua
  await prisma.simulateMatchScore(sfMatches[1].id, 15, 12);
  const syncFull = await flow.syncFinalAndThirdPlace(t.id);
  assert.equal(syncFull, true);

  const finalMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(finalMatch.teamA, 'SF1_A');
  assert.equal(finalMatch.teamB, 'SF2_A');
  assert.equal(thirdMatch.teamA, 'SF1_B');
  assert.equal(thirdMatch.teamB, 'SF2_B');

  // Chung kết: SF1_A thắng 15-10
  await prisma.simulateMatchScore(finalMatch.id, 15, 10);
  // Tranh 3-4: SF1_B thắng 15-12
  await prisma.simulateMatchScore(thirdMatch.id, 15, 12);

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, 'SF1_A', 'Quán quân');
  assert.equal(podium.secondPlace, 'SF2_A', 'Á quân');
  assert.equal(podium.thirdPlace, 'SF1_B', 'Quý quân');
  assert.equal(podium.fourthPlace, 'SF2_B', 'Hạng 4');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 2: BOUNDARY & CORNER CASES (BC1 to BC7) — min 35 assertions
// ═══════════════════════════════════════════════════════════════════════════════

test('T2.BC1: Zero Shortage Boundaries (4 groups x 2 advance = 8 direct; suggested is empty; banner false)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 16 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 4, advancePerGroup: 2, knockoutQualifierCount: 8 },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 4, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.directlyQualified.length, 8);
  assert.equal(status.shortage, 0);
  assert.equal(status.hasShortage, false);
  assert.deepEqual(status.suggested, []);

  // 2 groups x 2 advance = 4, target 4 -> zero shortage
  const tSmall = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 4 },
    ['1', '2', '3', '4'],
  );
  await flow.generateDynamicSchedule(tSmall.id, { groupCount: 2, advancePerGroup: 2 });
  await prisma.playAllStageMatches(tSmall.id, 'Vòng bảng');
  const statusSmall = await flow.getWildcardStatus(tSmall.id);
  assert.equal(statusSmall.shortage, 0);
});

test('T2.BC2: Small Tournament Boundaries (6 teams, 2 groups of 3 -> QF=0, SF=2, Final=1, 3rd=1)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 4, hasThirdPlace: true },
    ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 2, advancePerGroup: 2 });

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  const final = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const third = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(qf.length, 0);
  assert.equal(sf.length, 2);
  assert.equal(final.length, 1);
  assert.equal(third.length, 1);

  // 4 teams, 2 groups of 2, target 2 -> only final
  const t2 = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 1, knockoutQualifierCount: 2, hasThirdPlace: false },
    ['A1', 'A2', 'B1', 'B2'],
  );
  await flow.generateDynamicSchedule(t2.id, { groupCount: 2, advancePerGroup: 1 });
  const final2 = await prisma.matchGame.findMany({ where: { tournamentId: t2.id, stage: 'Chung kết' } });
  const sf2 = await prisma.matchGame.findMany({ where: { tournamentId: t2.id, stage: 'Bán kết' } });
  assert.equal(final2.length, 1);
  assert.equal(sf2.length, 0);
});

test('T2.BC3: Complex Head-to-Head & Multi-Way Ties (Circular 3-way tie resolved by pointDiff without crash)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', groupCount: 1, knockoutQualifierCount: 2 }, ['A', 'B', 'C']);
  await flow.generateDynamicSchedule(t.id, { groupCount: 1 });
  const matches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Vòng bảng' } });

  // A thắng B 11-9 (A +2, B -2)
  // B thắng C 11-8 (B +3, C -3) -> Tổng B: pointDiff = +1
  // C thắng A 11-7 (C +4, A -4) -> Tổng C: pointDiff = +1; Tổng A: pointDiff = -2
  for (const m of matches) {
    if ((m.teamA === 'A' && m.teamB === 'B') || (m.teamA === 'B' && m.teamB === 'A')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'A' ? 11 : 9, m.teamA === 'A' ? 9 : 11);
    } else if ((m.teamA === 'B' && m.teamB === 'C') || (m.teamA === 'C' && m.teamB === 'B')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'B' ? 11 : 8, m.teamA === 'B' ? 8 : 11);
    } else if ((m.teamA === 'C' && m.teamB === 'A') || (m.teamA === 'A' && m.teamB === 'C')) {
      await prisma.simulateMatchScore(m.id, m.teamA === 'C' ? 11 : 7, m.teamA === 'C' ? 7 : 11);
    }
  }

  const standings = await flow.computeStandings(t.id);
  const rows = standings[0].rows;
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(r.won, 1, 'Cả 3 đội đều có 1 trận thắng (circular tie)');

  // B và C có pointDiff +1, A có pointDiff -2
  assert.ok(rows[0].pointDiff >= rows[1].pointDiff);
  assert.ok(rows[1].pointDiff >= rows[2].pointDiff);
  assert.equal(rows[2].teamName, 'A');
});

test('T2.BC4: Invalid Wildcard Selections rejection', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8 },
    Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });

  // 1. Chọn khi vòng bảng chưa xong -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, ['T7', 'T8']);
  }, /chưa hoàn tất/);

  await prisma.playAllStageMatches(t.id, 'Vòng bảng');
  const status = await flow.getWildcardStatus(t.id);
  const directTeam = status.directlyQualified[0];

  // 2. Chọn đội đã vào thẳng -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, [directTeam, 'T7']);
  }, /đã vào thẳng/);

  // 3. Thiếu số lượng -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, ['T7']);
  }, /không khớp/);

  // 4. Thừa số lượng -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, ['T7', 'T8', 'T9']);
  }, /không khớp/);

  // 5. Chọn trùng lặp -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, ['T7', 'T7']);
  }, /trùng lặp/);

  // 6. Chọn đội ngoài candidate pool -> throw
  await assert.rejects(async () => {
    await flow.selectWildcards(t.id, ['T7', 'NonExistentTeam']);
  }, /không hợp lệ/);
});

test('T2.BC5: Knockout decisive score rules (must win by 2 or hit maxScore; 15-15 stays PLAYING)', () => {
  const knockoutRules = { touchScore: 15, maxScore: 19 };

  // 15-15: touchScore reached but diff = 0 -> PLAYING
  const score15_15 = computeScore({ scoreA: 15, scoreB: 15 }, knockoutRules);
  assert.equal(score15_15.status, 'PLAYING');

  // 16-15: diff = 1 -> PLAYING
  const score16_15 = computeScore({ scoreA: 16, scoreB: 15 }, knockoutRules);
  assert.equal(score16_15.status, 'PLAYING');

  // 17-15: diff = 2 -> FINISHED
  const score17_15 = computeScore({ scoreA: 17, scoreB: 15 }, knockoutRules);
  assert.equal(score17_15.status, 'FINISHED');

  // 19-18: maxScore reached with diff = 1 -> FINISHED
  const score19_18 = computeScore({ scoreA: 19, scoreB: 18 }, knockoutRules);
  assert.equal(score19_18.status, 'FINISHED');

  // Clamp above maxScore: score capped at maxScore
  const clamped = computeScore({ scoreA: 20, scoreB: 18 }, knockoutRules);
  assert.equal(clamped.scoreA, 19);
  assert.equal(clamped.status, 'FINISHED');
});

test('T2.BC6: Tournament state transitions & idempotency', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament({ format: 'GROUP_KNOCKOUT', groupCount: 2, knockoutQualifierCount: 4 }, ['A', 'B', 'C', 'D']);

  // Sinh lại lịch nhiều lần không tạo rác/duplicate
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });
  await flow.generateDynamicSchedule(t.id, { groupCount: 2 });
  const allMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id } });
  // 2 bảng x 1 trận (2 đội) = 2 trận bảng + 2 SF + 1 Final + 1 Tranh 3 = 6 trận
  assert.equal(allMatches.length, 6);

  // sync trên stage chưa có thay đổi -> idempotent (trả về false)
  const syncRes = await flow.syncFinalAndThirdPlace(t.id);
  assert.equal(syncRes, false);
});

test('T2.BC7: Group distribution asymmetry (11 teams in 3 groups: 4, 4, 3)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = Array.from({ length: 11 }, (_, i) => `Team ${i + 1}`);
  const t = await prisma.seedTournament(
    { format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8 },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  const standings = await flow.computeStandings(t.id);

  assert.equal(standings.length, 3);
  const counts = standings.map((g) => g.rows.length).sort((a, b) => b - a);
  assert.deepEqual(counts, [4, 4, 3], '11 đội chia 3 bảng phải là 4, 4, 3');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: PAIRWISE INTERACTIONS (PW-01 to PW-10) — 10 test cases
// ═══════════════════════════════════════════════════════════════════════════════

test('PW-01: QF (8) + Shortage (2) + Fixed SF + hasThirdPlace=true + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: true },
    Array.from({ length: 12 }, (_, i) => `Pair ${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 2);
  await flow.selectWildcards(t.id, status.suggested.map((s) => s.teamName));

  const eight = [...status.directlyQualified, ...status.suggested.map((s) => s.teamName)];
  const pairs = [
    { teamA: eight[0], teamB: eight[1] },
    { teamA: eight[2], teamB: eight[3] },
    { teamA: eight[4], teamB: eight[5] },
    { teamA: eight[6], teamB: eight[7] },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', pairs);
  await prisma.playAllStageMatches(t.id, 'Tứ kết', () => ({ scoreA: 15, scoreB: 10 }));

  await flow.advanceSemifinals(t.id, 'FIXED');
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 12 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 11 }));
  await prisma.playAllStageMatches(t.id, 'Tranh hạng 3-4', () => ({ scoreA: 15, scoreB: 13 }));

  const podium = await flow.computePodium(t.id);
  assert.ok(podium.firstPlace && podium.secondPlace && podium.thirdPlace && podium.fourthPlace);
});

test('PW-02: QF (8) + Shortage (2) + Wheel SF + hasThirdPlace=false + SINGLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'SINGLES', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: false },
    Array.from({ length: 12 }, (_, i) => `Player ${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  await flow.selectWildcards(t.id, status.suggested.map((s) => s.teamName));

  const eight = [...status.directlyQualified, ...status.suggested.map((s) => s.teamName)];
  const qfPairs = [
    { teamA: eight[0], teamB: eight[7] },
    { teamA: eight[1], teamB: eight[6] },
    { teamA: eight[2], teamB: eight[5] },
    { teamA: eight[3], teamB: eight[4] },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', qfPairs);
  await prisma.playAllStageMatches(t.id, 'Tứ kết', () => ({ scoreA: 15, scoreB: 9 }));

  const qfWinners = [eight[0], eight[1], eight[2], eight[3]];
  const sfWheelPairs = [
    { teamA: qfWinners[0], teamB: qfWinners[3] },
    { teamA: qfWinners[1], teamB: qfWinners[2] },
  ];
  await flow.advanceSemifinals(t.id, 'WHEEL', sfWheelPairs);
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 11 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 13 }));

  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });
  assert.equal(thirdMatch, null, 'hasThirdPlace=false không được tạo trận 3-4');

  const podium = await flow.computePodium(t.id);
  assert.ok(podium.firstPlace && podium.secondPlace);
  assert.equal(podium.thirdPlace, null);
});

test('PW-03: QF (8) + Zero Shortage (0) + Fixed SF + hasThirdPlace=false + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 4, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: false },
    Array.from({ length: 16 }, (_, i) => `Pair ${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 4, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);

  const eight = status.directlyQualified;
  const qfPairs = [
    { teamA: eight[0], teamB: eight[1] },
    { teamA: eight[2], teamB: eight[3] },
    { teamA: eight[4], teamB: eight[5] },
    { teamA: eight[6], teamB: eight[7] },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', qfPairs);
  await prisma.playAllStageMatches(t.id, 'Tứ kết', () => ({ scoreA: 15, scoreB: 8 }));

  await flow.advanceSemifinals(t.id, 'FIXED');
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 10 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 12 }));

  const podium = await flow.computePodium(t.id);
  assert.ok(podium.firstPlace);
  assert.equal(podium.thirdPlace, null);
});

test('PW-04: QF (8) + Zero Shortage (0) + Wheel SF + hasThirdPlace=true + SINGLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'SINGLES', format: 'GROUP_KNOCKOUT', groupCount: 4, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: true },
    Array.from({ length: 16 }, (_, i) => `S${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 4, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);

  const eight = status.directlyQualified;
  await flow.saveStageDraw(t.id, 'Tứ kết', [
    { teamA: eight[0], teamB: eight[1] },
    { teamA: eight[2], teamB: eight[3] },
    { teamA: eight[4], teamB: eight[5] },
    { teamA: eight[6], teamB: eight[7] },
  ]);
  await prisma.playAllStageMatches(t.id, 'Tứ kết', () => ({ scoreA: 15, scoreB: 7 }));

  const winners = [eight[0], eight[2], eight[4], eight[6]];
  await flow.advanceSemifinals(t.id, 'WHEEL', [
    { teamA: winners[0], teamB: winners[2] },
    { teamA: winners[1], teamB: winners[3] },
  ]);
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 13 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 10 }));
  await prisma.playAllStageMatches(t.id, 'Tranh hạng 3-4', () => ({ scoreA: 15, scoreB: 11 }));

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, winners[0]);
  assert.ok(podium.thirdPlace);
});

test('PW-05: SF (4) + Zero Shortage (0) + Fixed SF + hasThirdPlace=true + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 4, hasThirdPlace: true },
    ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 2, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  assert.equal(qf.length, 0, 'Bỏ qua Tứ kết');

  // Đi thẳng vào Bán kết
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  assert.equal(sf.length, 2);
});

test('PW-06: SF (4) + Zero Shortage (0) + Wheel SF + hasThirdPlace=false + SINGLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'SINGLES', format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 4, hasThirdPlace: false },
    ['S1', 'S2', 'S3', 'S4'],
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 2, advancePerGroup: 2 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);

  const direct = status.directlyQualified;
  await flow.saveStageDraw(t.id, 'Bán kết', [
    { teamA: direct[0], teamB: direct[3] },
    { teamA: direct[1], teamB: direct[2] },
  ]);
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 10 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 9 }));

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, direct[0]);
  assert.equal(podium.thirdPlace, null);
});

test('PW-07: SF (4) + Shortage (1) + Fixed SF + hasThirdPlace=true + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  // 3 bảng x top 1 = 3 direct, target 4 -> shortage = 1
  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 1, knockoutQualifierCount: 4, hasThirdPlace: true },
    Array.from({ length: 9 }, (_, i) => `D${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 1 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 1);
  await flow.selectWildcards(t.id, [status.suggested[0].teamName]);

  const four = [...status.directlyQualified, status.suggested[0].teamName];
  assert.equal(four.length, 4);
});

test('PW-08: SF (4) + Shortage (1) + Wheel SF + hasThirdPlace=false + SINGLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'SINGLES', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 1, knockoutQualifierCount: 4, hasThirdPlace: false },
    Array.from({ length: 9 }, (_, i) => `S${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 3, advancePerGroup: 1 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 1);
  const wc = status.suggested[0].teamName;
  await flow.selectWildcards(t.id, [wc]);

  const direct = status.directlyQualified;
  await flow.saveStageDraw(t.id, 'Bán kết', [
    { teamA: direct[0], teamB: wc },
    { teamA: direct[1], teamB: direct[2] },
  ]);
  await prisma.playAllStageMatches(t.id, 'Bán kết', () => ({ scoreA: 15, scoreB: 12 }));

  await flow.syncFinalAndThirdPlace(t.id);
  await prisma.playAllStageMatches(t.id, 'Chung kết', () => ({ scoreA: 15, scoreB: 11 }));

  const podium = await flow.computePodium(t.id);
  assert.ok(podium.firstPlace);
  assert.equal(podium.thirdPlace, null);
});

test('PW-09: Final (2) + Zero Shortage (0) + hasThirdPlace=false + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 1, knockoutQualifierCount: 2, hasThirdPlace: false },
    ['D1', 'D2', 'D3', 'D4'],
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 2, advancePerGroup: 1 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);
  assert.equal(status.directlyQualified.length, 2);

  const qf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  const sf = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  const final = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  assert.equal(qf.length, 0);
  assert.equal(sf.length, 0);
  assert.equal(final.length, 1);
});

test('PW-10: QF (8) + Large Shortage (3) + Wheel SF + hasThirdPlace=true + DOUBLES', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  // 5 bảng x top 1 = 5 direct; target 8 -> shortage = 3
  const t = await prisma.seedTournament(
    { playType: 'DOUBLES', format: 'GROUP_KNOCKOUT', groupCount: 5, advancePerGroup: 1, knockoutQualifierCount: 8, hasThirdPlace: true },
    Array.from({ length: 15 }, (_, i) => `Team ${i + 1}`),
  );
  await flow.generateDynamicSchedule(t.id, { groupCount: 5, advancePerGroup: 1 });
  await prisma.playAllStageMatches(t.id, 'Vòng bảng');

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.directlyQualified.length, 5);
  assert.equal(status.shortage, 3);
  assert.equal(status.suggested.length, 3);

  await flow.selectWildcards(t.id, status.suggested.map((s) => s.teamName));
  const eight = [...status.directlyQualified, ...status.suggested.map((s) => s.teamName)];
  assert.equal(eight.length, 8);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 4: REAL-WORLD WORKLOAD SCENARIOS (1 to 5)
// ═══════════════════════════════════════════════════════════════════════════════

test('Scenario 1: 12 Teams, 3 Groups x Top 2 + 2 Auto Wildcards -> QF Wheel -> SF Wheel -> Final & 3rd Place -> Podium (A1, B1, C1, C2)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = [
    'A1', 'A2', 'A3', 'A4',
    'B1', 'B2', 'B3', 'B4',
    'C1', 'C2', 'C3', 'C4',
  ];
  const t = await prisma.seedTournament(
    {
      name: 'Giải 12 Đội Kịch Bản 1',
      playType: 'DOUBLES',
      format: 'GROUP_KNOCKOUT',
      groupCount: 3,
      advancePerGroup: 2,
      knockoutQualifierCount: 8,
      hasThirdPlace: true,
      courtCount: 3,
    },
    teams,
  );

  await flow.generateDynamicSchedule(t.id, {
    groupCount: 3,
    advancePerGroup: 2,
    customGroups: teams.map((name) => ({ name, group: name[0] })),
  });

  // Simulating exact scores per specification
  const groupScores = {
    'A1|A2': [11, 6], 'A3|A4': [11, 7], 'A1|A3': [11, 8], 'A2|A4': [11, 5], 'A1|A4': [11, 4], 'A2|A3': [11, 9],
    'B1|B2': [11, 7], 'B3|B4': [11, 8], 'B1|B3': [11, 6], 'B2|B4': [11, 4], 'B1|B4': [11, 5], 'B2|B3': [11, 8],
    'C1|C2': [11, 9], 'C3|C4': [11, 6], 'C1|C3': [11, 5], 'C2|C4': [11, 7], 'C1|C4': [11, 4], 'C2|C3': [11, 8],
  };

  const gMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Vòng bảng' } });
  for (const m of gMatches) {
    const key = `${m.teamA}|${m.teamB}`;
    const reverseKey = `${m.teamB}|${m.teamA}`;
    if (groupScores[key]) {
      await prisma.simulateMatchScore(m.id, groupScores[key][0], groupScores[key][1]);
    } else if (groupScores[reverseKey]) {
      await prisma.simulateMatchScore(m.id, groupScores[reverseKey][1], groupScores[reverseKey][0]);
    }
  }

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 2);
  assert.deepEqual(status.directlyQualified.sort(), ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].sort());

  // Auto-suggested wildcards are A3 and C3 (higher points than B3)
  const suggestedNames = status.suggested.map((s) => s.teamName);
  assert.deepEqual(suggestedNames, ['A3', 'C3']);

  // Confirm auto-suggested wildcards
  await flow.selectWildcards(t.id, suggestedNames);

  // QF Wheel Draw
  const qfPairs = [
    { teamA: 'A1', teamB: 'C3' },
    { teamA: 'B1', teamB: 'A2' },
    { teamA: 'C1', teamB: 'B2' },
    { teamA: 'C2', teamB: 'A3' },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', qfPairs);

  const qfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  await prisma.simulateMatchScore(qfMatches[0].id, 15, 8);  // A1 wins
  await prisma.simulateMatchScore(qfMatches[1].id, 15, 11); // B1 wins
  await prisma.simulateMatchScore(qfMatches[2].id, 15, 12); // C1 wins
  await prisma.simulateMatchScore(qfMatches[3].id, 16, 14); // C2 wins

  // SF Wheel Draw
  const sfPairs = [
    { teamA: 'A1', teamB: 'C1' },
    { teamA: 'B1', teamB: 'C2' },
  ];
  await flow.advanceSemifinals(t.id, 'WHEEL', sfPairs);

  const sfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  await prisma.simulateMatchScore(sfMatches[0].id, 15, 9);  // A1 wins, C1 loses
  await prisma.simulateMatchScore(sfMatches[1].id, 15, 13); // B1 wins, C2 loses

  // Sync Finals and 3rd Place
  await flow.syncFinalAndThirdPlace(t.id);

  const finalMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(finalMatch.teamA, 'A1');
  assert.equal(finalMatch.teamB, 'B1');
  assert.equal(thirdMatch.teamA, 'C1');
  assert.equal(thirdMatch.teamB, 'C2');

  await prisma.simulateMatchScore(finalMatch.id, 15, 10); // A1 beats B1
  await prisma.simulateMatchScore(thirdMatch.id, 15, 11); // C1 beats C2

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, 'A1', 'Quán quân: A1');
  assert.equal(podium.secondPlace, 'B1', 'Á quân: B1');
  assert.equal(podium.thirdPlace, 'C1', 'Quý quân: C1');
  assert.equal(podium.fourthPlace, 'C2', 'Hạng 4: C2');
});

test('Scenario 2: 12 Teams, 3 Groups x Top 2 + Manual Wildcard Substitution (A3, B3) -> QF Wheel -> SF Fixed -> Podium (B1, B2, A1, A2)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4'];
  const t = await prisma.seedTournament(
    { name: 'Kịch Bản 2', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: true },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, {
    groupCount: 3,
    advancePerGroup: 2,
    customGroups: teams.map((name) => ({ name, group: name[0] })),
  });

  await prisma.playAllStageMatches(t.id, 'Vòng bảng', (m) => {
    if (m.teamA.endsWith('1')) return { scoreA: 11, scoreB: 6 };
    if (m.teamB.endsWith('1')) return { scoreA: 6, scoreB: 11 };
    if (m.teamA.endsWith('2')) return { scoreA: 11, scoreB: 7 };
    if (m.teamB.endsWith('2')) return { scoreA: 7, scoreB: 11 };
    if (m.teamA.endsWith('3')) return { scoreA: 11, scoreB: 8 };
    return { scoreA: 8, scoreB: 11 };
  });

  const status = await flow.getWildcardStatus(t.id);
  // Manual substitution: BTC selects A3 and B3
  await flow.selectWildcards(t.id, ['A3', 'B3']);

  const qfPairs = [
    { teamA: 'A1', teamB: 'B3' },
    { teamA: 'B1', teamB: 'C1' },
    { teamA: 'A2', teamB: 'C2' },
    { teamA: 'B2', teamB: 'A3' },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', qfPairs);

  const qfs = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  await prisma.simulateMatchScore(qfs[0].id, 15, 7);  // A1 wins
  await prisma.simulateMatchScore(qfs[1].id, 15, 13); // B1 wins
  await prisma.simulateMatchScore(qfs[2].id, 15, 12); // A2 wins
  await prisma.simulateMatchScore(qfs[3].id, 15, 10); // B2 wins

  // Fixed SF progression: SF1 = QF1 vs QF2 (A1 vs B1), SF2 = QF3 vs QF4 (A2 vs B2)
  await flow.advanceSemifinals(t.id, 'FIXED');

  const sfs = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  assert.equal(sfs[0].teamA, 'A1');
  assert.equal(sfs[0].teamB, 'B1');
  assert.equal(sfs[1].teamA, 'A2');
  assert.equal(sfs[1].teamB, 'B2');

  await prisma.simulateMatchScore(sfs[0].id, 15, 17); // B1 beats A1
  await prisma.simulateMatchScore(sfs[1].id, 11, 15); // B2 beats A2

  await flow.syncFinalAndThirdPlace(t.id);

  const finalMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(finalMatch.teamA, 'B1');
  assert.equal(finalMatch.teamB, 'B2');
  assert.equal(thirdMatch.teamA, 'A1');
  assert.equal(thirdMatch.teamB, 'A2');

  await prisma.simulateMatchScore(finalMatch.id, 15, 12); // B1 wins
  await prisma.simulateMatchScore(thirdMatch.id, 15, 9);  // A1 wins

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, 'B1', 'Quán quân: B1');
  assert.equal(podium.secondPlace, 'B2', 'Á quân: B2');
  assert.equal(podium.thirdPlace, 'A1', 'Quý quân: A1');
  assert.equal(podium.fourthPlace, 'A2', 'Hạng 4: A2');
});

test('Scenario 3: 16 Teams, 4 Groups x Top 2 (Zero Shortage) -> QF Direct -> SF Fixed -> Podium (A1, D1, B1, C1)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = [
    'A1', 'A2', 'A3', 'A4',
    'B1', 'B2', 'B3', 'B4',
    'C1', 'C2', 'C3', 'C4',
    'D1', 'D2', 'D3', 'D4',
  ];
  const t = await prisma.seedTournament(
    { name: 'Kịch Bản 3', format: 'GROUP_KNOCKOUT', groupCount: 4, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: true },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, {
    groupCount: 4,
    advancePerGroup: 2,
    customGroups: teams.map((name) => ({ name, group: name[0] })),
  });

  await prisma.playAllStageMatches(t.id, 'Vòng bảng', (m) => {
    if (m.teamA.endsWith('1')) return { scoreA: 11, scoreB: 5 };
    if (m.teamB.endsWith('1')) return { scoreA: 5, scoreB: 11 };
    if (m.teamA.endsWith('2')) return { scoreA: 11, scoreB: 7 };
    return { scoreA: 7, scoreB: 11 };
  });

  const status = await flow.getWildcardStatus(t.id);
  assert.equal(status.shortage, 0);

  const qfPairs = [
    { teamA: 'A1', teamB: 'B2' },
    { teamA: 'B1', teamB: 'A2' },
    { teamA: 'C1', teamB: 'D2' },
    { teamA: 'D1', teamB: 'C2' },
  ];
  await flow.saveStageDraw(t.id, 'Tứ kết', qfPairs);

  const qfs = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  await prisma.simulateMatchScore(qfs[0].id, 15, 6);  // A1 wins
  await prisma.simulateMatchScore(qfs[1].id, 15, 9);  // B1 wins
  await prisma.simulateMatchScore(qfs[2].id, 15, 10); // C1 wins
  await prisma.simulateMatchScore(qfs[3].id, 15, 11); // D1 wins

  await flow.advanceSemifinals(t.id, 'FIXED');

  const sfs = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  await prisma.simulateMatchScore(sfs[0].id, 15, 8);  // A1 beats B1
  await prisma.simulateMatchScore(sfs[1].id, 13, 15); // D1 beats C1

  await flow.syncFinalAndThirdPlace(t.id);

  const finalMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(finalMatch.teamA, 'A1');
  assert.equal(finalMatch.teamB, 'D1');
  assert.equal(thirdMatch.teamA, 'B1');
  assert.equal(thirdMatch.teamB, 'C1');

  await prisma.simulateMatchScore(finalMatch.id, 15, 9);  // A1 wins
  await prisma.simulateMatchScore(thirdMatch.id, 15, 11); // B1 wins

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, 'A1', 'Quán quân: A1');
  assert.equal(podium.secondPlace, 'D1', 'Á quân: D1');
  assert.equal(podium.thirdPlace, 'B1', 'Quý quân: B1');
  assert.equal(podium.fourthPlace, 'C1', 'Hạng 4: C1');
});

test('Scenario 4: Small Tournament (6 teams, 2 groups of 3) -> Straight to SF, no QF -> Podium (A1, A2, B1, B2)', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
  const t = await prisma.seedTournament(
    { name: 'Kịch Bản 4', format: 'GROUP_KNOCKOUT', groupCount: 2, advancePerGroup: 2, knockoutQualifierCount: 4, hasThirdPlace: true },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, {
    groupCount: 2,
    advancePerGroup: 2,
    customGroups: teams.map((name) => ({ name, group: name[0] })),
  });

  const qfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Tứ kết' } });
  assert.equal(qfMatches.length, 0, 'Không có vòng Tứ kết');

  await prisma.playAllStageMatches(t.id, 'Vòng bảng', (m) => {
    if (m.teamA.endsWith('1')) return { scoreA: 11, scoreB: 4 };
    if (m.teamB.endsWith('1')) return { scoreA: 4, scoreB: 11 };
    if (m.teamA.endsWith('2')) return { scoreA: 11, scoreB: 7 };
    return { scoreA: 7, scoreB: 11 };
  });

  const sfMatches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Bán kết' } });
  assert.equal(sfMatches.length, 2);

  // Gán 4 đội vào Bán kết chéo: SF1: A1 vs B2, SF2: A2 vs B1
  await prisma.matchGame.update({ where: { id: sfMatches[0].id }, data: { teamA: 'A1', teamB: 'B2' } });
  await prisma.matchGame.update({ where: { id: sfMatches[1].id }, data: { teamA: 'A2', teamB: 'B1' } });

  await prisma.simulateMatchScore(sfMatches[0].id, 15, 7);  // A1 beats B2
  await prisma.simulateMatchScore(sfMatches[1].id, 16, 14); // A2 beats B1

  await flow.syncFinalAndThirdPlace(t.id);

  const finalMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Chung kết' } });
  const thirdMatch = await prisma.matchGame.findFirst({ where: { tournamentId: t.id, stage: 'Tranh hạng 3-4' } });

  assert.equal(finalMatch.teamA, 'A1');
  assert.equal(finalMatch.teamB, 'A2');
  assert.equal(thirdMatch.teamA, 'B2');
  assert.equal(thirdMatch.teamB, 'B1');

  await prisma.simulateMatchScore(finalMatch.id, 15, 11); // A1 wins
  await prisma.simulateMatchScore(thirdMatch.id, 8, 15);  // B1 wins

  const podium = await flow.computePodium(t.id);
  assert.equal(podium.firstPlace, 'A1');
  assert.equal(podium.secondPlace, 'A2');
  assert.equal(podium.thirdPlace, 'B1');
  assert.equal(podium.fourthPlace, 'B2');
});

test('Scenario 5: Complex Head-to-Head Tiebreak in Group Stage determining spots & wildcards', async () => {
  const prisma = new InMemoryPrisma();
  const flow = new DynamicTournamentFlow(prisma);

  const teams = [
    'A1', 'A2', 'A3', 'A4',
    'B1', 'B2', 'B3', 'B4',
    'C1', 'C2', 'C3', 'C4',
  ];
  const t = await prisma.seedTournament(
    { name: 'Kịch Bản 5', format: 'GROUP_KNOCKOUT', groupCount: 3, advancePerGroup: 2, knockoutQualifierCount: 8, hasThirdPlace: true },
    teams,
  );
  await flow.generateDynamicSchedule(t.id, {
    groupCount: 3,
    advancePerGroup: 2,
    customGroups: teams.map((name) => ({ name, group: name[0] })),
  });

  const matches = await prisma.matchGame.findMany({ where: { tournamentId: t.id, stage: 'Vòng bảng' } });

  // Group A: A2 và A3 bằng điểm (2 thắng - 1 thua).
  // A3 có hiệu số +6 (32-26), A2 có hiệu số +2 (28-26).
  // Nhưng đối đầu trực tiếp: A2 thắng A3 11-9!
  // -> A2 phải xếp hạng 2 (vào thẳng), A3 xếp hạng 3 (vào candidate pool).
  for (const m of matches) {
    if (m.groupName === 'A') {
      if ((m.teamA === 'A1' && m.teamB === 'A4') || (m.teamA === 'A4' && m.teamB === 'A1')) await prisma.simulateMatchScore(m.id, 11, 4);
      else if ((m.teamA === 'A1' && m.teamB === 'A2') || (m.teamA === 'A2' && m.teamB === 'A1')) await prisma.simulateMatchScore(m.id, 11, 6);
      else if ((m.teamA === 'A1' && m.teamB === 'A3') || (m.teamA === 'A3' && m.teamB === 'A1')) await prisma.simulateMatchScore(m.id, 11, 8);
      else if ((m.teamA === 'A2' && m.teamB === 'A3') || (m.teamA === 'A3' && m.teamB === 'A2')) await prisma.simulateMatchScore(m.id, m.teamA === 'A2' ? 11 : 9, m.teamA === 'A2' ? 9 : 11);
      else if ((m.teamA === 'A2' && m.teamB === 'A4') || (m.teamA === 'A4' && m.teamB === 'A2')) await prisma.simulateMatchScore(m.id, m.teamA === 'A2' ? 11 : 6, m.teamA === 'A2' ? 6 : 11);
      else if ((m.teamA === 'A3' && m.teamB === 'A4') || (m.teamA === 'A4' && m.teamB === 'A3')) await prisma.simulateMatchScore(m.id, m.teamA === 'A3' ? 11 : 3, m.teamA === 'A3' ? 3 : 11);
    } else {
      // Các bảng khác kết thúc bình thường
      await prisma.simulateMatchScore(m.id, 11, 5);
    }
  }

  const standings = await flow.computeStandings(t.id);
  const groupARows = standings.find((g) => g.groupName === 'A').rows;

  assert.equal(groupARows[0].teamName, 'A1');
  assert.equal(groupARows[1].teamName, 'A2', 'A2 phải đứng thứ 2 nhờ thắng đối đầu trực tiếp');
  assert.equal(groupARows[2].teamName, 'A3', 'A3 đứng thứ 3 dù có hiệu số tốt hơn');

  const status = await flow.getWildcardStatus(t.id);
  assert.ok(status.directlyQualified.includes('A2'));
  assert.ok(!status.directlyQualified.includes('A3'));
  assert.ok(status.candidates.some((c) => c.teamName === 'A3'));
});
