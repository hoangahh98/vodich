const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { buildBalancedDoublesTeams, buildRandomDoublesTeams } = require('../dist/tournaments/tournament-schedule');

const root = path.join(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/spin-pairing.js'), 'utf8'), context);
const pairing = context.window.VodichSpinPairing;

/**
 * `vm.runInNewContext` dựng một realm riêng, nên mảng do spin-pairing trả về không cùng
 * prototype với mảng ở đây và `deepStrictEqual` sẽ báo "same structure but not reference-equal".
 * Chuyển về giá trị thuần trước khi so.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Vòng quay chạy ở TRÌNH DUYỆT còn "Chia trận" chạy ở SERVER. Hai bên ghép theo hai đoạn mã
 * khác nhau, nên bộ test này so thẳng kết quả của hai bên với nhau: quay ra một đằng mà bấm
 * chia trận ra một nẻo thì vòng quay thành trò vô nghĩa.
 *
 * So theo TỔ HỢP MỨC TRÌNH chứ không so tên: cả hai bên đều bốc ngẫu nhiên nên tên chắc chắn
 * khác, nhưng "đội gồm một người trình B và một người trình D" thì phải giống hệt nhau.
 */

/** Danh sách đăng ký: tên mang sẵn trình ở ký tự đầu để tra ngược. */
function regs(spec) {
  const list = [];
  for (const [level, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) {
      list.push({ player: { displayName: `${level}${i}` }, externalName: null, externalEmail: null, skillLevel: level === '?' ? '' : level });
    }
  }
  return list;
}

const spinPlayers = (spec) => regs(spec).map((reg) => ({ name: reg.player.displayName, skill: reg.skillLevel }));

/** "B3 / D1" -> "BD". Chỗ trống thành "_". */
const levelsOfTeam = (names) =>
  names
    .map((name) => (name ? name.trim()[0] : '_'))
    .sort()
    .join('');

/** Bảng đếm các tổ hợp trình, ví dụ { BD: 3, CC: 1 }. */
function shapeOf(teams) {
  const shape = {};
  for (const team of teams) {
    const key = levelsOfTeam(team);
    shape[key] = (shape[key] || 0) + 1;
  }
  return shape;
}

const serverShape = (spec, random) => {
  const teams = (random ? buildRandomDoublesTeams : buildBalancedDoublesTeams)(regs(spec));
  return shapeOf(teams.map((team) => team.split(' / ').map((name) => (name === 'Chờ thành viên' ? '' : name))));
};

const spinShape = (spec, rule) => shapeOf(plain(pairing.createDraw(spinPlayers(spec), rule).drawAll()));

/**
 * Chính là điều cần soi kỹ: rule KHÔNG phải "A ghép D". Nó là "mức mạnh nhất ghép mức yếu
 * nhất rồi tiến vào giữa", nên giải toàn B/C/D hay A/C/D vẫn phải ghép đúng.
 */
const SKILL_CASES = [
  { name: '4 mức A B C D', spec: { A: 2, B: 2, C: 2, D: 2 } },
  { name: '4 mức B C D và trình trống', spec: { B: 2, C: 2, D: 2, '?': 2 } },
  { name: '3 mức A C D (không có B)', spec: { A: 2, C: 2, D: 2 } },
  { name: '3 mức B C D', spec: { B: 3, C: 2, D: 3 } },
  { name: '2 mức C D', spec: { C: 3, D: 3 } },
  { name: '2 mức A D lệch số lượng', spec: { A: 2, D: 4 } },
  { name: '1 mức duy nhất', spec: { C: 6 } },
  { name: 'lẻ một người', spec: { C: 2, D: 3 } },
  { name: 'lệch nhiều, dồn người dư', spec: { A: 1, B: 5, D: 2 } },
];

for (const { name, spec } of SKILL_CASES) {
  test(`vòng quay khớp server khi phân trình — ${name}`, () => {
    // Cả hai bên đều random nên chạy nhiều lần: hình dạng phải ổn định và trùng nhau mọi lần.
    const expected = serverShape(spec, false);
    for (let run = 0; run < 40; run++) {
      assert.deepEqual(serverShape(spec, false), expected, 'server tự nó đã không ổn định');
      assert.deepEqual(spinShape(spec, 'BY_SKILL'), expected, `vòng quay lệch server ở ca "${name}"`);
    }
  });
}

test('vòng quay: không phân trình thì không ép cao ghép thấp', () => {
  // 4 A + 4 D. Phân trình thì 100% là AD; không phân trình phải có lúc ra AA hoặc DD.
  let sameLevelSeen = false;
  for (let run = 0; run < 80 && !sameLevelSeen; run++) {
    sameLevelSeen = Object.keys(spinShape({ A: 4, D: 4 }, 'RANDOM')).some((key) => key[0] === key[1]);
  }
  assert.ok(sameLevelSeen, 'rule không phân trình vẫn đang ghép cân bằng theo trình');
});

test('vòng quay: không làm rơi ai, số đội đúng bằng server', () => {
  for (const { name, spec } of SKILL_CASES) {
    for (const rule of ['BY_SKILL', 'RANDOM']) {
      const players = spinPlayers(spec);
      const teams = plain(pairing.createDraw(players, rule).drawAll());
      const drawn = teams.flat().filter(Boolean);
      assert.equal(new Set(drawn).size, drawn.length, `${name}/${rule}: có người bị bốc hai lần`);
      assert.equal(drawn.length, players.length, `${name}/${rule}: bốc thiếu người`);
      assert.equal(teams.length, Math.ceil(players.length / 2), `${name}/${rule}: sai số đội`);
    }
  }
});

test('vòng quay: lẻ một người thì để trống chỗ bạn đánh cặp, không bỏ rơi', () => {
  const teams = plain(pairing.createDraw(spinPlayers({ C: 2, D: 3 }), 'BY_SKILL').drawAll());
  const halfTeams = teams.filter(([, second]) => !second);
  assert.equal(halfTeams.length, 1);
  assert.ok(halfTeams[0][0], 'người lẻ vẫn phải có tên');
});

test('vòng quay: nhãn ô quay nói đúng mức trình đang bốc', () => {
  // 3 mức B/C/D: lượt đầu ghép hai đầu (B với D), lượt sau là mức giữa (C với C).
  const draw = pairing.createDraw(spinPlayers({ B: 2, C: 2, D: 2 }), 'BY_SKILL');
  assert.deepEqual(plain(draw.next().labels), ['Trình B', 'Trình D']);
  assert.deepEqual(plain(draw.next().labels), ['Trình B', 'Trình D']);
  assert.deepEqual(plain(draw.next().labels), ['Trình C', 'Trình C']);
});

test('vòng quay: trình bỏ trống hiện là "Chưa rõ trình" và xếp yếu nhất', () => {
  const draw = pairing.createDraw(spinPlayers({ A: 2, '?': 2 }), 'BY_SKILL');
  assert.deepEqual(plain(draw.next().labels), ['Trình A', 'Chưa rõ trình']);
});

test('vòng quay: không phân trình chỉ dùng một ô nguồn chung', () => {
  const draw = pairing.createDraw(spinPlayers({ A: 2, D: 2 }), 'RANDOM');
  const first = draw.next();
  assert.deepEqual(plain(first.labels), ['Tất cả', 'Tất cả']);
  assert.equal(first.sources[0].length, 4, 'phải bốc từ toàn bộ danh sách');
});

test('vòng quay: danh sách rỗng hoặc một người không làm nổ', () => {
  assert.deepEqual(plain(pairing.createDraw([], 'BY_SKILL').drawAll()), []);
  assert.deepEqual(plain(pairing.createDraw(spinPlayers({ C: 1 }), 'BY_SKILL').drawAll()), [['C0', '']]);
});
