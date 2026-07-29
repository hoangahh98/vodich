const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const { assertWellFormedHtml } = require('./helpers/html');

const { buildMonthReport, weekStartsInMonth } = require('../dist/household/household-calc');
const { HouseholdService } = require('../dist/household/household.service');

const root = path.join(__dirname, '..');
const day = (iso) => new Date(`${iso}T00:00:00Z`);

const BOOK_ID = 1;
const SECTIONS = ['tong-quan', 'thu', 'tiet-kiem', 'tra-no', 'chi-phi-co-dinh', 'phat-sinh', 'cai-dat'];
/** Tổng quan chỉ để đọc — không có form ghi nào khi sổ đã có dữ liệu. */
const WRITE_SECTIONS = SECTIONS.filter((s) => s !== 'tong-quan');

const CONFIG = { weeklyRate: 500000n, weekStartDow: 1, anchorDate: day('2026-06-01') };

/**
 * Đúng bảng tính chiphi.xlsx mà chủ nhà gửi. Con số cuối cùng của bảng đó — ô "còn thừa
 * tháng này" = 2.350.000 đ — chính là mốc để khoá lại toàn bộ công thức của module.
 *
 * Chọn tháng 6/2026 vì bảng tính ghi sinh hoạt vợ/chồng 2 triệu RƯỠI, tức tháng đó có 5
 * tuần; 6/2026 có đúng 5 ngày thứ Hai (1, 8, 15, 22, 29). `now` đặt sau ngày cuối tuần thứ
 * năm (5/7) để cả 5 tuần đều đã đóng ⇒ mặc định chi hết 500k/tuần, ra đúng cột "Đã chi".
 */
function excelBook(over = {}) {
  return {
    config: CONFIG,
    month: '2026-06',
    now: day('2026-07-10'),
    incomes: [
      { month: '2026-06', amount: 30000000n }, // lương vợ
      { month: '2026-06', amount: 35000000n }, // lương chồng
    ],
    funds: [
      { id: 1n, name: 'Tiết kiệm 2 vợ chồng', kind: 'accumulate', monthlyAmount: 20000000n, startMonth: '2026-06', active: true },
      { id: 2n, name: 'Tiết kiệm con', kind: 'accumulate', monthlyAmount: 2000000n, startMonth: '2026-06', active: true },
      { id: 3n, name: 'Dự phòng', kind: 'reserve', monthlyAmount: 3000000n, startMonth: '2026-06', active: true },
      { id: 4n, name: 'Y tế', kind: 'reserve', monthlyAmount: 3000000n, startMonth: '2026-06', active: true },
      { id: 5n, name: 'Đi chơi', kind: 'fun', monthlyAmount: 0n, startMonth: '2026-06', active: true },
    ],
    fundEntries: [],
    debts: [{ id: 1n, name: 'Ngân hàng', initialAmount: 904000000n, startMonth: '2026-06', active: true }],
    debtPayments: [{ debtId: 1n, month: '2026-06', principal: 4000000n, interest: 5000000n }],
    fixedCosts: [
      { id: 1n, name: 'Gửi xe ô tô', mode: 'once', capAmount: 800000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 2n, name: 'Xăng xe', mode: 'gradual', capAmount: 2000000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 3n, name: 'Tiền học của con', mode: 'once', capAmount: 6000000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 4n, name: 'Bỉm sữa của con', mode: 'gradual', capAmount: 2000000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 5n, name: 'Đưa ông bà', mode: 'once', capAmount: 9000000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 6n, name: 'Gửi xe máy', mode: 'once', capAmount: 350000n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 7n, name: 'Sinh hoạt vợ', mode: 'weekly', capAmount: 0n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 8n, name: 'Sinh hoạt chồng', mode: 'weekly', capAmount: 0n, weeklyRate: null, startMonth: '2026-06', active: true },
      { id: 9n, name: 'Sinh hoạt con', mode: 'gradual', capAmount: 500000n, weeklyRate: null, startMonth: '2026-06', active: true },
    ],
    fixedSpends: [
      { costId: 2n, month: '2026-06', occurredAt: day('2026-06-10'), amount: 1000000n }, // xăng: mới đổ 1tr/2tr
      { costId: 4n, month: '2026-06', occurredAt: day('2026-06-12'), amount: 1500000n }, // bỉm sữa: 1tr5/2tr
      { costId: 9n, month: '2026-06', occurredAt: day('2026-06-15'), amount: 500000n }, // sinh hoạt con
    ],
    extraCosts: [
      { month: '2026-06', occurredAt: day('2026-06-18'), amount: 500000n, source: 'new', fixedCostId: null, fundId: null },
      { month: '2026-06', occurredAt: day('2026-06-20'), amount: 1000000n, source: 'new', fixedCostId: null, fundId: null },
    ],
    ...over,
  };
}

