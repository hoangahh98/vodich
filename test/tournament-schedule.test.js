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

/** Tên người theo từng vòng (mỗi lần ra sân là một lần xuất hiện). */
function namesByRound(matches) {
  const byRound = new Map();
  for (const match of matches) {
    const names = byRound.get(match.roundNumber) || [];
    names.push(...splitTeamName(match.teamA), ...splitTeamName(match.teamB));
    byRound.set(match.roundNumber, names);
  }
  return byRound;
}

test('Americano: một vòng = mỗi người đúng một cặp; lẻ cặp thì một cặp nghỉ, không ai đánh hai trận', () => {
  // Chủ app chốt (9/2026): số cặp chẵn thì vòng nào cũng đủ mặt; số cặp lẻ (10, 14 người) thì
  // mỗi vòng một cặp nghỉ và KHÔNG đánh bù — ai cũng đánh bằng nhau.
  for (const count of [8, 12, 16]) {
    for (const [round, names] of namesByRound(americano(count))) {
      assert.equal(names.length, count, `giải ${count} người: vòng ${round} phải đủ ${count} lượt ra sân`);
      assert.equal(new Set(names).size, count, `giải ${count} người: vòng ${round} có người đánh hai trận`);
    }
  }
  for (const count of [10, 14]) {
    for (let run = 0; run < 10; run++) {
      for (const [round, names] of namesByRound(americano(count))) {
        assert.equal(names.length, count - 2, `giải ${count} người: vòng ${round} phải có ${count - 2} lượt ra sân (một cặp nghỉ)`);
        assert.equal(new Set(names).size, count - 2, `giải ${count} người: vòng ${round} có người đánh hai trận`);
      }
    }
  }
});

test('Americano: số trận và số vòng', () => {
  // n/2 vòng, mỗi vòng floor(n/4) trận. 8 → 8 trận/4 vòng, 10 → 10/5, 12 → 18/6, 14 → 21/7,
  // 16 → 32/8. Lẻ người: bên mạnh dư một người nghỉ mỗi vòng: 9 → 10 trận/5 vòng, 11 → 12/6.
  for (const [count, expectedMatches, expectedRounds] of [[8, 8, 4], [10, 10, 5], [12, 18, 6], [14, 21, 7], [16, 32, 8], [9, 10, 5], [11, 12, 6]]) {
    for (let run = 0; run < 25; run++) {
      const matches = americano(count);
      assert.equal(matches.length, expectedMatches, `${count} người phải ra ${expectedMatches} trận`);
      assert.equal(Math.max(...matches.map((m) => m.roundNumber)), expectedRounds, `${count} người phải có ${expectedRounds} vòng`);
    }
  }
});

/** Số trận mỗi người đã đánh. */
function matchesPerPlayer(matches) {
  const played = new Map();
  for (const match of matches) {
    for (const name of [...splitTeamName(match.teamA), ...splitTeamName(match.teamB)]) played.set(name, (played.get(name) || 0) + 1);
  }
  return played;
}

