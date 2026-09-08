const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizePrizes } = require('../dist/tournaments/tournament-form');
const { TournamentCrudService } = require('../dist/tournaments/tournament-crud.service');

/**
 * CA THẬT (8/9/2026): tạo giải mới, chọn "Nhập tiền thưởng thủ công", gõ 200.000đ → bị từ chối
 * "không được vượt quá quỹ thưởng hiện có (0đ)". Lúc tạo giải chưa ai đóng phí nên quỹ luôn 0đ,
 * tức là KHÔNG BAO GIỜ tạo được giải có mức thưởng dự kiến. Mức thưởng là con số dự kiến, quỹ
 * tăng dần theo đóng phí — không được chặn.
 */
test('tiền thưởng thủ công lưu được dù quỹ hiện có chưa đủ (lúc tạo giải quỹ luôn 0đ)', () => {
  assert.deepEqual(normalizePrizes({ prizeMode: 'manual', prizeRate1: '200,000', prizeRate2: '100,000', prizeRate3: '50,000' }), [200000, 100000, 50000]);
});

test('tiền thưởng thủ công âm thì về 0, bỏ trống thì lấy mặc định', () => {
  assert.deepEqual(normalizePrizes({ prizeMode: 'manual', prizeRate1: '-5', prizeRate2: '', prizeRate3: '0' }), [0, 30, 0]);
});

test('tỷ lệ phần trăm vẫn bị kẹp về tổng 100', () => {
  assert.deepEqual(normalizePrizes({ prizeMode: 'percent', prizeRate1: '70', prizeRate2: '40', prizeRate3: '10' }), [70, 30, 0]);
});

test('tạo giải với thưởng thủ công 200.000đ không ném lỗi', async () => {
  let created;
  const service = new TournamentCrudService({
    tournament: {
      create: async ({ data }) => {
        created = data;
        return { id: 1n, ...data };
      },
    },
  });
  await service.create({ name: 'Cúp thu', prizeMode: 'manual', prizeRate1: '200,000', prizeRate2: '0', prizeRate3: '0' }, { id: '1', email: 'admin', displayName: 'Admin', role: 'ADMIN' });
  assert.equal(created.prizeRate1, 200000);
});