const costOf = (report, name) => report.fixedCosts.find((c) => c.name === name);
const fundOf = (report, name) => report.funds.find((f) => f.name === name);

// ─── Công thức: khớp từng ô của bảng tính ───

test('chi tiêu: ra đúng ô "còn thừa tháng này" của bảng tính chiphi.xlsx', () => {
  const report = buildMonthReport(excelBook());

  assert.equal(report.incomeTotal, 65000000);
  assert.equal(report.fundDeposit, 28000000, 'nạp 20tr + 2tr + 3tr + 3tr, quỹ Đi chơi 0đ');
  assert.equal(report.debtPrincipal, 4000000);
  assert.equal(report.debtInterest, 5000000);
  assert.equal(report.fixedSpent, 24150000, 'cột "Đã chi": 800k+1tr+6tr+1tr5+9tr+350k+2tr5+2tr5+500k');
  assert.equal(report.extraNew, 1500000);
  // 65tr − 9tr nợ − 28tr tiết kiệm − 24,15tr cố định − 1,5tr phát sinh
  assert.equal(report.leftover, 2350000, 'đúng bằng ô "còn thừa tháng này" trong file Excel');
});

test('chi tiêu: nợ còn lại = nợ ban đầu trừ TỔNG gốc đã trả, lãi không làm giảm nợ', () => {
  const report = buildMonthReport(excelBook());
  const [debt] = report.debts;

  assert.equal(debt.initialAmount, 904000000);
  assert.equal(debt.principalPaid, 4000000);
  assert.equal(debt.remaining, 900000000, 'khớp ô "Tổng nợ" = 904tr − 4tr tiền gốc');
  assert.equal(debt.paidThisMonth, 9000000, 'tháng này chi ra gốc 4tr + lãi 5tr');
});

test('chi tiêu: khoản "chi 1 lần" chưa ghi gì thì tự tính là đã chi đủ trần, ghi rồi thì theo số thật', () => {
  const auto = costOf(buildMonthReport(excelBook()), 'Gửi xe ô tô');
  assert.equal(auto.spent, 800000);
  assert.equal(auto.autoFilled, true, 'chưa ghi khoản nào ⇒ hệ thống tự điền');
  assert.equal(auto.left, 0);

  const book = excelBook();
  book.fixedSpends.push({ costId: 1n, month: '2026-06', occurredAt: day('2026-06-03'), amount: 600000n });
  const manual = costOf(buildMonthReport(book), 'Gửi xe ô tô');
  assert.equal(manual.spent, 600000, 'đã ghi số thật thì không tự điền đè lên');
  assert.equal(manual.autoFilled, false);
  assert.equal(manual.left, 200000, 'phần chưa dùng đẩy vào tiền còn thừa');
});

test('chi tiêu: khoản "chi dần" chỉ tính theo số đã ghi, trần chưa dùng hết là tiền còn thừa', () => {
  const petrol = costOf(buildMonthReport(excelBook()), 'Xăng xe');
  assert.equal(petrol.cap, 2000000);
  assert.equal(petrol.spent, 1000000);
  assert.equal(petrol.left, 1000000);
  assert.equal(petrol.autoFilled, false);
});

// ─── Khoản sinh hoạt theo tuần ───

