const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeWarnings } = require('../dist/medical/medical-ai.service');

/*
  Cảnh báo an toàn hiện ngay dưới TỪNG dòng thuốc trong đơn, nên gắn sai dòng còn nguy hiểm
  hơn không cảnh báo: người ta thấy chữ đỏ ở thuốc A rồi yên tâm với thuốc B đang có vấn đề.
  Bộ lọc này là chỗ duy nhất chặn dữ liệu hỏng của AI trước khi nó xuống DB.
*/

test('chỉ giữ cảnh báo trỏ đúng vào một dòng thuốc có thật', () => {
  const warnings = normalizeWarnings(
    [
      { index: 0, level: 'WARN', reason: 'Trùng hoạt chất Amoxicillin với Augmentin đợt 12/07' },
      { index: 5, level: 'WARN', reason: 'Đơn chỉ có 3 thuốc, số này không trỏ vào đâu' },
      { index: -1, level: 'WARN', reason: 'Số âm' },
      { index: 'hai', level: 'WARN', reason: 'Không phải số' },
      { level: 'WARN', reason: 'Thiếu hẳn index' },
    ],
    3,
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].index, 0);
});

test('bỏ cảnh báo không có lý do hoặc mức lạ — không hiện chữ đỏ rỗng nghĩa', () => {
  const warnings = normalizeWarnings(
    [
      { index: 0, level: 'WARN', reason: '   ' },
      { index: 1, level: 'NGUY_HIEM', reason: 'Mức không nằm trong hợp đồng' },
      { index: 2, level: '', reason: 'Mức rỗng nghĩa là không có gì đáng nói' },
    ],
    3,
  );
  assert.deepEqual(warnings, []);
});

test('một dòng thuốc chỉ giữ MỘT cảnh báo, ưu tiên mức nặng hơn', () => {
  // Hai ba dòng chữ đỏ chồng lên nhau ở cùng một thuốc là mất tác dụng cảnh báo.
  const nheTruoc = normalizeWarnings(
    [
      { index: 0, level: 'CHECK', reason: 'Nên uống cách xa bữa ăn' },
      { index: 0, level: 'WARN', reason: 'Cùng nhóm kháng sinh với thuốc còn trong tủ' },
    ],
    1,
  );
  assert.equal(nheTruoc.length, 1);
  assert.equal(nheTruoc[0].level, 'WARN');

  const nangTruoc = normalizeWarnings(
    [
      { index: 0, level: 'WARN', reason: 'Cùng nhóm kháng sinh với thuốc còn trong tủ' },
      { index: 0, level: 'CHECK', reason: 'Nên uống cách xa bữa ăn' },
    ],
    1,
  );
  assert.equal(nangTruoc.length, 1);
  assert.equal(nangTruoc[0].level, 'WARN');
});

test('AI trả rác thay vì mảng thì im lặng, không nổ', () => {
  [null, undefined, 'không có cảnh báo nào', 42, { index: 0 }].forEach((raw) => {
    assert.deepEqual(normalizeWarnings(raw, 3), []);
  });
});

test('mức CHECK và WARN đều đi qua, giữ nguyên lý do đã cắt gọn', () => {
  const warnings = normalizeWarnings(
    [
      { index: 0, level: 'check', reason: 'Kháng sinh còn thừa trong tủ, mua ngày 01/07' },
      { index: 1, level: 'WARN', reason: 'x'.repeat(500) },
    ],
    2,
  );
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].level, 'CHECK');
  assert.equal(warnings[1].reason.length, 400);
});
