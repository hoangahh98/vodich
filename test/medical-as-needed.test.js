const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveAsNeeded } = require('../dist/medical/medical-ai.service');

const item = (over) => ({ frequency: '', note: '', duration: '', dosage: '', asNeeded: false, ...over });

test('CA THẬT: "Khí dung ngày 2 lần" KHÔNG phải thuốc dùng khi cần', () => {
  // AI đọc nhầm "Khí dung" thành "Khi dùng" rồi bật cờ khi-cần, làm Budesonid (corticoid
  // duy trì, phải dùng đều) biến mất khỏi lịch nhắc mà không ai biết.
  assert.equal(resolveAsNeeded(item({ asNeeded: true, frequency: 'Khí dung ngày 2 lần mỗi lần 1 ống' })), false);
  assert.equal(resolveAsNeeded(item({ asNeeded: true, frequency: 'Khi dùng ngày 2 lần mỗi lần 1 ống' })), false);
});

test('lịch dùng cố định hằng ngày luôn được lên lịch, dù AI bật cờ', () => {
  ['Ngày 2 lần mỗi lần 4ml', 'Ngày 3 lần mỗi lần 2 giọt/bên', 'Ngày 1 gói tối trước khi đi ngủ'].forEach((frequency) => {
    assert.equal(resolveAsNeeded(item({ asNeeded: true, frequency })), false, frequency);
  });
});

test('thuốc có triệu chứng kích hoạt rõ ràng thì đúng là dùng khi cần', () => {
  const cases = [
    'Uống khi sốt trên 38.5 độ',
    'Xịt khi lên cơn khó thở',
    'Uống khi cần',
    'Dùng nếu đau nhiều',
    'Uống khi ho nhiều',
  ];
  cases.forEach((frequency) => {
    assert.equal(resolveAsNeeded(item({ asNeeded: true, frequency })), true, frequency);
  });
});

test('triệu chứng nằm ở ghi chú cũng được nhận', () => {
  assert.equal(resolveAsNeeded(item({ asNeeded: true, frequency: 'Ngày 4 lần', note: 'chỉ dùng khi sốt cao' })), true);
});

test('AI không bật cờ thì không tự suy diễn thành khi cần', () => {
  assert.equal(resolveAsNeeded(item({ asNeeded: false, frequency: 'Uống khi sốt trên 38.5' })), false);
});