test('chi tiêu: trần khoản theo tuần = số tuần của tháng × mức tuần (2tr hay 2tr5)', () => {
  // 6/2026 có thứ Hai vào 1, 8, 15, 22, 29 ⇒ 5 tuần. 7/2026 có 6, 13, 20, 27 ⇒ 4 tuần.
  assert.equal(weekStartsInMonth('2026-06', 1).length, 5);
  assert.equal(weekStartsInMonth('2026-07', 1).length, 4);

  const june = buildMonthReport(excelBook());
  assert.equal(june.weeksInMonth, 5);
  assert.equal(costOf(june, 'Sinh hoạt vợ').cap, 2500000, 'tháng 5 tuần ⇒ 2 triệu rưỡi');

  const july = buildMonthReport(excelBook({ month: '2026-07', now: day('2026-08-05') }));
  assert.equal(july.weeksInMonth, 4);
  assert.equal(costOf(july, 'Sinh hoạt vợ').cap, 2000000, 'tháng 4 tuần ⇒ 2 triệu');
});

test('chi tiêu: hết tuần nào thì tuần đó mặc định đã chi hết 500k, tuần đang chạy thì chưa', () => {
  // Đang ở giữa tuần thứ ba của tháng 6/2026 (thứ Hai 15/6).
  const report = buildMonthReport(excelBook({ now: new Date('2026-06-17T10:00:00Z') }));
  const cost = costOf(report, 'Sinh hoạt chồng');

  assert.equal(cost.weeks.length, 5);
  assert.deepEqual(cost.weeks.map((w) => w.closed), [true, true, false, false, false]);
  assert.deepEqual(cost.weeks.map((w) => w.amount), [500000, 500000, 0, 0, 0]);
  assert.equal(cost.spent, 1000000, 'chỉ 2 tuần đã đóng mới bị tính');
  assert.equal(cost.cap, 2500000, 'trần vẫn là cả 5 tuần của tháng');
});

test('chi tiêu: ghi số thật cho một tuần thì tuần đó dùng số đã ghi thay cho mức mặc định', () => {
  const book = excelBook();
  // Tuần 2 (8–14/6) chỉ tiêu 200k thay vì 500k.
  book.fixedSpends.push({ costId: 7n, month: '2026-06', occurredAt: day('2026-06-10'), amount: 200000n });
  const cost = costOf(buildMonthReport(book), 'Sinh hoạt vợ');

  assert.deepEqual(cost.weeks.map((w) => w.amount), [500000, 200000, 500000, 500000, 500000]);
  assert.equal(cost.weeks[1].manual, true);
  assert.equal(cost.spent, 2200000);
  assert.equal(cost.left, 300000, 'tiêu ít hơn mức tuần thì phần dư thành tiền còn thừa');
});

// ─── Quỹ tiết kiệm ───

test('chi tiêu: quỹ cộng dồn thì cộng dồn qua các tháng, dự phòng thì không', () => {
  const report = buildMonthReport(
    excelBook({
      month: '2026-07',
      now: day('2026-08-05'),
      incomes: [
        { month: '2026-06', amount: 65000000n },
        { month: '2026-07', amount: 65000000n },
      ],
    }),
  );

  assert.equal(fundOf(report, 'Tiết kiệm 2 vợ chồng').balance, 40000000, '2 tháng × 20tr');
  assert.equal(fundOf(report, 'Tiết kiệm con').balance, 4000000);
  assert.equal(fundOf(report, 'Dự phòng').balance, 3000000, 'dự phòng KHÔNG cộng dồn: chỉ mức của chính tháng này');
});

test('chi tiêu: dự phòng & y tế không dùng hết thì cuối tháng dồn hết sang quỹ Đi chơi', () => {
  const report = buildMonthReport(
    excelBook({
      month: '2026-07',
      now: day('2026-08-05'),
      // Tháng 6 rút 1tr từ Dự phòng ⇒ còn thừa 2tr; Y tế không đụng ⇒ thừa cả 3tr.
      fundEntries: [{ fundId: 3n, month: '2026-06', direction: 'out', amount: 1000000n }],
    }),
  );

  assert.equal(fundOf(report, 'Đi chơi').balance, 5000000, 'nhận 2tr dự phòng + 3tr y tế còn thừa của tháng 6');
  assert.equal(fundOf(report, 'Đi chơi').receivesCarry, true);
  assert.equal(fundOf(report, 'Dự phòng').carriesToFun, true);
  assert.equal(report.reserveCarryThisMonth, 6000000, 'tháng 7 chưa tiêu gì ⇒ cuối tháng sẽ dồn tiếp 6tr');
  assert.equal(report.funFundName, 'Đi chơi');
});

