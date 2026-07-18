const assert = require('node:assert/strict');
const test = require('node:test');

const { parseCountable, matchKey, leftoverOf } = require('../dist/medical/cabinet');

test('parseCountable đọc được số lượng dạng đếm được', () => {
  assert.deepEqual(parseCountable('10 gói'), { count: 10, unit: 'gói' });
  assert.deepEqual(parseCountable('10 Gói'), { count: 10, unit: 'gói' });
  assert.deepEqual(parseCountable('5 ống'), { count: 5, unit: 'ống' });
  assert.deepEqual(parseCountable('20 viên'), { count: 20, unit: 'viên' });
});

test('chai/lọ/siro KHÔNG được tính vào tủ thuốc', () => {
  // Mở nắp rồi thì hạn dùng phụ thuộc bảo quản, đếm tồn vô nghĩa.
  assert.equal(parseCountable('1 lọ'), null);
  assert.equal(parseCountable('1 chai'), null);
  assert.equal(parseCountable('2 tuýp'), null);
  assert.equal(parseCountable(''), null);
  assert.equal(parseCountable('không rõ'), null);
});

test('matchKey gom được các kiểu AI đọc tên cùng một thuốc', () => {
  const keys = [
    'Montelukast 4mg (Pakast 4)',
    'Montelukast 4mg',
    'MONTELUKAST',
    'Montelukast 4 mg (Pakast 4)',
  ].map(matchKey);
  assert.equal(new Set(keys).size, 1, `phải gom về 1 khoá, đang ra: ${keys.join(' | ')}`);
  assert.equal(keys[0], 'montelukast');
});

test('matchKey bỏ dấu tiếng Việt và hàm lượng phức tạp', () => {
  assert.equal(matchKey('Ambroxol 30mg/5ml (Justone)'), 'ambroxol');
  assert.equal(matchKey('Ciprofloxacin (Vinhopro)'), 'ciprofloxacin');
  assert.equal(matchKey('Terbutaline 0.03%, Guaifenesin 1.33%'), 'terbutaline');
});

test('thuốc khác nhau KHÔNG bị gom nhầm về một khoá', () => {
  const a = matchKey('Montelukast 4mg');
  const b = matchKey('Ambroxol 30mg');
  assert.notEqual(a, b);
});

test('leftoverOf tính đúng số còn thừa khi ngừng giữa chừng', () => {
  // 10 gói, đã uống 4 -> còn 6
  assert.deepEqual(leftoverOf({ drugName: 'Montelukast 4mg (Pakast 4)', quantity: '10 gói', dosesTaken: 4 }), {
    drugName: 'Montelukast 4mg (Pakast 4)',
    matchKey: 'montelukast',
    unit: 'gói',
    quantity: 6,
  });
});

test('uống hết hoặc quá số cấp thì không ghi vào tủ thuốc', () => {
  assert.equal(leftoverOf({ drugName: 'X', quantity: '10 gói', dosesTaken: 10 }), null);
  assert.equal(leftoverOf({ drugName: 'X', quantity: '10 gói', dosesTaken: 12 }), null, 'không được ra số âm');
});

test('thuốc dạng lọ không sinh bản ghi tồn dù còn thừa', () => {
  assert.equal(leftoverOf({ drugName: 'Ambroxol', quantity: '1 lọ', dosesTaken: 2 }), null);
});
