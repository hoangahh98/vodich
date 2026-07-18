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

test('lệnh huỷ cữ đơn cũ dùng đúng UID cũ và đánh dấu CANCELLED', () => {
  const { groups: oldGroups } = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG');
  const { groups: newGroups } = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-20', 'SANG');
  const ics = buildIcs(newGroups, {
    calendarName: 'T',
    uidPrefix: 'rx9',
    cancels: [{ uidPrefix: 'rx8', groups: oldGroups }],
  });

  // UID huỷ phải TRÙNG y hệt UID lúc xuất đơn cũ, nếu không app Lịch không biết huỷ cái gì
  const oldIcs = buildIcs(oldGroups, { calendarName: 'T', uidPrefix: 'rx8' });
  const uids = (s) => (s.match(/UID:[^\r\n]+/g) || []);
  uids(oldIcs).forEach((uid) => assert.ok(ics.includes(uid), `thiếu lệnh huỷ cho ${uid}`));

  assert.equal((ics.match(/STATUS:CANCELLED/g) || []).length, oldGroups.length);
  // Sự kiện của đơn mới KHÔNG được dính CANCELLED
  const newBlock = ics.slice(ics.indexOf('UID:rx9'), ics.indexOf('UID:rx8'));
  assert.ok(!newBlock.includes('STATUS:CANCELLED'));
});