test('chi tiêu: tháng đang xem CHƯA dồn phần thừa sang Đi chơi, chỉ báo trước số sẽ dồn', () => {
  const report = buildMonthReport(excelBook());
  assert.equal(fundOf(report, 'Đi chơi').balance, 0, 'tháng 6 chưa đóng thì Đi chơi chưa nhận gì');
  assert.equal(report.reserveCarryThisMonth, 6000000);
});

// ─── Tiền còn thừa cộng dồn ───

test('chi tiêu: còn thừa của mọi tháng trước cộng hết vào tổng còn thừa', () => {
  const report = buildMonthReport(
    excelBook({
      month: '2026-07',
      now: day('2026-08-05'),
      incomes: [
        { month: '2026-06', amount: 65000000n },
        { month: '2026-07', amount: 65000000n },
      ],
      debtPayments: [
        { debtId: 1n, month: '2026-06', principal: 4000000n, interest: 5000000n },
        { debtId: 1n, month: '2026-07', principal: 4000000n, interest: 5000000n },
      ],
    }),
  );

  assert.ok(report.leftoverPrevious > 0, 'tháng 6 phải có tiền còn thừa mang sang');
  assert.equal(report.leftoverTotal, report.leftoverPrevious + report.leftover);
  assert.equal(report.debts[0].principalPaid, 8000000, 'trả gốc 2 tháng');
  assert.equal(report.debts[0].remaining, 896000000);
});

// ─── Chi phí phát sinh: nguồn tiền quyết định có trừ hai lần hay không ───

test('chi tiêu: phát sinh lấy từ khoản cố định thì tính vào khoản đó, KHÔNG trừ thêm lần nữa', () => {
  const base = buildMonthReport(excelBook());
  const book = excelBook();
  book.extraCosts.push({
    month: '2026-06',
    occurredAt: day('2026-06-22'),
    amount: 400000n,
    source: 'fixed',
    fixedCostId: 2n, // xăng xe
    fundId: null,
  });
  const report = buildMonthReport(book);

  assert.equal(costOf(report, 'Xăng xe').spent, 1400000, 'cộng vào phần đã chi của xăng xe');
  assert.equal(report.extraNew, base.extraNew, 'không đụng vào phần "khoản chi mới"');
  assert.equal(report.extraFromFixed, 400000);
  assert.equal(report.leftover, base.leftover - 400000, 'chỉ trừ đúng MỘT lần, qua đường chi phí cố định');
});

test('chi tiêu: phát sinh lấy từ quỹ thì trừ vào quỹ đó, tiền còn thừa của tháng không đổi', () => {
  const base = buildMonthReport(excelBook());
  const book = excelBook();
  book.extraCosts.push({
    month: '2026-06',
    occurredAt: day('2026-06-25'),
    amount: 700000n,
    source: 'fund',
    fixedCostId: null,
    fundId: 1n, // tiết kiệm 2 vợ chồng
  });
  const report = buildMonthReport(book);

  assert.equal(fundOf(report, 'Tiết kiệm 2 vợ chồng').used, 700000);
  assert.equal(fundOf(report, 'Tiết kiệm 2 vợ chồng').balance, 19300000);
  assert.equal(report.extraFromFund, 700000);
  assert.equal(report.leftover, base.leftover, 'tiền đã trích tiết kiệm rồi, không trừ lại vào phần còn thừa');
});

test('chi tiêu: phát sinh khai nguồn đã bị xoá thì rơi về "khoản chi mới", tiền không biến mất', () => {
  const book = excelBook();
  book.extraCosts.push({
    month: '2026-06',
    occurredAt: day('2026-06-26'),
    amount: 300000n,
    source: 'fixed',
    fixedCostId: null, // khoản gốc đã bị xoá
    fundId: null,
  });
  const report = buildMonthReport(book);
  assert.equal(report.extraNew, 1800000, 'vẫn bị trừ như một khoản chi mới');
});

