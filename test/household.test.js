const assert = require('node:assert/strict');
const test = require('node:test');

const { parseBankMessage, parseVndAmount, parseVnDateTime } = require('../dist/household/bank-parsers');
const { collectBankMarks, matchRecurring, monthReport, nextMonth, previousMonth, reconcileSources, recurringExpectations, sourceBalances } = require('../dist/household/household-month');
const { normalizeDescription } = require('../dist/household/household-rows');
const { isTelegramMessageId, pickSource, textHash } = require('../dist/household/household-telegram.service');
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

test('mã chống trùng kèm số dư / hạn mức: hai giao dịch giống hệt trong cùng một phút không bị gộp', () => {
  // Mail MSB chỉ ghi giờ tới PHÚT. Hai lần trả thẻ 1.000đ trong cùng một phút chỉ khác nhau ở hạn mức khả
  // dụng sau giao dịch — thiếu nó trong mã chống trùng là khoản thứ hai bị bỏ (chủ app phát hiện 10/9/2026).
  const lan1 = parseBankMessage(MSB_PAYMENT);
  const lan2 = parseBankMessage(MSB_PAYMENT.replace('19,913,907 VND', '19,914,907 VND'));
  assert.notEqual(lan1.externalId, lan2.externalId);
  assert.match(lan1.externalId, /:19913907$/);
  // Mail Timo cũng vậy: cùng số tiền, cùng phút, cùng mô tả nhưng số dư khác nhau.
  const timo1 = parseBankMessage(TIMO_IN);
  const timo2 = parseBankMessage(TIMO_IN.replace('Số dư hiện tại: 50.000 VND', 'Số dư hiện tại: 100.000 VND'));
  assert.notEqual(timo1.externalId, timo2.externalId);
});

test('mail MSB kèm hạn mức khả dụng — mail KHÔNG có hạn mức tổng nên app không suy ra dư nợ từ đây', () => {
  assert.equal(parseBankMessage(MSB_MAIL).availableLimit, 16_927_825);
  assert.equal(parseBankMessage(TIMO_IN).availableLimit, undefined, 'mail tài khoản không có hạn mức');
});

// Apps Script gửi kèm TIÊU ĐỀ mail: MSB có hai tiêu đề thẻ, và mail thanh toán có thể không mang dấu +/−.
const MSB_PAYMENT = `Biến động thanh toán thẻ tín dụng
Ngân hàng Hàng hải Việt Nam - MSB xin trân trọng thông báo thông tin biến động số dư trên Thẻ tín dụng MSB của Quý khách như sau:
Số thẻ tín dụng
Main Card Number
xxxx-xxxx-xxxx-3065
Số tiền thay đổi
Changed Amount
5,000,000 VND
Nội dung giao dịch
Content
THANH TOAN THE
Thời gian giao dịch
Transaction time
09/09/2026 10:00
Hạn mức khả dụng
Available Limit
19,913,907 VND`;

test('mail thẻ MSB đọc theo TIÊU ĐỀ: "Biến động thanh toán" là tiền vào kể cả khi số tiền không mang dấu', () => {
  const payment = parseBankMessage(MSB_PAYMENT);
  assert.equal(payment.cardEvent, 'PAYMENT');
  assert.equal(payment.direction, 'IN', 'không có dấu +/− thì phải theo tiêu đề, không được đoán thành khoản chi');
  assert.equal(payment.amount, 5_000_000);
  assert.equal(payment.accountKey, '3065');
  assert.equal(payment.availableLimit, 19_913_907);
  // Tiêu đề "Biến động chi tiêu" là quẹt tiêu.
  const spend = parseBankMessage(`Biến động chi tiêu thẻ tín dụng
${MSB_MAIL}`);
  assert.equal(spend.cardEvent, 'SPEND');
  assert.equal(spend.direction, 'OUT');
});

