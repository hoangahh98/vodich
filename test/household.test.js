const assert = require('node:assert/strict');
const test = require('node:test');

const { parseBankMessage, parseVndAmount, parseVnDateTime } = require('../dist/household/bank-parsers');
const { matchRecurring, monthReport, nextMonth, previousMonth, recurringExpectations, sourceBalances } = require('../dist/household/household-month');
const { normalizeDescription } = require('../dist/household/household-rows');
const { pickSource } = require('../dist/household/household-telegram.service');
const { monthOf, normalizeMonth } = require('../dist/household/household-enums');

// ─────────────────────────── Đọc tin ngân hàng (hai mail mẫu chủ app đưa 9/2026) ───────────────────────────

/** Hai mail Timo "Thông báo thay đổi số dư tài khoản" (chủ app chụp 9/9/2026), plain text từ Apps Script. */
const TIMO_IN = `NGUYEN KHAC HOANG ANH thân mến,

Tài khoản Spend Account vừa tăng 50.000 VND vào 09/09/2026 16:37. Số dư hiện tại: 50.000 VND.

Mô tả: NGUYEN KHAC HOANG ANH chuyen tien.

Cảm ơn Quý khách đã sử dụng dịch vụ Timo Digital Bank by BVBank!`;
const TIMO_OUT = `NGUYEN KHAC HOANG ANH thân mến,

Tài khoản Spend Account vừa giảm 30.000 VND vào 09/09/2026 16:39. Số dư hiện tại: 20.000 VND.

Mô tả: Nguyen Khac Hoang Anh chuyen tien tu Timo.

Cảm ơn Quý khách đã sử dụng dịch vụ Timo Digital Bank by BVBank!`;

const MSB_MAIL = `Ngân hàng Hàng hải Việt Nam - MSB xin trân trọng thông báo thông tin biến động số dư trên Thẻ tín dụng MSB của Quý khách như sau:
Vietnam Maritime Commercial Joint Stock Bank - MSB is pleased to inform that the transaction in your credit card as below:
Số Hợp đồng
Contract Number
011-M-000238374
Số thẻ tín dụng
Main Card Number
xxxx-xxxx-xxxx-3065
Số tiền thay đổi
Changed Amount
-86,093 VND
Nội dung giao dịch
Content
Shopee
Thời gian giao dịch
Transaction time
07/09/2026 18:22
Hạn mức khả dụng
Available Limit
16,927,825 VND`;

test('tiền VND: ngăn nghìn bằng phẩy, thập phân .00, dấu âm bỏ qua', () => {
  assert.equal(parseVndAmount('650,000.00'), 650000);
  assert.equal(parseVndAmount('-86,093'), 86093);
  assert.equal(parseVndAmount('16,927,825 VND'), 16927825);
  assert.equal(parseVndAmount('5.000.000'), 5000000);
  assert.equal(parseVndAmount(''), 0);
});

test('giờ Việt Nam dd/mm/yyyy hh:mm[:ss] → Date đúng múi +07', () => {
  const full = parseVnDateTime('06/09/2026 17:06:00');
  assert.equal(full.toISOString(), '2026-09-06T10:06:00.000Z');
  const short = parseVnDateTime('07/09/2026 18:22');
  assert.equal(short.toISOString(), '2026-09-07T11:22:00.000Z');
  assert.equal(parseVnDateTime('không phải ngày'), null);
});

test('mail Timo tiền vào: tăng = IN, số tiền chấm nghìn, giờ VN, số dư hiện tại, mô tả bỏ dấu chấm cuối', () => {
  const parsed = parseBankMessage(TIMO_IN);
  assert.ok(parsed, 'phải đọc được');
  assert.equal(parsed.bank, 'TIMO');
  assert.equal(parsed.direction, 'IN');
  assert.equal(parsed.amount, 50000);
  assert.equal(parsed.balance, 50000);
  assert.equal(parsed.accountKey, '');
  assert.equal(parsed.description, 'NGUYEN KHAC HOANG ANH chuyen tien');
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-09T09:37:00.000Z');
});