// ─── Danh mục tạm dừng ───

test('chi tiêu: tạm dừng một khoản chỉ ngừng từ tháng này, lịch sử tháng cũ giữ nguyên', () => {
  const book = excelBook({ month: '2026-07', now: day('2026-07-10') });
  book.funds = book.funds.map((f) => (f.id === 2n ? { ...f, active: false } : f));
  const report = buildMonthReport(book);

  assert.equal(fundOf(report, 'Tiết kiệm con').deposited, 0, 'tháng này ngừng nạp');
  assert.equal(fundOf(report, 'Tiết kiệm con').balance, 2000000, 'tháng 6 đã nạp thì vẫn còn nguyên');
});

// ─── Service: lọc theo sổ ───

/**
 * Prisma giả: chỉ trả về đúng những gì `book()` đọc. MỌI truy vấn đều bị khẳng định là có
 * `where.householdId` — nếu ai đó lỡ bỏ bộ lọc theo sổ trong service, test ở đây gãy ngay
 * chứ không đợi tới lúc rò dữ liệu sang admin khác.
 */
function makePrisma(rows = {}) {
  const scoped = (where, label) => {
    assert.equal(where?.householdId, BOOK_ID, `truy vấn ${label} phải lọc theo householdId`);
    return true;
  };
  const table = (name, data) => ({
    findMany: async ({ where } = {}) => (scoped(where, name) ? data : []),
  });
  return {
    householdConfig: { findUnique: async ({ where }) => (where.id === BOOK_ID ? { id: BOOK_ID, ...CONFIG } : null) },
    householdIncome: table('householdIncome', rows.incomes ?? []),
    householdFund: table('householdFund', rows.funds ?? []),
    householdFundEntry: table('householdFundEntry', rows.fundEntries ?? []),
    householdDebt: table('householdDebt', rows.debts ?? []),
    householdDebtPayment: table('householdDebtPayment', rows.debtPayments ?? []),
    householdFixedCost: table('householdFixedCost', rows.fixedCosts ?? []),
    householdFixedSpend: table('householdFixedSpend', rows.fixedSpends ?? []),
    householdExtraCost: table('householdExtraCost', rows.extraCosts ?? []),
  };
}

test('HouseholdService.book: chỉ trả về dòng của đúng tháng, phần cộng dồn nằm trong report', async () => {
  const service = new HouseholdService(
    makePrisma({
      incomes: [
        { id: 1n, month: '2026-06', source: 'Lương vợ', amount: 30000000n, note: '' },
        { id: 2n, month: '2026-05', source: 'Lương vợ', amount: 28000000n, note: '' },
      ],
    }),
  );

  const data = await service.book(BOOK_ID, '2026-06');
  assert.equal(data.incomes.length, 1, 'danh sách hiển thị chỉ có khoản của tháng đang xem');
  assert.equal(data.report.incomeTotal, 30000000);
  assert.equal(data.report.leftoverPrevious, 28000000, 'tháng 5 vẫn được tính vào phần còn thừa mang sang');
  assert.match((await service.book(BOOK_ID, 'linh tinh')).report.month, /^\d{4}-\d{2}$/, 'tháng sai định dạng rơi về tháng hiện tại');
});

// ─── Giao diện ───