test('tiền vào thẻ tín dụng trừ vào phần "đã quẹt chưa trả"', () => {
  const rows = [
    tx({ id: '61', sourceId: 'c', amount: 100_000 }),
    tx({ id: '62', kind: 'INCOME', sourceId: 'c', amount: 30_000 }),
  ];
  assert.equal(sourceBalances([card], rows).get('c').balance, 70_000);
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
  assert.equal(pickSource(SOURCES, 'OTHER', '').id, 2n, 'tiền mặt không nhận tin ngân hàng, nguồn "Khác" duy nhất là ngân hàng B');
  const twoOthers = [...SOURCES, { id: 8n, name: 'Ngân hàng C', kind: 'BANK', bank: 'OTHER', matchKey: '1111' }];
  assert.equal(pickSource(twoOthers, 'OTHER', '7777'), null, 'hai nguồn "Khác" mà không khớp số nào thì không đoán bừa');
  assert.equal(pickSource([...SOURCES, { id: 5n, name: 'Timo 2', kind: 'BANK', bank: 'TIMO', matchKey: '' }], 'TIMO', ''), null, 'hai Timo không khoá thì mù');
  // Nguồn cho vay / tiền mặt / khoản vay lỡ mang bank = TIMO (ô ẩn vẫn gửi) không được làm bot mù.
  assert.equal(pickSource([...SOURCES, { id: 6n, name: 'Anh A', kind: 'LENT', bank: 'TIMO', matchKey: '' }, { id: 7n, name: 'Vay nhà', kind: 'LOAN', bank: 'TIMO', matchKey: '' }], 'TIMO', '').id, 1n);
});