test('Americano chẵn người: ai cũng đánh đúng bằng nhau — cặp chẵn n/2 trận, cặp lẻ n/2 − 1 trận', () => {
  // 12 người → 6 cặp/vòng → mỗi người 6 trận; 16 → 8 cặp → 8 trận; 14 → 7 cặp (lẻ) → 6 trận;
  // 10 → 5 cặp (lẻ) → 4 trận. Chủ app: thà ai cũng thiếu một trận còn hơn hai người thiếu.
  for (const [count, perPlayer] of [[8, 4], [10, 4], [12, 6], [14, 6], [16, 8]]) {
    for (let run = 0; run < 25; run++) {
      const played = matchesPerPlayer(americano(count));
      assert.equal(played.size, count, `${count} người: có người không đánh trận nào`);
      for (const [name, matches] of played) assert.equal(matches, perPlayer, `${count} người: ${name} đánh ${matches} trận, phải là ${perPlayer}`);
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

test('Americano: mỗi người chỉ đi với người BÊN KIA, tối đa n/2 người', () => {
  for (const [count, limit] of [[8, 4], [10, 5], [12, 6], [16, 8]]) {
    for (let run = 0; run < 25; run++) {
      const partners = partnersOf(americano(count));
      assert.equal(partners.size, count, `${count} người: có người không được xếp trận nào`);
      for (const [name, set] of partners) {
        assert.ok(set.size <= limit, `${count} người: ${name} ghép với ${set.size} người, quá hạn ${limit}`);
        assert.ok(set.size >= limit - 1, `${count} người: ${name} chỉ ghép với ${set.size} người`);
      }
    }
  }
});

/**
 * Phân trình = bên mạnh / bên yếu: với trình A,B,C,D chia đều thì A+B là bên mạnh, C+D bên yếu,
 * nên MỌI cặp phải có đúng một người mạnh và một người yếu — không cặp nào A đi với B.
 */
test('Americano phân trình: người mạnh luôn đi với người yếu', () => {
  const strongSide = (name) => Number(name.slice(1)) % 4 < 2;
  for (const count of [8, 12, 16]) {
    for (let run = 0; run < 20; run++) {
      for (const match of americano(count, 'BY_SKILL')) {
        for (const team of [match.teamA, match.teamB]) {
          const [first, second] = splitTeamName(team);
          assert.notEqual(strongSide(first), strongSide(second), `${count} người: cặp ${team} cùng một bên`);
        }
      }
    }
  }
});

test('Americano: không ai bị bỏ rơi hay đánh ít hơn hẳn người khác', () => {
  for (const count of [8, 9, 10, 11, 12, 13]) {
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

// ───────── Bấm "Chia trận" phải ra lịch KHÁC, và "phân trình" phải có tác dụng thật ─────────

/** Khoá một lịch thành chuỗi so sánh được, để đếm xem chia mấy lần ra mấy kiểu. */
const scheduleKey = (matches) => matches.map((m) => `${m.roundNumber}|${pairKey(m.teamA)}|${pairKey(m.teamB)}`).join('\n');

/**
 * Trước đây Americano xếp người vào vòng quay theo ĐÚNG thứ tự đăng ký và không xáo gì cả, nên
 * bấm "Chia trận" mười lần ra y hệt nhau mười lần — người dùng tưởng nút bị hỏng.
 */
test('Americano: chia lại phải ra lịch khác, không đứng im như trước', () => {
  for (const rule of ['BY_SKILL', 'RANDOM']) {
    for (const count of [8, 10, 12]) {
      const keys = new Set(Array.from({ length: 8 }, () => scheduleKey(americano(count, rule))));
      assert.ok(keys.size > 1, `${count} người / ${rule}: chia 8 lần ra đúng 1 kiểu lịch`);
    }
  }
});

test('Americano: chia lại vẫn giữ nguyên số trận, không lần nhiều lần ít', () => {
  for (const rule of ['BY_SKILL', 'RANDOM']) {
    for (const [count, expected] of [[8, 8], [10, 10], [12, 18], [14, 21], [16, 32]]) {
      for (let run = 0; run < 20; run++) assert.equal(americano(count, rule).length, expected);
    }
  }
});

/** Tổng trình của một đội đôi; tên VĐV là `P<index>` nên tra ngược được trình từ tên. */
const teamStrength = (teamName) => splitTeamName(teamName).reduce((sum, name) => sum + (Number(name.slice(1)) % 4), 0);

/** Phương sai tổng trình của mọi đội trong lịch — càng nhỏ thì các cặp càng cân sức. */
function pairImbalance(matches) {
  const totals = matches.flatMap((match) => [teamStrength(match.teamA), teamStrength(match.teamB)]);
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  return totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / totals.length;
}

const averageImbalance = (count, rule) =>
  Array.from({ length: 20 }, () => pairImbalance(americano(count, rule))).reduce((sum, value) => sum + value, 0) / 20;

/**
 * `pairingRule` phải ĐỔI ĐƯỢC cách ghép cặp, chứ không chỉ đổi cách xếp hai cặp gặp nhau.
 * Trước đây cả hai rule đều dùng nguyên thứ tự đăng ký nên "phân trình" ngang hệt "không phân
 * trình" — chọn gì cũng như nhau.
 */
test('Americano: phân trình ghép cặp cân hơn hẳn không phân trình', () => {
  for (const count of [8, 10, 12, 16]) {
    const balanced = averageImbalance(count, 'BY_SKILL');
    const random = averageImbalance(count, 'RANDOM');
    assert.ok(balanced < random * 0.75, `${count} người: phân trình ${balanced.toFixed(2)} không hơn được random ${random.toFixed(2)}`);
  }
});

/**
 * Người dư ra ở một mức trình phải được GẤP LẠI theo đúng quy tắc, không đổ chung một rổ bốc
 * bừa: 5A + 3B + 1D mà bốc bừa thì có lần ra đội A/A trong khi bên B vẫn còn người để ghép.
 */
test('phân trình: người mạnh dư ra không tự ghép với nhau khi còn mức khác để ghép', () => {
  for (let run = 0; run < 80; run++) {
    const shape = buildBalancedDoublesTeams(regs({ A: 5, B: 3, D: 1 })).map(teamLevelsWithBlank).sort().join(' ');
    assert.equal(shape, 'AA AB AD A_ BB', `ca 5A+3B+1D ra hình dạng lạ: ${shape}`);
  }
  for (let run = 0; run < 80; run++) {
    // 3A + 4B + 1D: A dư 2 người sau khi ghép với D, phải kéo sang ghép với B chứ không phải
    // để hai người B lẻ đứng riêng.
    const shape = buildBalancedDoublesTeams(regs({ A: 3, B: 4, D: 1 })).map(teamLevelsWithBlank).sort().join(' ');
    assert.equal(shape, 'AA AD BB BB', `ca 3A+4B+1D ra hình dạng lạ: ${shape}`);
  }
});

/** Như `teamLevels` nhưng giữ chỗ trống thành "_" để đọc được cả đội có "Chờ thành viên". */
function teamLevelsWithBlank(team) {
  return team
    .split(' / ')
    .map((name) => (name === 'Chờ thành viên' ? '_' : name.trim()[0]))
    .sort()
    .join('');
}

// ───────── Ghép thủ công: chốt cứng vài đội, phần còn lại máy ghép nốt theo rule ─────────

const { completeManualTeams } = require('../dist/tournaments/tournament-schedule');

test('ghép thủ công: giữ nguyên đội đã chốt, ghép nốt người còn lại theo trình', () => {
  const registrations = regs({ A: 3, D: 3 });
  for (let run = 0; run < 40; run++) {
    // Chốt cứng một đội "trái luật" (hai người cùng trình A) — máy không được đụng vào.
    const teams = completeManualTeams(['A0 / A1'], registrations, 'BY_SKILL');
    assert.equal(teams.length, 3, 'phải đủ 3 đội cho 6 người');
    assert.equal(teams[0], 'A0 / A1', 'đội đã chốt phải giữ nguyên, kể cả khi lệch trình');
    // Còn lại A2 + 3 D: ghép chéo được 1 đội A/D, 2 D thừa ghép với nhau.
    const rest = teams.slice(1).map(teamLevelsWithBlank).sort().join(' ');
    assert.equal(rest, 'AD DD', `phần tự ghép sai: ${rest}`);
  }
});

test('ghép thủ công: không ai bị bỏ rơi, không ai bị xếp hai lần', () => {
  const registrations = regs({ A: 4, B: 2, D: 4 });
  for (const fixed of [[], ['A0 / D0'], ['A0 / D0', 'B0 / B1'], ['A0 / A1', 'A2 / A3']]) {
    for (let run = 0; run < 30; run++) {
      const names = completeManualTeams(fixed, registrations, 'BY_SKILL')
        .flatMap((team) => team.split(' / '))
        .filter((name) => name !== 'Chờ thành viên');
      assert.equal(new Set(names).size, names.length, `chốt ${fixed.length} đội: có người bị xếp hai lần`);
      assert.equal(names.length, registrations.length, `chốt ${fixed.length} đội: có người bị bỏ rơi`);
    }
  }
});

/**
 * Ô mới chọn một người coi như CHƯA ghép: trước đây nó thành "đội" một người đi đánh đôi, mà
 * người chưa được chọn thì biến mất khỏi lịch luôn.
 */
test('ghép thủ công: ô mới chọn một người thì người đó vào rổ ghép tự động', () => {
  for (let run = 0; run < 40; run++) {
    const teams = completeManualTeams(['A0'], regs({ A: 2, D: 2 }), 'BY_SKILL');
    assert.equal(teams.length, 2, 'A0 đứng lẻ không được thành một đội riêng');
    for (const team of teams) assert.deepEqual(teamLevels(team), ['A', 'D']);
  }
});

test('ghép thủ công: lẻ người thì chỗ trống là "Chờ thành viên", không phải đội một người', () => {
  const teams = completeManualTeams(['A0 / D0'], regs({ A: 2, D: 2, C: 1 }), 'BY_SKILL');
  assert.equal(teams.length, 3);
  assert.equal(teams.filter((team) => team.includes('Chờ thành viên')).length, 1);
});

test('ghép thủ công: rule RANDOM thì phần tự ghép không bị ép cao ghép thấp', () => {
  let sameLevelSeen = false;
  for (let run = 0; run < 80 && !sameLevelSeen; run++) {
    sameLevelSeen = completeManualTeams([], regs({ A: 4, D: 4 }), 'RANDOM').some((team) => {
      const [x, y] = teamLevels(team);
      return x === y;
    });
  }
  assert.ok(sameLevelSeen, 'phần tự ghép đang bỏ qua rule RANDOM');
});

test('ghép thủ công: chốt hết mọi đội thì không phát sinh thêm đội nào', () => {
  const teams = completeManualTeams(['A0 / D0', 'A1 / D1'], regs({ A: 2, D: 2 }), 'BY_SKILL');
  assert.deepEqual(teams, ['A0 / D0', 'A1 / D1']);
});

// ───────── Thi đơn chọn đội thủ công + xếp bảng thủ công ─────────

const { completeManualSingles, groupCountFor, groupLetter, groupIndexOf, TournamentScheduleBuilder } = require('../dist/tournaments/tournament-schedule');

test('thi đơn chọn thủ công: người đã chọn đứng trước theo thứ tự, người còn lại xếp nốt, tên lạ bị bỏ', () => {
  const registrations = regs({ A: 2, B: 2, C: 2 });
  for (let run = 0; run < 20; run++) {
    const order = completeManualSingles(['C1', 'A0', 'C1', 'Người lạ'], registrations);
    assert.deepEqual(order.slice(0, 2), ['C1', 'A0'], 'người đã chọn phải giữ đúng thứ tự, không lặp');
    assert.equal(order.length, 6, 'không ai bị bỏ rơi');
    assert.equal(new Set(order).size, 6, 'không ai bị xếp hai lần');
    assert.ok(!order.includes('Người lạ'));
  }
});

test('chữ bảng: A ↔ 0, b ↔ 1, rỗng/lạ → -1', () => {
  assert.equal(groupLetter(0), 'A');
  assert.equal(groupLetter(3), 'D');
  assert.equal(groupIndexOf('A'), 0);
  assert.equal(groupIndexOf(' b '), 1);
  assert.equal(groupIndexOf(''), -1);
  assert.equal(groupIndexOf(null), -1);
  assert.equal(groupIndexOf('AB'), -1);
});

test('số bảng: bán kết → 2 bảng, tứ kết → 4 bảng, không quá nửa số đội; thể thức khác 1 bảng', () => {
  assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4 }, 8), 2);
  assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, 12), 4);
  assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 8 }, 6), 3);
  assert.equal(groupCountFor({ format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 2 }, 8), 1);
  assert.equal(groupCountFor({ format: 'ROUND_ROBIN', knockoutQualifierCount: 8 }, 12), 1);
});