function viewLocals(section, over = {}) {
  const report = buildMonthReport(excelBook());
  const source = excelBook();
  const currentBook = {
    id: BOOK_ID,
    name: 'Sổ chi tiêu gia đình',
    ownerAdminId: 7n,
    ownerAdmin: { id: 7n, username: 'admin', displayName: 'Admin' },
    permissions: [{ id: 5n, admin: { id: 9n, username: 'subadmin', displayName: 'Sub Admin' } }],
  };
  const book = {
    report,
    incomes: [{ id: 1n, source: 'Lương vợ', amount: 30000000n, note: '' }],
    funds: source.funds.map((f) => ({ ...f })),
    fundEntries: [{ id: 1n, fundId: 3n, occurredAt: day('2026-06-12'), direction: 'out', amount: 400000n, note: 'Khám bệnh' }],
    debts: source.debts.map((d) => ({ ...d, note: '' })),
    fixedCosts: source.fixedCosts.map((c) => ({ ...c, note: '' })),
    fixedSpends: [{ id: 1n, costId: 2n, occurredAt: day('2026-06-10'), amount: 1000000n, note: 'Đổ xăng' }],
    extraCosts: [
      { id: 1n, occurredAt: day('2026-06-18'), name: 'Cưới abc', amount: 500000n, source: 'new', fixedCostId: null, fundId: null, note: '' },
      { id: 2n, occurredAt: day('2026-06-20'), name: 'Ăn ngoài sinh nhật cô Vy', amount: 1000000n, source: 'fund', fixedCostId: null, fundId: 5n, note: '' },
    ],
  };
  return {
    currentUser: { id: '7', role: 'ADMIN', displayName: 'Admin', email: 'admin@test' },
    featureSet: new Set(['HOUSEHOLD']),
    isRoot: true,
    books: [currentBook],
    currentBook,
    isOwner: true,
    admins: [{ id: 9n, username: 'other', displayName: 'Admin Khác' }],
    path: section === 'tong-quan' ? '/household' : `/household/${section}`,
    formatMoney: (value) => String(Math.round(Number(value) || 0)),
    section,
    config: { id: BOOK_ID, ...CONFIG },
    book,
    report,
    msg: '',
    err: '',
    ...over,
  };
}

const renderSection = (section, over) =>
  ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals(section, over));

test('household view: dựng được mọi mục, không sót dấu vết mô hình cũ', async () => {
  for (const section of SECTIONS) {
    const html = await renderSection(section);
    assert.doesNotMatch(html, /VPBank|Gmail|Quét ngay|IMAP/i, `mục ${section} còn sót phần quét email`);
    assert.doesNotMatch(html, /household-tab/, `mục ${section} còn thanh tab trên đầu (đã có menu ba gạch)`);
    assert.doesNotMatch(html, /onsubmit=/, `mục ${section} còn JS inline, vi phạm CSP`);
    assert.doesNotMatch(html, /ví tuần|chi chung/i, `mục ${section} còn chữ của mô hình ví tiền cũ`);
    assert.match(html, /Quản lý chi tiêu/);
  }
});

/**
 * CA THẬT (28/7/2026): một lần sửa hàng loạt đã chèn `<input name="book">` vào GIỮA thuộc
 * tính `action` của 4 form xoá. EJS render "thành công", snapshot chụp lại luôn cái hỏng,
 * mọi test đều xanh — nhưng trên màn hình thì lòi ra chữ `/delete" data-confirm="..."` và
 * bấm Xoá thì lỗi vì URL bị cắt. So chuỗi không bắt được, phải kiểm CẤU TRÚC.
 */
test('household view: HTML dựng đúng cấu trúc ở MỌI mục, thẻ không chen ngang nhau', async () => {
  for (const section of SECTIONS) {
    assertWellFormedHtml(assert, await renderSection(section), `mục ${section}`);
  }
});

test('household view: mọi form ghi đều mang theo id sổ, không thì bấm nhầm sang sổ khác', async () => {
  for (const section of WRITE_SECTIONS) {
    const html = await renderSection(section);
    // Chỉ soi form của chính module này; form Đăng xuất ở thanh topbar không liên quan tới sổ.
    const forms = (html.match(/<form\b[^>]*method="post"[^>]*>[\s\S]*?<\/form>/gi) || []).filter((form) =>
      /action="\/household/.test(form),
    );
    assert.ok(forms.length > 0, `mục ${section} phải có ít nhất một form ghi`);
    for (const form of forms) {
      const action = (form.match(/action="([^"]*)"/) || [])[1] || '(không có action)';
      assert.match(form, /name="book"/, `form ${action} ở mục ${section} thiếu id sổ`);
    }
  }
});