test('mail Timo tiền ra: giảm = OUT, mã chống trùng ổn định và khác nhau giữa hai tin', () => {
  const parsed = parseBankMessage(TIMO_OUT);
  assert.equal(parsed.direction, 'OUT');
  assert.equal(parsed.amount, 30000);
  assert.equal(parsed.balance, 20000);
  assert.equal(parsed.description, 'Nguyen Khac Hoang Anh chuyen tien tu Timo');
  assert.equal(parsed.externalId, parseBankMessage(TIMO_OUT).externalId);
  assert.notEqual(parsed.externalId, parseBankMessage(TIMO_IN).externalId);
});

test('mail MSB thẻ tín dụng: 4 số cuối thẻ, số tiền âm = quẹt thẻ, nội dung, thời gian', () => {
  const parsed = parseBankMessage(MSB_MAIL);
  assert.ok(parsed, 'phải đọc được');
  assert.equal(parsed.bank, 'MSB');
  assert.equal(parsed.direction, 'OUT');
  assert.equal(parsed.amount, 86093);
  assert.equal(parsed.accountKey, '3065');
  assert.equal(parsed.description, 'Shopee');
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-07T11:22:00.000Z');
  // Không có mã giao dịch → mã tự dựng, hai lần gửi cùng mail cho cùng một mã.
  assert.equal(parsed.externalId, parseBankMessage(MSB_MAIL).externalId);
});

test('mail MSB số tiền dương là tiền vào thẻ (hoàn / trả thẻ)', () => {
  const parsed = parseBankMessage(MSB_MAIL.replace('-86,093 VND', '+5,000,000 VND'));
  assert.equal(parsed.direction, 'IN');
  assert.equal(parsed.amount, 5000000);
});

test('ngân hàng khác: mẫu chung bắt số tiền có dấu kèm VND và 4 số cuối', () => {
  const parsed = parseBankMessage('Techcombank: TK ****1234 -250,000 VND luc 10/09/2026 09:15. ND: GRAB');
  assert.equal(parsed.bank, 'OTHER');
  assert.equal(parsed.direction, 'OUT');
  assert.equal(parsed.amount, 250000);
  assert.equal(parsed.accountKey, '1234');
  assert.equal(parseBankMessage('chào cả nhà'), null, 'tin thường không thành giao dịch');
});

// ─────────────────────────── Khớp nguồn ───────────────────────────

const SOURCES = [
  { id: 1n, name: 'Timo', kind: 'BANK', bank: 'TIMO', matchKey: '' },
  { id: 2n, name: 'Ngân hàng B', kind: 'BANK', bank: 'OTHER', matchKey: '0999' },
  { id: 3n, name: 'Thẻ MSB', kind: 'CARD', bank: 'MSB', matchKey: '3065' },
  { id: 4n, name: 'Tiền mặt', kind: 'CASH', bank: 'OTHER', matchKey: '' },
];

test('chọn nguồn: khớp đuôi số tài khoản / 4 số cuối; một nguồn duy nhất của ngân hàng thì lấy luôn; mù thì null', () => {
  assert.equal(pickSource(SOURCES, 'TIMO', '').id, 1n, 'Timo không có số tài khoản trong mail, một nguồn Timo là lấy luôn');
  assert.equal(pickSource(SOURCES, 'MSB', '3065').id, 3n);
  assert.equal(pickSource(SOURCES, 'MSB', '').id, 3n, 'MSB chỉ có một thẻ');
  assert.equal(pickSource(SOURCES, 'OTHER', '0999').id, 2n, 'ngân hàng khác khớp theo đuôi số tài khoản');
  assert.equal(pickSource(SOURCES, 'OTHER', '7777'), null, 'hai nguồn "Khác" mà không khớp số nào thì không đoán bừa');
  assert.equal(pickSource([...SOURCES, { id: 5n, name: 'Timo 2', kind: 'BANK', bank: 'TIMO', matchKey: '' }], 'TIMO', ''), null, 'hai Timo không khoá thì mù');
});

test('mô tả chuẩn hoá để đoán mục đích: bỏ dấu, số, ký tự lạ', () => {
  assert.equal(normalizeDescription('Thanh toán QRPay · VNPay 123'), 'thanh toan qrpay vnpay');
  assert.equal(normalizeDescription('GRAB*  Trip 88'), 'grab trip');
});

// ─────────────────────────── Số dư và báo cáo tháng ───────────────────────────

