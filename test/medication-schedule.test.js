const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSchedule, addDays, slotsFor, remainingFrom } = require('../dist/medical/medication-schedule');
const { buildIcs } = require('../dist/medical/ics');

const item = (over) => ({
  id: '1',
  drugName: 'Thuốc',
  dosage: '4ml',
  route: 'UONG',
  timing: '',
  timesPerDay: 2,
  days: 5,
  note: '',
  isAntibiotic: false,
  ...over,
});

test('buildSchedule sinh đủ số liều = số lần/ngày x số ngày', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'SANG');
  const doses = groups.reduce((sum, g) => sum + g.lines.length, 0);
  assert.equal(doses, 10);
  assert.equal(groups[0].date, '2026-07-18');
  assert.equal(groups[0].time, '07:30');
});

test('bắt đầu buổi tối thì bỏ cữ sáng ngày đầu nhưng KHÔNG hụt liều', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'TOI');
  const doses = groups.reduce((sum, g) => sum + g.lines.length, 0);
  assert.equal(doses, 10, 'vẫn phải đủ 10 liều');
  assert.equal(groups[0].date, '2026-07-18');
  assert.equal(groups[0].time, '19:30', 'cữ đầu là tối hôm bắt đầu');
  // 10 liều, 2 cữ/ngày, lệch nửa ngày -> liều cuối rơi vào sáng ngày thứ 6
  const last = groups[groups.length - 1];
  assert.equal(last.date, '2026-07-23');
  assert.equal(last.time, '07:30');
});

test('thuốc uống 1 lần trước khi ngủ được xếp vào cữ tối, không phải cữ sáng', () => {
  assert.deepEqual(slotsFor({ timesPerDay: 1, timing: 'TRUOC_NGU' }), ['20:30']);
  assert.deepEqual(slotsFor({ timesPerDay: 1, timing: '' }), ['07:30']);
});

test('số ngày lẻ 2,5 cho ra đúng 5 liều và kết thúc giữa ngày thứ 3', () => {
  // Budesonid: 5 ống, khí dung ngày 2 lần -> 2,5 ngày. Ép về số nguyên là sai liều.
  const { groups } = buildSchedule([item({ drugName: 'Budesonid', timesPerDay: 2, days: 2.5 })], '2026-07-18', 'SANG');
  const doses = groups.reduce((sum, g) => sum + g.lines.length, 0);
  assert.equal(doses, 5, 'đúng 5 ống, không hơn không kém');
  const last = groups[groups.length - 1];
  assert.equal(last.date, '2026-07-20', 'hết vào ngày thứ 3');
  assert.equal(last.time, '07:30', 'và là cữ sáng, không phải cữ tối');
});

test('nửa ngày (1 liều duy nhất) vẫn lên lịch được, không bị loại nhầm', () => {
  const { groups, skipped } = buildSchedule([item({ timesPerDay: 2, days: 0.5 })], '2026-07-18', 'SANG');
  assert.equal(skipped.length, 0);
  assert.equal(groups.reduce((s, g) => s + g.lines.length, 0), 1);
});

test('thuốc thiếu số lần/ngày hoặc số ngày bị loại ra kèm lý do, không đoán bừa', () => {
  const { groups, skipped } = buildSchedule(
    [item({ drugName: 'Thiếu lần', timesPerDay: 0 }), item({ drugName: 'Thiếu ngày', days: 0 })],
    '2026-07-18',
    'SANG',
  );
  assert.equal(groups.length, 0);
  assert.deepEqual(
    skipped.map((s) => s.drugName),
    ['Thiếu lần', 'Thiếu ngày'],
  );
});

test('nhiều thuốc cùng mốc giờ được gom vào một cữ', () => {
  const { groups } = buildSchedule(
    [item({ id: '1', drugName: 'A', days: 1 }), item({ id: '2', drugName: 'B', days: 1 })],
    '2026-07-18',
    'SANG',
  );
  assert.equal(groups[0].lines.length, 2);
  assert.deepEqual(groups[0].lines.map((l) => l.drugName), ['A', 'B']);
});