test('household view: URL trong action phải sạch, không dính mảnh thẻ HTML', async () => {
  for (const section of SECTIONS) {
    const html = await renderSection(section);
    for (const [, action] of html.matchAll(/action="(\/household[^"]*)"/g)) {
      assert.doesNotMatch(action, /[<>]/, `action "${action}" ở mục ${section} có lẫn ký tự thẻ HTML`);
      assert.match(action, /^\/household(\/[\w:-]+)*$/, `action "${action}" ở mục ${section} không phải URL hợp lệ`);
    }
  }
});

test('household view: mọi số tiền đều dùng formatMoney (có dấu phân cách nghìn)', async () => {
  const source = require('node:fs').readFileSync(path.join(root, 'src/views/household/index.ejs'), 'utf8');
  // Không còn chỗ nào đổ số tiền thô ra màn hình bằng Number(...) — luôn qua formatMoney.
  assert.doesNotMatch(source, /<%=\s*Number\((config|c|f|d|e|i|s)\./, 'còn số tiền thô chưa qua formatMoney');

  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), {
    ...viewLocals('cai-dat'),
    formatMoney: (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0),
  });
  assert.match(html, /value="500,000"/, 'ô nhập tiền phải hiện sẵn dạng có dấu phẩy');
  assert.match(html, /class="money-input"/, 'ô nhập tiền phải tự chèn dấu phẩy khi gõ');
});

test('household view: tổng quan bày đủ 5 phần của bảng tính và con số còn thừa', async () => {
  const html = await renderSection('tong-quan');
  for (const label of ['1. Thu', '2. Tiết kiệm', '3. Trả nợ', '4. Chi phí cố định', '5. Chi phí phát sinh']) {
    assert.ok(html.includes(label), `tổng quan thiếu phần "${label}"`);
  }
  assert.match(html, /Còn thừa tháng này/);
  assert.match(html, /2350000/, 'số còn thừa của tháng phải hiện ra');
  assert.match(html, /900000000/, 'nợ còn lại sau khi trừ gốc phải hiện ra');
  assert.match(html, /metric-card/, 'dùng chung ô số liệu với module đội bóng');
});

test('household view: mục tiết kiệm nói rõ dự phòng thừa thì dồn sang Đi chơi', async () => {
  const html = await renderSection('tiet-kiem');
  assert.match(html, /dồn hết sang quỹ/i);
  assert.match(html, /Đi chơi/);
  assert.match(html, /name="direction"/, 'phải có ô chọn nạp thêm hay rút ra');
});

test('household view: mục trả nợ cho nhập gốc & lãi theo tháng, hiện nợ còn lại', async () => {
  const html = await renderSection('tra-no');
  assert.match(html, /name="principal"/);
  assert.match(html, /name="interest"/);
  assert.match(html, /Còn nợ/);
  assert.match(html, /Nợ ban đầu/);
});

test('household view: mục chi phí cố định bày từng tuần của khoản sinh hoạt', async () => {
  const html = await renderSection('chi-phi-co-dinh');
  assert.match(html, /Tuần 1 \(01\/06\/2026–07\/06\/2026\)/, 'tuần tính từ thứ Hai đầu tiên, ngày theo giờ Việt Nam');
  assert.match(html, /mặc định/, 'tuần đã hết phải ghi rõ là số mặc định');
  assert.match(html, /Sinh hoạt vợ/);
  assert.match(html, /tự tính/, 'khoản chi 1 lần chưa ghi gì phải ghi rõ là tự tính');
});

test('household view: mục phát sinh cho chọn lấy tiền từ khoản cố định hoặc quỹ', async () => {
  const html = await renderSection('phat-sinh');
  assert.match(html, /name="pick"/);
  assert.match(html, /value="fixed:2"/, 'chọn được một khoản chi phí cố định làm nguồn');
  assert.match(html, /value="fund:1"/, 'chọn được một quỹ tiết kiệm làm nguồn');
  assert.match(html, /không trừ thêm lần nữa/i);
});

test('household view: chọn tháng tự chuyển ngay, không cần bấm nút', async () => {
  const html = await renderSection('thu');
  assert.match(html, /type="month"[^>]*data-autosubmit/, 'ô chọn tháng phải có data-autosubmit');
  assert.match(html, /Chép các khoản thu của tháng trước/);
});