const bank = { id: 'b', name: 'Bank', kind: 'BANK', openingBalance: 10_000_000, creditLimit: 0, interestRate: 0, statementDay: 0, dueDay: 0, active: true };
const card = { id: 'c', name: 'Card', kind: 'CARD', openingBalance: 0, creditLimit: 20_000_000, interestRate: 0, statementDay: 20, dueDay: 5, active: true };
const loan = { id: 'l', name: 'Vay nhà', kind: 'LOAN', openingBalance: 100_000_000, creditLimit: 0, interestRate: 12, statementDay: 0, dueDay: 0, active: true };
const purposes = [
  { id: 'p-luong', name: 'Lương', kind: 'INCOME', monthlyPlan: 0, active: true },
  { id: 'p-an', name: 'Ăn uống', kind: 'LIVING', monthlyPlan: 5_000_000, active: true },
  { id: 'p-tk', name: 'Tiết kiệm', kind: 'SAVING', monthlyPlan: 0, active: true },
  { id: 'p-no', name: 'Trả nợ', kind: 'DEBT', monthlyPlan: 0, active: true },
];
const tx = (over) => ({ id: over.id || 'x', kind: 'EXPENSE', sourceId: 'b', targetSourceId: null, purposeId: null, recurringId: null, amount: 0, interest: 0, month: '2026-09', status: 'CONFIRMED', occurredAt: new Date('2026-09-10T03:00:00Z'), description: '', ...over });

const SEPTEMBER = [
  tx({ id: '1', kind: 'INCOME', purposeId: 'p-luong', amount: 30_000_000 }),
  tx({ id: '2', purposeId: 'p-an', amount: 2_000_000 }),
  tx({ id: '3', sourceId: 'c', purposeId: 'p-an', amount: 86_093 }), // quẹt thẻ
  tx({ id: '4', kind: 'TRANSFER', targetSourceId: 'c', amount: 86_093 }), // trả thẻ: KHÔNG phải chi
  tx({ id: '5', kind: 'TRANSFER', targetSourceId: 'l', purposeId: 'p-no', amount: 6_000_000, interest: 1_000_000 }), // trả nợ: gốc 5tr + lãi 1tr
  tx({ id: '6', purposeId: 'p-tk', amount: 3_000_000 }),
  tx({ id: '7', amount: 150_000 }), // chưa phân loại
];

test('số dư / dư nợ suy từ giao dịch: quẹt thẻ tăng nợ, trả thẻ giảm nợ, trả nợ chỉ trừ gốc', () => {
  const balances = sourceBalances([bank, card, loan], SEPTEMBER);
  // Bank: 10tr + 30tr − 2tr − 86,093 (trả thẻ) − 6tr − 3tr − 150k
  assert.equal(balances.get('b').balance, 10_000_000 + 30_000_000 - 2_000_000 - 86_093 - 6_000_000 - 3_000_000 - 150_000);
  assert.equal(balances.get('c').balance, 0, 'quẹt 86,093 rồi trả 86,093 → hết nợ thẻ');
  assert.equal(balances.get('c').available, 20_000_000);
  assert.equal(balances.get('l').balance, 95_000_000, 'trả 6tr trong đó lãi 1tr → gốc giảm 5tr');
});

test('báo cáo tháng: quẹt thẻ tính một lần lúc quẹt, trả thẻ không tính, trả nợ tách gốc/lãi, chưa phân loại vào chi tiêu', () => {
  const report = monthReport('2026-09', [bank, card, loan], purposes, SEPTEMBER);
  assert.equal(report.income, 30_000_000);
  assert.equal(report.living, 2_000_000 + 86_093 + 150_000);
  assert.equal(report.cardSpending, 86_093);
  assert.equal(report.cardPayment, 86_093);
  assert.equal(report.saving, 3_000_000);
  assert.deepEqual(report.debt, { total: 6_000_000, principal: 5_000_000, interest: 1_000_000 });
  assert.equal(report.used, report.living + 3_000_000 + 6_000_000);
  assert.equal(report.free, 30_000_000 - report.used);
  assert.deepEqual(report.unclassified, { count: 1, total: 150_000 });
  const eating = report.byPurpose.find((row) => row.purpose.id === 'p-an');
  assert.equal(eating.actual, 2_086_093);
  assert.equal(eating.plan, 5_000_000);
  // Giao dịch tháng khác không lọt vào.
  assert.equal(monthReport('2026-10', [bank, card, loan], purposes, SEPTEMBER).income, 0);
});

