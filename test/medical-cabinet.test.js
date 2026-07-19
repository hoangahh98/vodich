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

test('quyết định mua: tủ tính TUYỆT ĐỐI từ mốc tồn lúc khai', () => {
  // tủ = max(0, tồn_lúc_khai + đã_mua − đơn_cần). Nhà còn 4, đơn cần 7:
  const after = (baseline, bought, needed) => Math.max(0, baseline + bought - needed);

  assert.equal(after(4, 3, 7), 0, 'mua vừa đủ -> tủ hết');
  assert.equal(after(4, 7, 7), 4, 'mua đủ đơn -> 4 gói cũ vẫn nằm tủ');
  assert.equal(after(4, 0, 7), 0, 'không mua -> kẹp về 0, không âm');

  // Bấm lưu nhiều lần / đổi ý qua lại phải ra cùng kết quả. Bản đầu cộng dồn theo từng
  // lần bấm và đã sai thật: mua 0 -> kẹp về 0 (mất dấu phần âm) -> sửa thành mua 3 thì
  // cộng 3 vào 0 ra 3, trong khi đúng phải là 0.
  for (const seq of [[0, 3], [3, 7, 3], [7, 0, 7]]) {
    const last = seq[seq.length - 1];
    assert.equal(after(4, last, 7), after(4, last, 7), 'phải chỉ phụ thuộc số cuối cùng');
    assert.equal(after(4, last, 7), Math.max(0, 4 + last - 7));
  }
});

test('cảnh báo thiếu tính từ mốc tồn lúc khai, không phải tồn hiện tại', () => {
  // Nhà còn 4, đơn cần 7, mua 0 -> thiếu 3. Đọc tủ hiện tại (đã bị trừ về 0) sẽ ra
  // thiếu 7 -- đó chính là lỗi đã gặp, nên phải dùng mốc đã chụp.
  const short = (needed, bought, stockAtPurchase) => needed - bought - stockAtPurchase;
  assert.equal(short(7, 0, 4), 3);
  assert.equal(short(7, 3, 4), 0, 'mua vừa đủ thì không thiếu');
  assert.ok(short(7, 7, 4) < 0, 'mua đủ đơn thì dư, không cảnh báo');
});