test('phân biệt id tin Telegram thật với hash nội dung mail (giao dịch chưa đăng được lên nhóm)', () => {
  assert.equal(isTelegramMessageId(1234n), true, 'id tin thật của Telegram là số nhỏ');
  assert.equal(isTelegramMessageId(null), false, 'ghi tay, không đi qua Telegram');
  assert.equal(isTelegramMessageId(textHash('mail ngân hàng nào đó')), false, 'hash 52-bit = chưa đăng được');
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

// ─────────────────────────── Nguồn Tiết kiệm / Đầu tư ───────────────────────────

const savingSource = { id: 'tk', name: 'Sổ tiết kiệm', kind: 'SAVING', openingBalance: 20_000_000, creditLimit: 0, interestRate: 0, statementDay: 0, dueDay: 0, active: true };
const investSource = { id: 'dt', name: 'Chứng khoán', kind: 'INVEST', openingBalance: 5_000_000, creditLimit: 0, interestRate: 0, statementDay: 0, dueDay: 0, active: true };

test('nguồn Tiết kiệm / Đầu tư: giữ số dư như tài khoản, chuyển sang là cất đi, rút về thì trừ lại', () => {
  const moves = [
    tx({ id: 's1', kind: 'TRANSFER', targetSourceId: 'tk', amount: 4_000_000 }), // cất vào sổ tiết kiệm
    tx({ id: 's2', kind: 'TRANSFER', targetSourceId: 'dt', amount: 1_000_000 }), // mua chứng khoán
    tx({ id: 's3', kind: 'TRANSFER', sourceId: 'dt', targetSourceId: 'b', amount: 500_000 }), // bán, tiền về tài khoản
  ];
  const sources = [bank, savingSource, investSource];
  const balances = sourceBalances(sources, moves);
  assert.equal(balances.get('tk').balance, 24_000_000, 'tiết kiệm cộng thêm như tài khoản, không phải dư nợ');
  assert.equal(balances.get('dt').balance, 5_500_000);
  assert.equal(balances.get('b').balance, 10_000_000 - 4_000_000 - 1_000_000 + 500_000);
  const report = monthReport('2026-09', sources, purposes, moves);
  assert.equal(report.saving, 4_000_000 + 1_000_000 - 500_000, 'cất đi tính vào tiết kiệm kể cả khi không gắn mục đích, rút về thì trừ');
  assert.equal(report.living, 0, 'chuyển sang nguồn để dành không phải chi tiêu');
});

// ─────────────────────────── Đối chiếu với số ngân hàng báo ───────────────────────────

test('số ngân hàng báo về đúng nguồn: số dư về tài khoản, hạn mức khả dụng về thẻ', () => {
  // Khoản TRẢ THẺ là chuyển Timo → thẻ, mang cả hai số: mail Timo báo số dư, mail thẻ báo hạn mức khả
  // dụng vừa nhả ra. Chọn chung một "phía mail" cho cả dòng thì hạn mức của thẻ bị gán sang Timo và ô
  // "Ngân hàng báo còn" của thẻ đứng im ở mail quẹt cũ (chủ app 11/9/2026: luôn lấy mail gần nhất).
  const kindOf = (id) => ({ timo: 'BANK', the: 'CARD' })[id] || '';
  const rows = [
    // Mới → cũ: trả thẻ hôm 10/9 (mang cả hai số), quẹt thẻ hôm 8/9 (chỉ có hạn mức).
    { id: '9', sourceId: 'timo', targetSourceId: 'the', reportedBalance: 5_000_000, reportedAvailable: 9_000_000, occurredAt: new Date('2026-09-10T03:00:00Z') },
    { id: '8', sourceId: 'the', targetSourceId: null, reportedBalance: null, reportedAvailable: 8_000_000, occurredAt: new Date('2026-09-08T03:00:00Z') },
  ];
  const { balanceMarks, availableWindows } = collectBankMarks(rows, kindOf);
  assert.equal(balanceMarks.get('timo')?.value, 5_000_000, 'số dư trong mail Timo là của Timo');
  assert.equal(balanceMarks.has('the'), false, 'thẻ không có số dư');
  assert.equal(availableWindows.get('the')?.last.value, 9_000_000, 'hạn mức khả dụng lấy theo mail gần nhất của thẻ');
  assert.equal(availableWindows.get('the')?.first.value, 8_000_000, 'mail cũ nhất của thẻ là mốc đầu');
  assert.equal(availableWindows.has('timo'), false, 'hạn mức khả dụng không bao giờ là của tài khoản');
});

test('tài khoản: mail báo số dư thì ngân hàng thắng, sổ lệch bao nhiêu thì báo bấy nhiêu (không tự bù)', () => {
  const at = new Date('2026-09-05T03:00:00Z');
  const rows = [
    tx({ id: '1', kind: 'INCOME', purposeId: 'p-luong', amount: 30_000_000, occurredAt: at }),
    tx({ id: '2', purposeId: 'p-an', amount: 2_000_000, occurredAt: new Date('2026-09-08T03:00:00Z') }),
  ];
  // Mail lúc nhận lương báo còn 39tr, sổ tính ra 40tr → sổ đang thừa 1tr (có khoản chi chưa ghi).
  const marks = new Map([['b', { value: 39_000_000, at, txId: '1' }]]);
  const [item] = reconcileSources([bank], rows, marks, new Map());
  assert.equal(item.balance, 39_000_000 - 2_000_000, 'số dư = số trong mail + giao dịch ghi sau mail');
  assert.equal(item.diff, 1_000_000, 'lệch = sổ − ngân hàng, dương là sổ thiếu khoản chi');
  assert.equal(item.anchored, true);
  // Không có mail nào thì cứ cộng từ sổ và không báo lệch.
  const [plain] = reconcileSources([bank], rows, new Map(), new Map());
  assert.equal(plain.balance, 10_000_000 + 30_000_000 - 2_000_000);
  assert.deepEqual([plain.diff, plain.anchored, plain.reported], [0, false, null]);
});

test('hạn mức còn của thẻ: hạn mức khai trừ khoản quẹt, cộng lại khoản hoàn tiền / trả thẻ', () => {
  // Luật chủ app 11/9/2026 (thay luật "không khai hạn mức" ngày 10/9): số này sổ tính được ngay, khỏi chờ mail.
  const rows = [
    tx({ id: '61', sourceId: 'c', purposeId: 'p-an', amount: 3_000_000 }), // quẹt
    tx({ id: '62', kind: 'INCOME', sourceId: 'c', amount: 500_000 }), // hoàn tiền vào thẻ
    tx({ id: '63', kind: 'TRANSFER', sourceId: 'b', targetSourceId: 'c', amount: 1_000_000 }), // trả thẻ
  ];
  const item = sourceBalances([bank, card], rows).get('c');
  assert.equal(item.balance, 1_500_000, 'đã quẹt chưa trả = 3tr − 500k hoàn − 1tr trả');
  assert.equal(item.limitUsed, 1_500_000);
  assert.equal(item.available, 20_000_000 - 1_500_000, 'hạn mức còn = hạn mức khai − phần đã quẹt chưa trả');
  // Chưa khai hạn mức thì không có hạn mức còn (app quay về lấy số ngân hàng báo trong mail).
  assert.equal(sourceBalances([bank, { ...card, creditLimit: 0 }], rows).get('c').available, 0);
  // Quẹt quá hạn mức khai: kẹp hạn mức còn về 0, phần vượt xem ở `limitUsed`.
  const vuot = sourceBalances([bank, { ...card, creditLimit: 1_000_000 }], rows).get('c');
  assert.deepEqual([vuot.available, vuot.limitUsed], [0, 1_500_000]);
});

test('hạn mức còn với thẻ thông: thẻ ăn theo bị trừ cả phần quẹt của thẻ trỏ về nó', () => {
  // Quan hệ CÓ HƯỚNG như luật 10/9/2026: 'ph' trỏ về 'ch' nên quẹt 'ph' ngốn hạn mức 'ch', chiều lại thì không.
  const antheo = { ...card, id: 'ch', name: 'Thẻ ăn theo', limitSharesWith: null, creditLimit: 20_000_000 };
  const rieng = { ...card, id: 'ph', name: 'Thẻ hạn mức riêng', limitSharesWith: 'ch', creditLimit: 5_000_000 };
  const rows = [
    tx({ id: '71', sourceId: 'ch', amount: 200_000 }),
    tx({ id: '72', sourceId: 'ph', amount: 100_000 }),
  ];
  const balances = sourceBalances([antheo, rieng], rows);
  assert.equal(balances.get('ph').available, 5_000_000 - 100_000, 'thẻ trỏ đi chỉ trừ phần quẹt của chính nó');
  assert.equal(balances.get('ch').limitUsed, 300_000);
  assert.equal(balances.get('ch').available, 20_000_000 - 300_000, 'thẻ ăn theo trừ cả hai thẻ');
  // Thẻ "trả quá" (sổ thiếu khoản quẹt) không được nới hạn mức cho thẻ ăn theo: kẹp từng thẻ về 0.
  const traqua = sourceBalances([antheo, rieng], [...rows, tx({ id: '73', kind: 'TRANSFER', sourceId: 'b', targetSourceId: 'ph', amount: 900_000 })]);
  assert.equal(traqua.get('ch').limitUsed, 200_000);
  assert.equal(traqua.get('ch').available, 20_000_000 - 200_000);
});

test('thẻ đã khai hạn mức: so hạn mức còn của sổ với hạn mức khả dụng mail gần nhất', () => {
  const rows = [
    tx({ id: '81', sourceId: 'c', amount: 200_000, occurredAt: new Date('2026-09-06T03:00:00Z') }),
    tx({ id: '82', sourceId: 'c', amount: 86_093, occurredAt: new Date('2026-09-07T11:22:00Z') }),
  ];
  const mark = (value, at, txId) => ({ value, at, txId });
  const khop = new Map([['c', { first: mark(19_800_000, rows[0].occurredAt, '81'), last: mark(20_000_000 - 286_093, rows[1].occurredAt, '82') }]]);
  const [ok] = reconcileSources([card], rows, new Map(), khop);
  assert.equal(ok.available, 20_000_000 - 286_093, 'hạn mức còn lấy theo sổ, không lấy theo mail');
  assert.equal(ok.diff, 0);
  // Ngân hàng báo còn ít hơn sổ 100k → sổ thiếu khoản quẹt (hoặc hạn mức khai to quá).
  const lech = new Map([['c', { first: khop.get('c').first, last: mark(20_000_000 - 286_093 - 100_000, rows[1].occurredAt, '82') }]]);
  assert.equal(reconcileSources([card], rows, new Map(), lech)[0].diff, 100_000);
  // So tại đúng thời điểm mail gần nhất: giao dịch ghi SAU mail không bị tính là lệch.
  const sauMail = [...rows, tx({ id: '83', sourceId: 'c', amount: 50_000, occurredAt: new Date('2026-09-08T03:00:00Z') })];
  const [vanKhop] = reconcileSources([card], sauMail, new Map(), khop);
  assert.equal(vanKhop.diff, 0);
  assert.equal(vanKhop.available, 20_000_000 - 336_093);
});

test('thẻ chưa khai hạn mức: dư nợ vẫn cộng từ giao dịch, hạn mức khả dụng chỉ để bắt lệch giữa hai mail', () => {
  const first = { value: 17_000_000, at: new Date('2026-09-06T03:00:00Z'), txId: '41' };
  const rows = [
    tx({ id: '41', sourceId: 'c', purposeId: 'p-an', amount: 200_000, occurredAt: first.at }),
    tx({ id: '42', sourceId: 'c', purposeId: 'p-an', amount: 86_093, occurredAt: new Date('2026-09-07T11:22:00Z') }),
  ];
  const khop = new Map([['c', { first, last: { value: 17_000_000 - 86_093, at: rows[1].occurredAt, txId: '42' } }]]);
  const chuaKhai = { ...card, creditLimit: 0 };
  const [ok] = reconcileSources([chuaKhai], rows, new Map(), khop);
  assert.equal(ok.balance, 286_093, 'dư nợ cộng từ giao dịch, không suy từ hạn mức');
  assert.equal(ok.reportedAvailable.value, 16_913_907, 'thẻ hiện đúng hạn mức khả dụng mail gần nhất');
  assert.equal(ok.diff, 0, 'khả dụng giảm đúng bằng phần quẹt đã ghi → không lệch');
  // Mail sau báo khả dụng thấp hơn 100k so với sổ → có khoản quẹt chưa ghi.
  const lech = new Map([['c', { first, last: { value: 17_000_000 - 86_093 - 100_000, at: rows[1].occurredAt, txId: '42' } }]]);
  assert.equal(reconcileSources([chuaKhai], rows, new Map(), lech)[0].diff, 100_000);
});

test('thẻ thông: quẹt thẻ A thì mail thẻ B báo hạn mức đã trừ cả hai — cùng nhóm thì không báo lệch', () => {
  // Hai thẻ chưa khai hạn mức (nhánh so CHÊNH giữa hai mail): hạn mức mỗi thẻ một khác vẫn đúng.
  const cardA = { ...card, id: 'ca', name: 'Thẻ A', limitSharesWith: 'cb', creditLimit: 0 };
  const cardB = { ...card, id: 'cb', name: 'Thẻ B', limitSharesWith: 'ca', creditLimit: 0 };
  const rows = [
    tx({ id: '51', sourceId: 'ca', amount: 1_000, occurredAt: new Date('2026-09-06T03:00:00Z') }),
    tx({ id: '52', sourceId: 'cb', amount: 5_000, occurredAt: new Date('2026-09-07T03:00:00Z') }),
    tx({ id: '53', sourceId: 'ca', amount: 2_000, occurredAt: new Date('2026-09-08T03:00:00Z') }),
  ];
  // Mail của thẻ A: lần đầu còn 19.999.000, lần sau còn 19.992.000 (đã trừ cả 5.000 quẹt ở thẻ B).
  const windows = new Map([
    ['ca', { first: { value: 19_999_000, at: rows[0].occurredAt, txId: '51' }, last: { value: 19_992_000, at: rows[2].occurredAt, txId: '53' } }],
  ]);
  const [checkedA] = reconcileSources([cardA, cardB], rows, new Map(), windows);
  assert.equal(checkedA.diff, 0, 'cùng nhóm thẻ thông thì cộng tiền quẹt của cả nhóm → khớp');
  // Khai thiếu nhóm là đúng cảnh chủ app sợ: lệch đúng bằng khoản quẹt ở thẻ kia.
  const rieng = reconcileSources([{ ...cardA, limitSharesWith: null }, { ...cardB, limitSharesWith: null }], rows, new Map(), windows);
  assert.equal(rieng[0].diff, 5_000);
});

test('thẻ thông có hướng: thẻ trỏ đi tính riêng nó, thẻ được trỏ tới ăn theo cả hai', () => {
  // Luật chủ app chốt 10/9/2026: thẻ 4768 và 8867 mỗi thẻ hạn mức RIÊNG, trả vào thẻ nào chỉ thẻ đó tăng,
  // nhưng cả hai đều khai thẻ thông = 3065 nên 3065 ăn theo cả hai; 3065 không khai gì. Ba thẻ hạn mức
  // khác nhau vẫn đúng vì chỉ so CHÊNH giữa hai lần báo của cùng một thẻ.
  const antheo = { ...card, id: 'ch', name: 'Thẻ ăn theo', limitSharesWith: null, creditLimit: 0 };
  const rieng = { ...card, id: 'ph', name: 'Thẻ hạn mức riêng', limitSharesWith: 'ch', creditLimit: 0 };
  const rows = [
    tx({ id: '101', sourceId: 'ph', amount: 100_000, occurredAt: new Date('2026-09-01T03:00:00Z') }),
    tx({ id: '102', sourceId: 'ch', amount: 200_000, occurredAt: new Date('2026-09-02T03:00:00Z') }),
    tx({ id: '103', kind: 'INCOME', sourceId: 'ph', amount: 30_000, occurredAt: new Date('2026-09-03T03:00:00Z') }),
    tx({ id: '104', kind: 'INCOME', sourceId: 'ch', amount: 50_000, occurredAt: new Date('2026-09-04T03:00:00Z') }),
  ];
  const windows = new Map([
    // Thẻ hạn mức riêng: 5.000.000 rồi trả 30.000 vào chính nó → 5.030.000. Khoản quẹt 200.000 của thẻ kia
    // ở giữa KHÔNG đụng tới hạn mức thẻ này. Hạn mức nhỏ hơn hẳn thẻ ăn theo cũng không sao.
    ['ph', { first: { value: 5_000_000, at: rows[0].occurredAt, txId: '101' }, last: { value: 5_030_000, at: rows[2].occurredAt, txId: '103' } }],
    // Thẻ ăn theo: 20.000.000 rồi cộng CẢ hai khoản trả (30.000 vào thẻ kia + 50.000 vào chính nó).
    ['ch', { first: { value: 20_000_000, at: rows[1].occurredAt, txId: '102' }, last: { value: 20_080_000, at: rows[3].occurredAt, txId: '104' } }],
  ]);
  const checked = reconcileSources([antheo, rieng], rows, new Map(), windows);
  assert.equal(checked.find((item) => item.source.id === 'ph').diff, 0, 'thẻ trỏ đi chỉ so với giao dịch của chính nó');
  assert.equal(checked.find((item) => item.source.id === 'ch').diff, 0, 'thẻ được trỏ tới so với giao dịch cả hai thẻ');
  // Quên khai thẻ thông là thẻ ăn theo báo lệch đúng phần thẻ kia trả (30.000đ, dấu âm = sổ thiếu tiền vào).
  const quenKhai = reconcileSources([antheo, { ...rieng, limitSharesWith: null }], rows, new Map(), windows);
  assert.equal(quenKhai.find((item) => item.source.id === 'ch').diff, -30_000);
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

// ─────────────────────────── Trả nợ: gốc / lãi ───────────────────────────

const { interestFromForm } = require('../dist/household/household-ledger.service');

test('trả nợ vay: chọn Trả lãi thì cả khoản là lãi (không trừ dư nợ), Trả gốc thì lãi 0, Gốc + lãi thì lấy số nhập', () => {
  assert.equal(interestFromForm({ debtPart: 'INTEREST' }, 3_000_000), 3_000_000);
  assert.equal(interestFromForm({ debtPart: 'PRINCIPAL', interest: '999' }, 3_000_000), 0);
  assert.equal(interestFromForm({ debtPart: 'MIXED', interest: '1,000,000' }, 3_000_000), 1_000_000);
  assert.equal(interestFromForm({ debtPart: 'MIXED', interest: '9,000,000' }, 3_000_000), 3_000_000, 'lãi không vượt tổng');
  // Và dư nợ phản ứng đúng: trả lãi 3tr → dư nợ giữ nguyên; trả gốc 3tr → giảm 3tr.
  const onlyInterest = tx({ id: 'i', kind: 'TRANSFER', targetSourceId: 'l', amount: 3_000_000, interest: 3_000_000 });
  const onlyPrincipal = tx({ id: 'p', kind: 'TRANSFER', targetSourceId: 'l', amount: 3_000_000, interest: 0 });
  assert.equal(sourceBalances([bank, loan], [onlyInterest]).get('l').balance, 100_000_000);
  assert.equal(sourceBalances([bank, loan], [onlyPrincipal]).get('l').balance, 97_000_000);
  assert.equal(sourceBalances([bank, loan], [onlyInterest]).get('b').balance, 7_000_000, 'tiền vẫn ra khỏi tài khoản');
  const report = monthReport('2026-09', [bank, loan], purposes, [onlyInterest, onlyPrincipal]);
  assert.deepEqual(report.debt, { total: 6_000_000, principal: 3_000_000, interest: 3_000_000 });
});

// ─────────────────────────── Cho vay (nguồn loại LENT) ───────────────────────────

test('cho vay: chuyển sang khoản LENT là cho vay (họ nợ tăng), họ trả về là giảm, không phải thu nhập', () => {
  const lent = { id: 'x', name: 'Anh A', kind: 'LENT', openingBalance: 0, creditLimit: 0, interestRate: 0, statementDay: 0, dueDay: 0, active: true };
  const give = tx({ id: 'g', kind: 'TRANSFER', targetSourceId: 'x', amount: 5_000_000 });
  const back = tx({ id: 'r', kind: 'TRANSFER', sourceId: 'x', targetSourceId: 'b', amount: 2_000_000 });
  const balances = sourceBalances([bank, lent], [give, back]);
  assert.equal(balances.get('x').balance, 3_000_000, 'họ còn nợ 3tr');
  assert.equal(balances.get('b').balance, 10_000_000 - 5_000_000 + 2_000_000);
  const report = monthReport('2026-09', [bank, lent], purposes, [give, back]);
  assert.equal(report.lending, 3_000_000, 'cho vay tháng này = 5tr − 2tr trả lại');
  assert.equal(report.income, 0, 'tiền họ trả không phải lương');
});

const { lendingLedger } = require('../dist/household/household-month');

test('sổ cho vay theo mục đích: gom theo nội dung (bỏ dấu, chữ thường), chi = cho vay, thu = trả', () => {
  const lending = { id: 'p-cv', name: 'Cho vay', kind: 'LENDING', monthlyPlan: 0, active: true };
  const rows = [
    tx({ id: '1', purposeId: 'p-cv', amount: 5_000_000, description: 'Anh A' }),
    tx({ id: '2', purposeId: 'p-cv', amount: 1_000_000, description: 'anh a' }),
    tx({ id: '3', kind: 'INCOME', purposeId: 'p-cv', amount: 2_000_000, description: 'ANH A' }),
    tx({ id: '4', purposeId: 'p-cv', amount: 500_000, description: 'Chị B' }),
    tx({ id: '5', purposeId: 'p-an', amount: 99, description: 'Anh A' }), // không phải cho vay
  ];
  const ledger = lendingLedger([...purposes, lending], rows);
  assert.equal(ledger.rows.length, 2);
  assert.deepEqual(ledger.rows[0], { name: 'Anh A', lent: 6_000_000, repaid: 2_000_000, outstanding: 4_000_000 });
  assert.deepEqual(ledger.rows[1], { name: 'Chị B', lent: 500_000, repaid: 0, outstanding: 500_000 });
  assert.equal(ledger.outstanding, 4_500_000);
});
