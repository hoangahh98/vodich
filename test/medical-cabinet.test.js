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

test('matchKey giữ nguyên cả tên: chỉ bỏ dấu và ký tự không phải chữ/số', () => {
  assert.equal(matchKey('Montelukast 4mg (Pakaat 4)'), 'montelukast4mgpakaat4');
  assert.equal(matchKey('Ambroxol 30mg/5ml (Justone)'), 'ambroxol30mg5mljustone');
  assert.equal(matchKey('Terbutaline 0.03%, Guaifenesin 1.33%'), 'terbutaline003guaifenesin133');
  // Bỏ dấu tiếng Việt và đ/Đ, vì AI lúc có dấu lúc không.
  assert.equal(matchKey('Nhỏ mũi Đơn giản'), 'nhomuidongian');
  // Khác hoa/thường và khác khoảng trắng thì vẫn phải ra một khoá.
  assert.equal(matchKey('MONTELUKAST 4MG'), matchKey('montelukast  4mg'));
});

test('matchKey KHÔNG gom thuốc khác hàm lượng hay khác hoạt chất', () => {
  // Đây là lý do đổi thuật toán: bản cũ rút gọn còn từ đầu tiên nên bốn cặp dưới đây
  // đều bị coi là cùng một thuốc. Với thuốc trẻ con thì báo nhầm nguy hiểm hơn bỏ sót.
  const mustDiffer = [
    ['Vitamin D3 (Aquadetrim)', 'Vitamin C 500mg'],
    ['Natri clorid 0.9% (Fysoline)', 'Natri bicarbonat 500mg'],
    ['Paracetamol 250mg (Hapacol)', 'Paracetamol 500mg (Efferalgan)'],
    ['Terbutaline 0.03%, Guaifenesin 1.33%', 'Terbutaline 0.05%, Bromhexin 0.8%'],
  ];
  for (const [a, b] of mustDiffer) {
    assert.notEqual(matchKey(a), matchKey(b), `phải khác khoá: "${a}" vs "${b}"`);
  }
});

test('cái giá đã biết: AI đọc tên lệch thì mất khớp — cố ý, không phải lỗi', () => {
  // Đảo thứ tự biệt dược/hoạt chất là ra khoá khác. Chấp nhận: hậu quả xấu nhất là mua
  // trùng, còn báo nhầm thì có thể không mua thứ đang cần. Đừng "sửa" bằng cách nới lỏng
  // so khớp mà không đọc lại chú thích trong src/medical/cabinet.ts.
  assert.notEqual(matchKey('Montelukast 4mg (Pakaat 4)'), matchKey('Pakaat 4 (Montelukast 4mg)'));
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
    matchKey: 'montelukast4mgpakast4',
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
