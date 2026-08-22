const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAmericanoMatches,
  buildBalancedDoublesTeams,
  buildDoublesTeams,
  buildRandomDoublesTeams,
} = require('../dist/tournaments/tournament-schedule');
const { isKnockoutStage } = require('../dist/tournaments/tournament-schedule');
const { TournamentRankingCalculator } = require('../dist/tournaments/tournament-ranking');
const { splitTeamName } = require('../dist/tournaments/team-name');

// Tạo danh sách đăng ký: mỗi người một tên duy nhất kèm trình, để tra ngược trình từ tên.
function regs(spec) {
  const list = [];
  for (const [level, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) list.push({ player: { displayName: `${level}${i}` }, externalName: null, externalEmail: null, skillLevel: level });
  }
  return list;
}

// Với mỗi đội "X / Y" trả về cặp trình đã sắp, ví dụ ["A","D"]. Trình lấy từ ký tự đầu tên.
function teamLevels(team) {
  return team.split(' / ').map((name) => name.trim()[0]).sort();
}

// Chạy nhiều lần vì có yếu tố random, mọi lần đều phải thoả bất biến.
function eachRun(spec, check, runs = 60) {
  for (let i = 0; i < runs; i++) check(buildBalancedDoublesTeams(regs(spec)));
}

test('2 trình: luôn ghép cao với thấp (C với D)', () => {
  eachRun({ C: 3, D: 3 }, (teams) => {
    assert.equal(teams.length, 3);
    for (const t of teams) assert.deepEqual(teamLevels(t), ['C', 'D']);
  });
});

test('4 trình: A ghép D, B ghép C', () => {
  eachRun({ A: 2, B: 2, C: 2, D: 2 }, (teams) => {
    assert.equal(teams.length, 4);
    for (const t of teams) {
      const lv = teamLevels(t).join('');
      assert.ok(lv === 'AD' || lv === 'BC', `đội không hợp lệ: ${t}`);
    }
  });
});

test('3 trình: thấp nhất với cao nhất, giữa với giữa (A-C, B-B)', () => {
  eachRun({ A: 2, B: 2, C: 2 }, (teams) => {
    assert.equal(teams.length, 3);
    for (const t of teams) {
      const lv = teamLevels(t).join('');
      assert.ok(lv === 'AC' || lv === 'BB', `đội không hợp lệ: ${t}`);
    }
  });
});

test('1 trình: ghép random trong cùng trình', () => {
  eachRun({ C: 4 }, (teams) => {
    assert.equal(teams.length, 2);
    for (const t of teams) assert.deepEqual(teamLevels(t), ['C', 'C']);
  });
});

test('lệch số lượng: phần dư dồn ghép với nhau, không mất người', () => {
  // 3 C + 5 D: 3 đội C/D, còn 2 D ghép với nhau -> 4 đội, đủ 8 người.
  eachRun({ C: 3, D: 5 }, (teams) => {
    assert.equal(teams.length, 4);
    const cd = teams.filter((t) => teamLevels(t).join('') === 'CD').length;
    const dd = teams.filter((t) => teamLevels(t).join('') === 'DD').length;
    assert.equal(cd, 3);
    assert.equal(dd, 1);
  });
});

test('lẻ 1 người cả giải: để "Chờ thành viên", không rơi ai', () => {
  eachRun({ C: 2, D: 3 }, (teams) => {
    assert.equal(teams.length, 3);
    const waiting = teams.filter((t) => t.includes('Chờ thành viên')).length;
    assert.equal(waiting, 1);
  });
});

// ─────────────────────────── Quy tắc ghép cặp: phân trình / không phân trình ───────────────────

test('rule RANDOM: bỏ qua trình, KHÔNG ép cao ghép thấp', () => {
  // 4 A + 4 D. Phân trình thì 100% đội là A/D; không phân trình thì phải có lần ra A/A hoặc D/D,
  // nếu không thì rule đang bị bỏ qua.
  let sameLevelSeen = false;
  for (let i = 0; i < 80 && !sameLevelSeen; i++) {
    sameLevelSeen = buildRandomDoublesTeams(regs({ A: 4, D: 4 })).some((team) => {
      const [x, y] = teamLevels(team);
      return x === y;
    });
  }
  assert.ok(sameLevelSeen, 'rule RANDOM vẫn đang ghép cân bằng theo trình');
});