// ─────────────────────────── Khoản định kỳ ───────────────────────────

const recurringLoan = { id: 'r1', name: 'Trả góp nhà', kind: 'TRANSFER', sourceId: 'b', targetSourceId: 'l', purposeId: 'p-no', amount: 5_000_000, interestMode: 'FROM_RATE', dayOfMonth: 5, startMonth: '2026-01', endMonth: null, active: true };
const recurringSchool = { id: 'r2', name: 'Tiền học', kind: 'EXPENSE', sourceId: 'b', targetSourceId: null, purposeId: 'p-an', amount: 2_000_000, interestMode: 'NONE', dayOfMonth: 10, startMonth: '2026-09', endMonth: '2026-12', active: true };
const recurringOld = { ...recurringSchool, id: 'r3', name: 'Đã hết hạn', endMonth: '2026-08' };

test('định kỳ: lãi FROM_RATE = dư nợ đầu tháng × lãi suất / 12, tháng sau dư nợ giảm là lãi tự giảm', () => {
  const start = sourceBalances([bank, card, loan], []);
  const [item] = recurringExpectations('2026-09', [recurringLoan], start, [], new Date('2026-09-01T00:00:00Z'));
  assert.equal(item.interest, 1_000_000, '100tr × 12% / 12');
  assert.equal(item.expected, 6_000_000);
  assert.equal(item.paid, false);
  assert.equal(item.overdue, false);
  assert.equal(item.dueDate.toISOString().slice(0, 10), '2026-09-05');

  const afterOnePayment = sourceBalances([bank, card, loan], SEPTEMBER);
  const [october] = recurringExpectations('2026-10', [recurringLoan], afterOnePayment, [], new Date('2026-10-01T00:00:00Z'));
  assert.equal(october.interest, 950_000, '95tr × 12% / 12');
});

test('định kỳ: chỉ hiện khoản còn hiệu lực trong tháng; đã ghi thì paid; quá hạn khi hôm nay đã qua hạn', () => {
  const start = sourceBalances([bank, card, loan], []);
  const paidTx = tx({ id: '9', recurringId: 'r2', amount: 2_000_000, purposeId: 'p-an' });
  const items = recurringExpectations('2026-09', [recurringLoan, recurringSchool, recurringOld], start, [paidTx], new Date('2026-09-20T00:00:00Z'));
  assert.deepEqual(items.map((item) => item.recurring.id), ['r1', 'r2'], 'khoản hết hạn tháng 8 không hiện');
  assert.equal(items[0].paid, false);
  assert.equal(items[0].overdue, true, 'hạn ngày 5, hôm nay 20');
  assert.equal(items[1].paid, true);
  assert.equal(items[1].transaction.id, '9');
  assert.equal(recurringExpectations('2026-08', [recurringSchool], start, []).length, 0, 'chưa tới tháng bắt đầu');
});

test('khớp giao dịch với khoản định kỳ: cùng nguồn, lệch ≤ 2%, chọn khoản gần số nhất, đã trả thì thôi', () => {
  const start = sourceBalances([bank, card, loan], []);
  const items = recurringExpectations('2026-09', [recurringLoan, recurringSchool], start, [], new Date('2026-09-01T00:00:00Z'));
  assert.equal(matchRecurring(items, { kind: 'EXPENSE', sourceId: 'b', amount: 6_050_000, targetSourceId: null }).recurring.id, 'r1', 'ngân hàng làm tròn lãi vẫn khớp');
  assert.equal(matchRecurring(items, { kind: 'EXPENSE', sourceId: 'b', amount: 2_000_000, targetSourceId: null }).recurring.id, 'r2');
  assert.equal(matchRecurring(items, { kind: 'EXPENSE', sourceId: 'c', amount: 2_000_000, targetSourceId: null }), null, 'khác nguồn');
  assert.equal(matchRecurring(items, { kind: 'EXPENSE', sourceId: 'b', amount: 3_000_000, targetSourceId: null }), null, 'lệch quá');
  assert.equal(matchRecurring(items, { kind: 'INCOME', sourceId: 'b', amount: 2_000_000, targetSourceId: null }), null, 'tiền vào không khớp khoản chi');
  const paid = items.map((item) => ({ ...item, paid: true }));
  assert.equal(matchRecurring(paid, { kind: 'EXPENSE', sourceId: 'b', amount: 2_000_000, targetSourceId: null }), null, 'đã trả rồi thì không khớp thêm');
});

