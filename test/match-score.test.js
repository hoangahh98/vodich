const assert = require('node:assert/strict');
const test = require('node:test');

const { MatchScoreService, computeScore, scoreRulesFor } = require('../dist/tournaments/match-score.service');

/**
 * Lưu điểm tách khỏi gateway (28/9/2026) sau ca chủ app báo: điểm 11-5 hết trận mà refresh máy nào
 * cũng không thấy. Handler socket cũ tự gọi DB, exception bị Nest nuốt im lặng, client không biết.
 * Hai lời hứa của service này: (1) toán chuẩn hoá điểm là hàm thuần, (2) `save()` KHÔNG BAO GIỜ ném —
 * mọi lỗi thành `{ ok: false, retryable }` để client thử lại hoặc đi đường HTTP dự phòng.
 */

const GROUP = { touchScore: 11, maxScore: 15 };

test('computeScore: chạm 11 hơn 2 là xong, 11-10 chưa xong, đụng trần 15 thì xong dù chỉ hơn 1', () => {
  assert.equal(computeScore({ scoreA: 11, scoreB: 5 }, GROUP).status, 'FINISHED');
  assert.equal(computeScore({ scoreA: 11, scoreB: 10 }, GROUP).status, 'PLAYING');
  assert.equal(computeScore({ scoreA: 12, scoreB: 10 }, GROUP).status, 'FINISHED');
  assert.equal(computeScore({ scoreA: 15, scoreB: 14 }, GROUP).status, 'FINISHED');
  // Điểm gửi bừa bị kẹp về trần: 20-0 thành 11-0.
  assert.deepEqual(computeScore({ scoreA: 20, scoreB: 0 }, GROUP), { scoreA: 11, scoreB: 0, status: 'FINISHED', servingTeam: 'A', scoreOrder: 2 });
  // Âm / rác thành 0; đội giao và tay chuẩn hoá về A/B và 1/2.
  assert.deepEqual(computeScore({ scoreA: -3, scoreB: 'x', servingTeam: 'B', scoreOrder: 1 }, GROUP), { scoreA: 0, scoreB: 0, status: 'PLAYING', servingTeam: 'B', scoreOrder: 1 });
  assert.equal(computeScore({ scoreA: 0, scoreB: 0, servingTeam: 'Z', scoreOrder: 7 }, GROUP).servingTeam, 'A');
  assert.equal(computeScore({ scoreA: 0, scoreB: 0, servingTeam: 'Z', scoreOrder: 7 }, GROUP).scoreOrder, 2);
});

test('scoreRulesFor: vòng bảng lấy bộ thường, thiếu số thì về 11/15', () => {
  assert.deepEqual(scoreRulesFor({ touchScore: 11, maxScore: 15, knockoutTouchScore: 15, knockoutMaxScore: 19 }, 'Vòng bảng'), GROUP);
  assert.deepEqual(scoreRulesFor({}, 'Vòng bảng'), GROUP);
});

const user = { id: '1', email: 'admin', displayName: 'Admin', role: 'ADMIN' };
const auth = { featureSet: async () => new Set(['TOURNAMENTS']), can: () => true };
const tournaments = { canManage: async () => true };
const match = { id: 7n, tournamentId: 3n, stage: 'Vòng bảng', scoreA: 10, scoreB: 5, tournament: { touchScore: 11, maxScore: 15, knockoutTouchScore: 15, knockoutMaxScore: 19 } };

test('save: lưu xong trả bản ghi đã đổi BigInt thành chuỗi, kèm cờ hết trận', async () => {
  let written;
  const prisma = {
    matchGame: {
      findUnique: async () => match,
      update: async ({ data }) => { written = data; return { ...match, ...data }; },
    },
  };
  const service = new MatchScoreService(prisma, auth, tournaments);
  const result = await service.save(user, { tournamentId: '3', matchId: '7', scoreA: 11, scoreB: 5, servingTeam: 'A', scoreOrder: 2, seq: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  assert.equal(result.match.id, '7', 'id gửi qua socket/JSON phải là chuỗi');
  assert.equal(written.status, 'FINISHED');
  assert.equal(result.tournamentId, 3n);
});

test('save: DB rớt thì KHÔNG ném — trả retryable để client thử lại / đi đường HTTP', async () => {
  const prisma = { matchGame: { findUnique: async () => { throw new Error('pool timeout'); }, update: async () => { throw new Error('không tới đây'); } } };
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await new MatchScoreService(prisma, auth, tournaments).save(user, { tournamentId: '3', matchId: '7', scoreA: 1, scoreB: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
  } finally {
    console.error = quiet;
  }
});

test('save: sai quyền, sai trận, sai giải thì từ chối và KHÔNG retryable (thử lại vô ích)', async () => {
  const prisma = { matchGame: { findUnique: async ({ where }) => (where.id === 7n ? match : null), update: async () => { throw new Error('không được ghi'); } } };
  const service = new MatchScoreService(prisma, auth, tournaments);
  const body = { tournamentId: '3', matchId: '7', scoreA: 1, scoreB: 0 };
  assert.deepEqual(await service.save(undefined, body), { ok: false, message: 'Không có quyền ghi điểm', retryable: false });
  assert.deepEqual(await service.save({ ...user, role: 'CLIENT' }, body), { ok: false, message: 'Không có quyền ghi điểm', retryable: false });
  assert.equal((await service.save(user, { ...body, matchId: 'abc' })).retryable, false, 'id trận rác không được ném BigInt error');
  assert.equal((await service.save(user, { ...body, matchId: '99' })).message, 'Trận không còn tồn tại');
  // Đường HTTP mang id giải trên URL: trận thuộc giải khác thì không ghi.
  assert.equal((await service.save(user, { ...body, tournamentId: '4' })).message, 'Trận không thuộc giải này');
  const noManage = new MatchScoreService(prisma, auth, { canManage: async () => false });
  assert.equal((await noManage.save(user, body)).retryable, false);
});