test('rule RANDOM không làm rơi người: đủ đội, lẻ thì có chỗ chờ', () => {
  for (let i = 0; i < 40; i++) {
    assert.equal(buildRandomDoublesTeams(regs({ A: 4, D: 4 })).length, 4);
    const odd = buildRandomDoublesTeams(regs({ A: 3, D: 2 }));
    assert.equal(odd.length, 3);
    assert.equal(odd.filter((team) => team.includes('Chờ thành viên')).length, 1);
  }
});

test('buildDoublesTeams chọn đúng nhánh theo rule, mặc định là phân trình', () => {
  for (let i = 0; i < 40; i++) {
    for (const team of buildDoublesTeams(regs({ A: 3, D: 3 }), 'BY_SKILL')) {
      assert.deepEqual(teamLevels(team), ['A', 'D']);
    }
    // Giá trị lạ phải rơi về hành vi cũ (phân trình), không được thành random ngầm.
    for (const team of buildDoublesTeams(regs({ A: 3, D: 3 }), 'GIA_TRI_LA')) {
      assert.deepEqual(teamLevels(team), ['A', 'D']);
    }
  }
});

// ─────────────────────────── Thể thức Đôi xoay vòng (Americano) ───────────────────────────────

const AMERICANO = { id: 1n, courtCount: 2, format: 'AMERICANO' };

function americano(playerCount, rule = 'BY_SKILL', courtCount = 2) {
  const registrations = Array.from({ length: playerCount }, (_, index) => ({
    player: { displayName: `P${index}` },
    externalName: null,
    externalEmail: null,
    skillLevel: 'ABCD'[index % 4],
  }));
  return buildAmericanoMatches({ ...AMERICANO, courtCount }, registrations, rule);
}

/** Khoá cặp đôi về dạng so sánh được, không phụ thuộc thứ tự tên trong đội. */
const pairKey = (teamName) => splitTeamName(teamName).sort().join('|');

test('Americano: không ai đánh chung đội với cùng một người hai lần', () => {
  for (const count of [8, 10, 12]) {
    const seen = new Set();
    for (const match of americano(count)) {
      for (const team of [match.teamA, match.teamB]) {
        const key = pairKey(team);
        assert.ok(!seen.has(key), `cặp ${team} bị lặp ở giải ${count} người`);
        seen.add(key);
      }
    }
  }
});

test('Americano: trong cùng một vòng không ai bị xếp hai trận', () => {
  for (const count of [8, 10, 12, 13]) {
    const byRound = new Map();
    for (const match of americano(count)) {
      const names = byRound.get(match.roundNumber) || [];
      names.push(...splitTeamName(match.teamA), ...splitTeamName(match.teamB));
      byRound.set(match.roundNumber, names);
    }
    for (const [round, names] of byRound) {
      assert.equal(new Set(names).size, names.length, `giải ${count} người: vòng ${round} có người đánh trùng giờ`);
    }
  }
});

/** Với mỗi người: tập những người đã từng đánh CHUNG ĐỘI. */
function partnersOf(matches) {
  const partners = new Map();
  for (const match of matches) {
    for (const team of [match.teamA, match.teamB]) {
      const [first, second] = splitTeamName(team);
      for (const [a, b] of [[first, second], [second, first]]) {
        const set = partners.get(a) || new Set();
        set.add(b);
        partners.set(a, set);
      }
    }
  }
  return partners;
}

test('Americano: giải dài đúng bằng một giải vòng tròn thường', () => {
  // Ghép hết mọi cặp thì 10 người ra 22 trận, đánh cả ngày không hết. Chặn lại cho bằng số
  // trận của n/2 đội cố định đấu vòng tròn: 10 người -> 5 đội -> 10 trận.
  for (const [count, expected] of [[8, 6], [9, 6], [10, 10], [11, 10], [12, 15], [16, 28]]) {
    for (let run = 0; run < 25; run++) {
      assert.equal(americano(count).length, expected, `${count} người phải ra ${expected} trận`);
    }
  }
});

test('Americano: mỗi người chỉ được ghép tối đa (n-2)/2 người', () => {
  // Yêu cầu gốc: 10 người thì mỗi người chỉ ghép cặp với tối đa 4 người.
  for (const [count, limit] of [[8, 3], [10, 4], [12, 5], [16, 7]]) {
    for (let run = 0; run < 25; run++) {
      const partners = partnersOf(americano(count));
      assert.equal(partners.size, count, `${count} người: có người không được xếp trận nào`);
      for (const [name, set] of partners) {
        assert.ok(set.size <= limit, `${count} người: ${name} ghép với ${set.size} người, quá hạn ${limit}`);
      }
    }
  }
});