const GROUP_TOURNAMENT = { id: 1n, courtCount: 2, format: 'GROUP_KNOCKOUT', knockoutQualifierCount: 4, playType: 'DOUBLES' };

/** Bảng của từng đội theo lịch vòng bảng đã dựng. */
function groupsOf(matches) {
  const byTeam = new Map();
  for (const match of matches.filter((item) => item.stage === 'Vòng bảng')) {
    byTeam.set(match.teamA, match.groupName);
    byTeam.set(match.teamB, match.groupName);
  }
  return byTeam;
}

test('chọn bảng thủ công: đội đã chọn vào đúng bảng, đội để máy xếp rải vào bảng đang ít đội', () => {
  const builder = new TournamentScheduleBuilder();
  const matches = builder.fromManualPairs(GROUP_TOURNAMENT, [
    { name: 'T1', group: 'B' },
    { name: 'T2', group: 'B' },
    { name: 'T3', group: 'B' },
    { name: 'T4' },
    { name: 'T5', group: null },
    { name: 'T6', group: 'A' },
  ]);
  const groups = groupsOf(matches);
  assert.equal(groups.get('T1'), 'B');
  assert.equal(groups.get('T2'), 'B');
  assert.equal(groups.get('T3'), 'B');
  assert.equal(groups.get('T6'), 'A');
  // Hai đội tự xếp phải sang bảng A cho cân (A đang có 1 đội, B có 3).
  assert.equal(groups.get('T4'), 'A');
  assert.equal(groups.get('T5'), 'A');
});

test('chọn bảng thủ công: không chọn gì thì rải A, B, A, B như trước; bảng vượt số bảng coi như chưa chọn', () => {
  const builder = new TournamentScheduleBuilder();
  const plain = groupsOf(builder.fromManualPairs(GROUP_TOURNAMENT, ['T1', 'T2', 'T3', 'T4']));
  assert.deepEqual(['T1', 'T2', 'T3', 'T4'].map((team) => plain.get(team)), ['A', 'B', 'A', 'B']);
  // Giải 2 bảng mà chọn bảng D: coi như tự xếp, không được tạo ra bảng D.
  const clamped = groupsOf(builder.fromManualPairs(GROUP_TOURNAMENT, [{ name: 'T1', group: 'D' }, { name: 'T2', group: 'A' }, { name: 'T3' }, { name: 'T4' }]));
  assert.ok(['A', 'B'].includes(clamped.get('T1')));
  assert.deepEqual([...new Set(clamped.values())].sort(), ['A', 'B']);
});