test('tiêu đề sự kiện chỉ ghi ngày đơn, không lặp lại giờ (Lịch đã hiện giờ rồi)', () => {
  const groups = buildSchedule([item({ days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG').groups;
  const title = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', prescriptionLabel: '18/07/2026' })
    .match(/SUMMARY:[^\r\n]+/)[0];
  assert.equal(title, 'SUMMARY:💊 Đơn thuốc 18/07/2026');
  assert.ok(!title.includes('07:00'), 'không được nhắc lại giờ trong tiêu đề');
  assert.ok(!title.includes('Cữ thuốc'));
  assert.ok(!title.includes('4ml'), 'chi tiết thuốc để ở phần mô tả, không nhét lên tiêu đề');
});

test('tiêu đề có tên người thân để nhà nhiều người còn biết nhắc ai', () => {
  const groups = buildSchedule([item({ days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG').groups;
  const title = (opts) => buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', ...opts }).match(/SUMMARY:[^\r\n]+/)[0];

  assert.equal(title({ patientName: 'Khắc Minh', prescriptionLabel: '18/07/2026' }), 'SUMMARY:💊 Đơn thuốc Khắc Minh 18/07/2026');
  // Thiếu trường nào thì bỏ trường đó, không để lại khoảng trắng thừa
  assert.equal(title({ patientName: 'Khắc Minh' }), 'SUMMARY:💊 Đơn thuốc Khắc Minh');
  assert.equal(title({}), 'SUMMARY:💊 Đơn thuốc');
});

test('cữ có kháng sinh được nói thẳng bằng chữ, không chỉ dùng biểu tượng', () => {
  const withAbx = buildSchedule([item({ days: 1, timesPerDay: 1, isAntibiotic: true })], '2026-07-18', 'SANG').groups;
  const noAbx = buildSchedule([item({ days: 1, timesPerDay: 1, isAntibiotic: false })], '2026-07-18', 'SANG').groups;
  const title = (groups) => buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', prescriptionLabel: '18/07/2026' })
    .match(/SUMMARY:[^\r\n]+/)[0];

  assert.ok(title(withAbx).includes('(có kháng sinh)'), title(withAbx));
  assert.ok(title(withAbx).includes('❗'));
  assert.ok(!title(noAbx).includes('kháng sinh'), 'cữ không có kháng sinh thì không được ghi');
  assert.ok(!title(noAbx).includes('❗'));
});

test('UID theo số thứ tự cữ nên đổi giờ uống KHÔNG sinh sự kiện mới', () => {
  const early = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-18', 'SANG',
    { morning: '07:00', noon: '12:00', evening: '19:00', bedtime: '20:30' }).groups;
  const late = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-18', 'SANG',
    { morning: '08:30', noon: '13:00', evening: '20:00', bedtime: '21:30' }).groups;

  const uids = (groups) => (buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1' }).match(/UID:[^\r\n]+/g) || []);
  assert.deepEqual(uids(early), uids(late), 'đổi giờ mà UID đổi thì Lịch sẽ nhân đôi sự kiện');
  // Nhưng giờ trong file thì phải đổi thật
  assert.ok(buildIcs(late, { calendarName: 'T', uidPrefix: 'rx1' }).includes('T083000'));
});

test('đổi ngày bắt đầu cũng không sinh sự kiện mới', () => {
  const a = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-18', 'SANG').groups;
  const b = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-25', 'SANG').groups;
  const uids = (groups) => (buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1' }).match(/UID:[^\r\n]+/g) || []);
  assert.deepEqual(uids(a), uids(b));
});

test('liệu trình ngắn lại thì các cữ dôi ra của lần xuất trước bị huỷ', () => {
  const shorter = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG').groups; // 4 cữ
  const ics = buildIcs(shorter, { calendarName: 'T', uidPrefix: 'rx1', previousDoseCount: 10 });
  // 4 cữ mới + huỷ cữ số 5..10
  assert.equal((ics.match(/STATUS:CANCELLED/g) || []).length, 6);
  assert.ok(ics.includes('UID:rx1-d5@vodich'));
  assert.ok(ics.includes('UID:rx1-d10@vodich'));
  assert.ok(!ics.includes('UID:rx1-d11@vodich'));
});

test('SEQUENCE phải tăng thì Lịch mới chịu ghi đè bản cũ', () => {
  const groups = buildSchedule([item({ days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG').groups;
  const ics = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', sequence: 12345 });
  assert.ok(ics.includes('SEQUENCE:12345'));
});

test('bản "chỉ nạp phần còn lại" giữ nguyên số thứ tự gốc, không đánh lại từ 1', () => {
  const { groups } = buildSchedule([item({ timesPerDay: 2, days: 5 })], '2026-07-18', 'SANG');
  const left = remainingFrom(groups, '2026-07-21', '00:00');
  const ics = buildIcs(left, { calendarName: 'T', uidPrefix: 'rx1' });
  assert.ok(!ics.includes('UID:rx1-d1@vodich'), 'cữ đầu của phần còn lại không được mang số 1');
  assert.equal(left[0].index, 7, '2 cữ/ngày x 3 ngày đã qua -> cữ tiếp theo là số 7');
});

/**
 * Chốt chặn: RFC 5545 bắt buộc VEVENT nào cũng phải có UID, DTSTAMP và DTSTART.
 * Thiếu DTSTART thì iPhone im lặng từ chối CẢ file — bấm "Thêm tất cả" không ra gì,
 * không báo lỗi. Đúng lỗi đã xảy ra với các sự kiện huỷ.
 */
const assertEveryEventValid = (ics, label) => {
  const blocks = ics.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  assert.ok(blocks.length, `${label}: không có VEVENT nào`);
  blocks.forEach((block, i) => {
    ['UID:', 'DTSTAMP:', 'DTSTART:'].forEach((field) => {
      assert.ok(block.includes(field), `${label}: VEVENT #${i + 1} thiếu ${field}\n${block}`);
    });
  });
};

test('không dòng nào vượt 75 octet — dòng dài làm iPhone từ chối cả file', () => {
  // Tên thuốc tiếng Việt + emoji rất dễ đẩy SUMMARY/DESCRIPTION vượt giới hạn.
  const groups = buildSchedule(
    [
      item({ drugName: 'Ciprofloxacin (Vinhopro)', dosage: '1 gói', timing: 'SAU_AN', isAntibiotic: true, days: 2 }),
      item({ id: '2', drugName: 'Ambroxol 30mg/5ml (Justone)', dosage: '4ml', days: 2 }),
      item({ id: '3', drugName: 'Terbutaline 0.03%, Guaifenesin 1.33% (Olexon S)', dosage: '4ml', days: 2 }),
    ],
    '2026-07-18',
    'SANG',
  ).groups;
  const ics = buildIcs(groups, {
    calendarName: 'Thuốc của Khắc Minh',
    uidPrefix: 'rx1',
    prescriptionLabel: '18/07/2026',
    followUpDate: '2026-07-25',
  });

  ics.split('\r\n').forEach((line) => {
    assert.ok(
      Buffer.byteLength(line, 'utf8') <= 75,
      `dòng dài ${Buffer.byteLength(line, 'utf8')} octet: ${line.slice(0, 60)}...`,
    );
  });
});

test('gấp dòng không làm hỏng nội dung: gỡ gấp phải ra đúng chuỗi gốc', () => {
  const { foldLine } = require('../dist/medical/ics');
  const samples = [
    'SUMMARY:💊❗ Đơn 18/07/2026 (có kháng sinh) · Ciprofloxacin (Vinhopro) 1 gói · Ambroxol 30mg/5ml (Justone) 4ml',
    'DESCRIPTION:Uống Ciprofloxacin: 1 gói\\, sau ăn\\nUống Ambroxol 30mg/5ml (Justone): 4ml',
    'SUMMARY:ngắn',
    'X-WR-CALNAME:Thuốc của bé Nguyễn Khắc Minh nhà mình ở Dương Nội Hà Đông Hà Nội',
  ];
  samples.forEach((sample) => {
    const folded = foldLine(sample);
    // Gỡ gấp = bỏ mỗi cặp CRLF+space
    assert.equal(folded.replace(/\r\n /g, ''), sample, `hỏng nội dung khi gấp: ${sample.slice(0, 40)}`);
    folded.split('\r\n').forEach((line) => assert.ok(Buffer.byteLength(line, 'utf8') <= 75));
  });
});

test('gấp dòng không cắt đôi ký tự nhiều byte', () => {
  const { foldLine } = require('../dist/medical/ics');
  // Chuỗi toàn emoji 4 byte + chữ có dấu 3 byte, ép rơi đúng vào ranh giới
  const line = 'SUMMARY:' + '💊'.repeat(30) + 'ố'.repeat(30);
  const folded = foldLine(line);
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.ok(!folded.includes('�'), 'không được sinh ký tự hỏng');
});

test('mọi VEVENT đều có UID, DTSTAMP, DTSTART — kể cả sự kiện huỷ', () => {
  const groups = buildSchedule([item({ timesPerDay: 2, days: 2 })], '2026-07-18', 'SANG').groups;
  const older = buildSchedule([item({ timesPerDay: 2, days: 3 })], '2026-07-10', 'SANG').groups;

  assertEveryEventValid(buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1' }), 'bản thường');
  assertEveryEventValid(
    buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', previousDoseCount: 12 }),
    'bản có huỷ phần dôi',
  );
  assertEveryEventValid(
    buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', cancels: [{ uidPrefix: 'rx0', groups: older }] }),
    'bản có huỷ đơn cũ',
  );
  assertEveryEventValid(
    buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1', followUpDate: '2026-07-25' }),
    'bản có tái khám',
  );
});

test('không có gì để huỷ thì file .ics không chứa CANCELLED', () => {
  const { groups } = buildSchedule([item({ days: 1 })], '2026-07-18', 'SANG');
  const ics = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx1' });
  assert.ok(!ics.includes('STATUS:CANCELLED'));
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

test('UID ổn định theo đơn + số thứ tự cữ để import lại không nhân đôi sự kiện', () => {
  const { groups } = buildSchedule([item({ days: 1, timesPerDay: 1 })], '2026-07-18', 'SANG');
  const first = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx7' });
  const second = buildIcs(groups, { calendarName: 'T', uidPrefix: 'rx7' });
  const uidOf = (ics) => ics.match(/UID:(.+)/)[1].trim();
  assert.equal(uidOf(first), uidOf(second));
  assert.equal(uidOf(first), 'rx7-d1@vodich');
});