test('Americano: không ai bị bỏ rơi hay đánh ít hơn hẳn người khác', () => {
  for (const count of [8, 10, 12]) {
    for (let run = 0; run < 25; run++) {
      const played = new Map();
      for (const match of americano(count)) {
        for (const name of [...splitTeamName(match.teamA), ...splitTeamName(match.teamB)]) {
          played.set(name, (played.get(name) || 0) + 1);
        }
      }
      const counts = [...played.values()];
      assert.equal(played.size, count, `${count} người: có người không đánh trận nào`);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${count} người: số trận lệch ${counts.join(',')}`);
    }
  }
});

test('Americano: mọi trận đều nằm trong số sân đã khai', () => {
  for (const courtCount of [1, 2, 3]) {
    for (const match of americano(12, 'BY_SKILL', courtCount)) {
      assert.ok(match.courtNumber >= 1 && match.courtNumber <= courtCount, `sân ${match.courtNumber} vượt ${courtCount}`);
    }
  }
});

test('Americano: dưới 4 người thì không dựng trận nửa vời', () => {
  for (const count of [0, 1, 2, 3]) assert.deepEqual(americano(count), []);
});

test('Americano: xếp hạng cá nhân cộng điểm cho từng người, không cho cặp', () => {
  const calculator = new TournamentRankingCalculator();
  const rows = calculator.playerRankings([
    { groupName: null, teamA: 'An / Bình', teamB: 'Cường / Dũng', scoreA: 11, scoreB: 5, status: 'FINISHED' },
    { groupName: null, teamA: 'An / Cường', teamB: 'Bình / Dũng', scoreA: 9, scoreB: 11, status: 'FINISHED' },
    // Trận chưa đá xong không được tính vào bất kỳ cột nào.
    { groupName: null, teamA: 'An / Dũng', teamB: 'Bình / Cường', scoreA: 3, scoreB: 0, status: 'SCHEDULED' },
  ]);

  assert.deepEqual(rows.map((row) => row.playerName).sort(), ['An', 'Bình', 'Cường', 'Dũng']);
  const by = Object.fromEntries(rows.map((row) => [row.playerName, row]));
  assert.equal(by['Bình'].pointsFor, 22); // 11 (thắng trận 1) + 11 (thắng trận 2)
  assert.equal(by['Bình'].won, 2);
  assert.equal(by['An'].pointsFor, 20); // 11 + 9
  assert.equal(by['An'].won, 1);
  assert.equal(by['An'].lost, 1);
  assert.equal(by['Cường'].played, 2);
  // Xếp theo tổng điểm ghi được: Bình (22) trên An (20) dù cả hai cùng có trận thắng.
  assert.equal(rows[0].playerName, 'Bình');
});

/**
 * Vòng đấu của thể thức mới KHÔNG được lọt vào nhánh "vòng loại trực tiếp".
 *
 * Ba chỗ từng tự viết `stage !== 'Vòng bảng' && stage !== 'Vòng tròn'` (gateway ghi điểm,
 * schedule.ejs, round-list.ejs). Với luật đó thì trận "Xoay vòng" bị chấm theo điểm vòng trong
 * (15/19) thay vì điểm vòng ngoài (11/15) — sai luật mà nhìn giao diện không thấy gì bất thường.
 */
test('vòng tính xếp hạng không bị nhầm thành vòng loại trực tiếp', () => {
  for (const stage of ['Vòng bảng', 'Vòng tròn', 'Xoay vòng']) {
    assert.equal(isKnockoutStage(stage), false, `${stage} không phải vòng trong`);
  }
  for (const stage of ['Tứ kết', 'Bán kết', 'Chung kết']) {
    assert.equal(isKnockoutStage(stage), true, `${stage} phải là vòng trong`);
  }
});

test('Americano: chỗ trống "Chờ thành viên" không được thành một vận động viên', () => {
  const rows = new TournamentRankingCalculator().playerRankings([
    { groupName: null, teamA: 'An / Chờ thành viên', teamB: 'Bình / Cường', scoreA: 11, scoreB: 4, status: 'FINISHED' },
  ]);
  assert.deepEqual(rows.map((row) => row.playerName).sort(), ['An', 'Bình', 'Cường']);
});