test('tháng: chuẩn hoá, tháng theo giờ VN, tháng trước / sau', () => {
  assert.equal(normalizeMonth('2026-09'), '2026-09');
  assert.equal(normalizeMonth('rác'), new Date().toISOString().slice(0, 7));
  assert.equal(monthOf(new Date('2026-09-30T18:00:00Z')), '2026-10', '1 giờ sáng 1/10 giờ VN');
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(nextMonth('2026-12'), '2027-01');
});

// ─────────────────────────── Khoá chống trùng cho tin gửi từ Apps Script ───────────────────────────

const { textHash } = require('../dist/household/household-telegram.service');

test('hash nội dung tin: ổn định, khác nội dung khác hash, vừa BigInt 52-bit', () => {
  const a = textHash(MSB_MAIL);
  assert.equal(a, textHash(MSB_MAIL));
  assert.notEqual(a, textHash(MSB_MAIL.replace('-86,093', '-86,094')));
  assert.equal(typeof a, 'bigint');
  assert.ok(a >= 0n && a < 2n ** 52n);
});

test('mail MSB thật từ Apps Script (dòng trống kép, dấu * markdown): hoàn tiền +172,691 đọc là tiền VÀO thẻ 3065', () => {
  const real = `Khóa thẻ tạm thời \n\n\n\nKính chào quý khách,\n\n\n\nDear Customer,\n\n\n\nNgân hàng Hàng hải Việt Nam - MSB xin trân trọng *thông báo thông tin biến \nđộng số dư* trên *Thẻ tín dụng MSB* của Quý khách như sau:\n\n\n\nSố Hợp đồng\n\n\n\nContract Number\n\n\n\n011-M-000238374\n\n\n\nSố thẻ tín dụng\n\n\n\nMain Card Number\n\n\n\nxxxx-xxxx-xxxx-3065\n\n\n\nSố tiền thay đổi\n\n\n\nChanged Amount\n\n\n\n+172,691 VND\n\n\n\nNội dung giao dịch\n\n\n\nContent\n\n\n\nShopee\n\n\n\nThời gian giao dịch\n\n\n\nTransaction time \n\n\n\n08/09/2026 09:08\n\n\n\nHạn mức khả dụng\n\n\n\nAvailable Limit\n\n\n\n16,927,825 VND\n\n<https://www.msb.com.vn/joy/home> \n`;
  const parsed = parseBankMessage(real);
  assert.ok(parsed);
  assert.equal(parsed.bank, 'MSB');
  assert.equal(parsed.direction, 'IN');
  assert.equal(parsed.amount, 172691);
  assert.equal(parsed.accountKey, '3065');
  assert.equal(parsed.description, 'Shopee');
  assert.equal(parsed.occurredAt.toISOString(), '2026-09-08T02:08:00.000Z');
});

test('hoàn tiền: tiền vào gắn mục đích chi (hoặc vào thẻ chưa gắn gì) trừ bớt mục đó, không thành thu nhập', () => {
  const refunds = [
    ...SEPTEMBER,
    tx({ id: 'r1', kind: 'INCOME', sourceId: 'c', purposeId: 'p-an', amount: 172_691 }), // Shopee hoàn vào thẻ, gắn Ăn uống
    tx({ id: 'r2', kind: 'INCOME', sourceId: 'c', purposeId: null, amount: 10_000 }), // hoàn vào thẻ chưa gắn gì
  ];
  const base = monthReport('2026-09', [bank, card, loan], purposes, SEPTEMBER);
  const report = monthReport('2026-09', [bank, card, loan], purposes, refunds);
  assert.equal(report.income, base.income, 'hoàn tiền không phải lương');
  assert.equal(report.living, base.living - 172_691 - 10_000);
  assert.equal(report.cardSpending, base.cardSpending - 172_691 - 10_000);
  assert.equal(report.byPurpose.find((row) => row.purpose.id === 'p-an').actual, 2_086_093 - 172_691);
  // Dư nợ thẻ giảm đúng số hoàn.
  assert.equal(sourceBalances([bank, card, loan], refunds).get('c').balance, -172_691 - 10_000);
});
