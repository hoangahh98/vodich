const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBalancedDoublesTeams } = require('../dist/tournaments/tournament-schedule');

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
