const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSchedule,
  addDays,
  slotsFor,
  remainingFrom,
  safeDoseTimes,
  DEFAULT_DOSE_TIMES,
} = require('../dist/medical/medication-schedule');
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
  assert.equal(groups[0].time, '07:00');
});

test('bắt đầu buổi tối thì bỏ cữ sáng ngày đầu nhưng KHÔNG hụt liều', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'TOI');
  const doses = groups.reduce((sum, g) => sum + g.lines.length, 0);
  assert.equal(doses, 10, 'vẫn phải đủ 10 liều');
  assert.equal(groups[0].date, '2026-07-18');
  assert.equal(groups[0].time, '19:00', 'cữ đầu là tối hôm bắt đầu');
  // 10 liều, 2 cữ/ngày, lệch nửa ngày -> liều cuối rơi vào sáng ngày thứ 6
  const last = groups[groups.length - 1];
  assert.equal(last.date, '2026-07-23');
  assert.equal(last.time, '07:00');
});

test('bắt đầu từ cữ TRƯA thì cữ đầu là mốc trưa, không phải sáng hay tối', () => {
  // Thuốc nhỏ mũi ngày 3 lần: 07:00 / 12:00 / 19:00
  const { groups } = buildSchedule([item({ timesPerDay: 3, days: 7 })], '2026-07-18', 'TRUA');
  assert.equal(groups[0].date, '2026-07-18');
  assert.equal(groups[0].time, '12:00');
  assert.equal(groups.reduce((s, g) => s + g.lines.length, 0), 21, 'vẫn đủ 3 x 7 liều');
});

test('ba buổi cho ra ba mốc đầu khác nhau trên cùng một thuốc', () => {
  const first = (slot) => buildSchedule([item({ timesPerDay: 3, days: 2 })], '2026-07-18', slot).groups[0];
  assert.equal(first('SANG').time, '07:00');
  assert.equal(first('TRUA').time, '12:00');
  assert.equal(first('TOI').time, '19:00');
  // Ngày đầu phải giống nhau, chỉ khác mốc giờ
  ['SANG', 'TRUA', 'TOI'].forEach((slot) => assert.equal(first(slot).date, '2026-07-18'));
});

test('thuốc uống 2 lần/ngày mà chọn cữ TRƯA thì rơi vào cữ tối, không ép uống sai giờ', () => {
  // 2 lần/ngày chỉ có 07:00 và 19:00, không có mốc trưa
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-18', 'TRUA');
  assert.equal(groups[0].time, '19:00');
  assert.equal(groups[0].date, '2026-07-18');
});

test('uống 1 lần buổi sáng mà chọn bắt đầu buổi tối thì dời sang hôm sau', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 1, days: 3, timing: '' })], '2026-07-18', 'TOI');
  assert.equal(groups[0].date, '2026-07-19', 'không ép uống lúc 07:00 đã trôi qua');
  assert.equal(groups[0].time, '07:00');
  assert.equal(groups.reduce((s, g) => s + g.lines.length, 0), 3);
});

test('thuốc uống 1 lần trước khi ngủ được xếp vào cữ tối, không phải cữ sáng', () => {
  assert.deepEqual(slotsFor({ timesPerDay: 1, timing: 'TRUOC_NGU' }), ['20:30']);
  assert.deepEqual(slotsFor({ timesPerDay: 1, timing: '' }), ['07:00']);
});

const TIMES = { morning: '06:30', noon: '11:30', evening: '18:00', bedtime: '21:00' };

test('giờ nhắc tuỳ chỉnh được dùng thay cho mốc mặc định', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 3, days: 2 })], '2026-07-18', 'SANG', TIMES);
  assert.deepEqual(groups.slice(0, 3).map((g) => g.time), ['06:30', '11:30', '18:00']);
});

test('ngưỡng "bắt đầu từ trưa/tối" bám theo giờ đã cấu hình, không cắm cứng', () => {
  const first = (slot) => buildSchedule([item({ timesPerDay: 3, days: 2 })], '2026-07-18', slot, TIMES).groups[0];
  assert.equal(first('TRUA').time, '11:30', 'trưa 11:30 vẫn phải nhận là cữ trưa');
  assert.equal(first('TOI').time, '18:00', 'tối 18:00 vẫn phải nhận là cữ tối');
});

test('thuốc trước khi ngủ dùng đúng mốc trước-ngủ đã cấu hình', () => {
  assert.deepEqual(slotsFor({ timesPerDay: 1, timing: 'TRUOC_NGU' }, TIMES), ['21:00']);
});

test('từ 4 lần/ngày trở lên vẫn neo vào giờ sáng đã đặt và giãn đều, không dồn cục', () => {
  const times4 = slotsFor({ timesPerDay: 4, timing: '' }, TIMES);
  const times6 = slotsFor({ timesPerDay: 6, timing: '' }, TIMES);
  assert.equal(times4[0], '06:30', 'luôn bắt đầu từ giờ sáng đã đặt');
  assert.equal(times6[0], '06:30');
  const gaps = (list) => list.slice(1).map((t, i) => toMin(t) - toMin(list[i]));
  // Không được có khoảng cách âm (mốc lùi) hay quá 8 tiếng giữa 2 cữ trong ngày
  [times4, times6].forEach((list) => {
    gaps(list).forEach((g) => {
      assert.ok(g > 0, `mốc phải tăng dần: ${list.join(',')}`);
      assert.ok(g <= 8 * 60, `không được hở quá 8 tiếng: ${list.join(',')}`);
    });
  });
});

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('safeDoseTimes chặn giờ rác, rơi về mặc định', () => {
  assert.deepEqual(safeDoseTimes({ morning: '25:00', noon: 'abc', evening: '', bedtime: '7:5' }), DEFAULT_DOSE_TIMES);
  assert.equal(safeDoseTimes({ morning: '06:30' }).morning, '06:30');
  assert.equal(safeDoseTimes({ morning: '06:30' }).noon, DEFAULT_DOSE_TIMES.noon, 'trường thiếu thì lấy mặc định');
});

test('số ngày lẻ 2,5 cho ra đúng 5 liều và kết thúc giữa ngày thứ 3', () => {
  // Budesonid: 5 ống, khí dung ngày 2 lần -> 2,5 ngày. Ép về số nguyên là sai liều.
  const { groups } = buildSchedule([item({ drugName: 'Budesonid', timesPerDay: 2, days: 2.5 })], '2026-07-18', 'SANG');
  const doses = groups.reduce((sum, g) => sum + g.lines.length, 0);
  assert.equal(doses, 5, 'đúng 5 ống, không hơn không kém');
  const last = groups[groups.length - 1];
  assert.equal(last.date, '2026-07-20', 'hết vào ngày thứ 3');
  assert.equal(last.time, '07:00', 'và là cữ sáng, không phải cữ tối');
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
  assert.equal(left[0].time, '07:00');
});

test('remainingFrom giữ lại cữ rơi đúng vào mốc đang xét, không làm mất liều sắp uống', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG');
  const left = remainingFrom(groups, '2026-07-18', '07:00');
  assert.equal(left[0].time, '07:00', 'cữ đúng mốc phải được giữ');
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
  assert.ok(ics.includes('DTSTART:20260718T070000'), 'giờ floating, không có hậu tố Z');
  assert.ok(!ics.includes('DTSTART:20260718T070000Z'), 'không được ép về UTC');
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
  assert.equal(uidOf(first), 'rx7-20260718-0700@vodich');
});