test('thuốc kết thúc sớm không bị nhắc tiếp ở những ngày sau', () => {
  const { groups } = buildSchedule(
    [item({ id: '1', drugName: 'Ngắn', days: 1 }), item({ id: '2', drugName: 'Dài', days: 3 })],
    '2026-07-18',
    'SANG',
  );
  const lastDay = groups.filter((g) => g.date === '2026-07-20');
  assert.ok(lastDay.length > 0);
  for (const group of lastDay) {
    assert.deepEqual(group.lines.map((l) => l.drugName), ['Dài'], 'ngày cuối chỉ còn thuốc dài ngày');
  }
});

test('remainingFrom chỉ giữ phần liệu trình còn lại cho máy lấy lịch giữa chừng', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'SANG');
  // Máy thứ hai lấy lịch sáng ngày 21/07, khi đã uống 3 ngày
  const left = remainingFrom(groups, '2026-07-21', '00:00');
  assert.ok(left.length < groups.length, 'phải bớt đi so với cả liệu trình');
  assert.ok(left.every((g) => g.date >= '2026-07-21'), 'không được còn cữ nào trước ngày lấy');
  assert.equal(left[0].date, '2026-07-21');
  assert.equal(left[0].time, '07:30');
});

test('remainingFrom giữ lại cữ rơi đúng vào mốc đang xét, không làm mất liều sắp uống', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG');
  const left = remainingFrom(groups, '2026-07-18', '07:30');
  assert.equal(left[0].time, '07:30', 'cữ đúng mốc phải được giữ');
});

test('remainingFrom trả rỗng khi liệu trình đã xong', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG');
  assert.deepEqual(remainingFrom(groups, '2026-08-01', '00:00'), []);
});

test('UID giữ nguyên giữa bản đầy đủ và bản còn lại nên máy cũ không bị nhân đôi sự kiện', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'SANG');
  const left = remainingFrom(groups, '2026-07-21', '00:00');
  const uids = (ics) => (ics.match(/UID:[^\r\n]+/g) || []);
  const fullUids = uids(buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx5' }));
  const leftUids = uids(buildIcs(left, { calendarName: 'T', uidPrefix: 'rx5' }));
  assert.ok(leftUids.length && leftUids.every((uid) => fullUids.includes(uid)));
});

test('addDays qua mốc cuối tháng và năm nhuận', () => {
  assert.equal(addDays('2026-07-30', 3), '2026-08-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('buildIcs sinh file hợp lệ, escape ký tự đặc biệt và dùng CRLF', () => {
  const { groups } = buildSchedule([item({ drugName: 'Thuốc A; liều 1,5ml', days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG');
  const ics = buildIcs(groups, { calendarName: 'Test', uidPrefix: 'rx9', followUpDate: '2026-07-21' });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('\r\n'), 'iCalendar bắt buộc CRLF');
  assert.ok(ics.includes('Thuốc A\\; liều 1\\,5ml'), 'phải escape dấu ; và ,');
  assert.ok(!/[^\\];/.test(ics.match(/DESCRIPTION:.*/)[0]), 'không được còn dấu ; chưa escape trong DESCRIPTION');
  assert.ok(ics.includes('BEGIN:VALARM'), 'phải có chuông báo');
  assert.ok(ics.includes('DTSTART:20260718T073000'), 'giờ floating, không có hậu tố Z');
  assert.ok(!ics.includes('DTSTART:20260718T073000Z'), 'không được ép về UTC');
  assert.ok(ics.includes('SUMMARY:🏥 Tái khám'));
  assert.ok(ics.includes('TRIGGER:-P1D'), 'tái khám nhắc trước 1 ngày');
});

test('mỗi cữ là một sự kiện riêng, không dùng RRULE (tránh nhắc thuốc đã hết)', () => {
  const { groups } = buildSchedule([item({ days: 3, timesPerDay: 2 })], '2026-07-18', 'SANG');
  const ics = buildIcs(groups, { calendarName: 'Test', uidPrefix: 'rx1' });
  assert.ok(!ics.includes('RRULE'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
});

test('UID ổn định theo đơn + ngày + giờ để import lại không nhân đôi sự kiện', () => {
  const { groups } = buildSchedule([item({ days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG');
  const first = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx7' });
  const second = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx7' });
  const uidOf = (ics) => ics.match(/UID:(.+)/)[1].trim();
  assert.equal(uidOf(first), uidOf(second));
  assert.equal(uidOf(first), 'rx7-20260718-0730@vodich');
});
