const assert = require('node:assert/strict');
const test = require('node:test');

const { inferDays } = require('../dist/medical/medical-ai.service');

const item = (over) => ({
  drugName: '', isAntibiotic: false, dosage: '', frequency: '', duration: '', note: '',
  timesPerDay: 0, days: 0, quantity: '', quantityCount: 0, route: '', timing: '',
  ...over,
});

test('đơn không ghi số ngày thì suy ra từ số lượng: 5 ống, ngày 2 lần = 2,5 ngày', () => {
  assert.equal(inferDays(item({ timesPerDay: 2, quantity: '5 ống', quantityCount: 5 })), 2.5);
});

test('10 gói, ngày 2 lần = 5 ngày', () => {
  assert.equal(inferDays(item({ timesPerDay: 2, quantity: '10 gói', quantityCount: 10 })), 5);
});

test('10 gói, ngày 1 lần trước ngủ = 10 ngày', () => {
  assert.equal(inferDays(item({ timesPerDay: 1, quantity: '10 Gói', quantityCount: 10 })), 10);
});

test('số ngày đơn đã ghi rõ thì giữ nguyên, không suy diễn đè lên', () => {
  assert.equal(inferDays(item({ days: 7, timesPerDay: 3, quantity: '1 lọ', quantityCount: 1 })), 7);
});

test('dạng lọ/chai KHÔNG suy ra số ngày vì một lọ dùng được nhiều lần', () => {
  // 1 lọ nhỏ mũi ngày 3 lần không có nghĩa là dùng 1/3 ngày.
  assert.equal(inferDays(item({ timesPerDay: 3, quantity: '1 lọ', quantityCount: 1 })), 0);
  assert.equal(inferDays(item({ timesPerDay: 2, quantity: '1 chai', quantityCount: 1 })), 0);
});

test('thiếu số lần/ngày hoặc thiếu số lượng thì trả 0 để người dùng tự điền', () => {
  assert.equal(inferDays(item({ timesPerDay: 0, quantity: '5 ống', quantityCount: 5 })), 0);
  assert.equal(inferDays(item({ timesPerDay: 2, quantity: '5 ống', quantityCount: 0 })), 0);
});

test('kết quả được chốt về bội của 0,5 để khớp cữ sáng/tối', () => {
  // 7 gói / 2 lần = 3,5 ngày
  assert.equal(inferDays(item({ timesPerDay: 2, quantity: '7 gói', quantityCount: 7 })), 3.5);
  // 5 viên / 3 lần = 1,67 -> chốt về 1,5
  assert.equal(inferDays(item({ timesPerDay: 3, quantity: '5 viên', quantityCount: 5 })), 1.5);
});
