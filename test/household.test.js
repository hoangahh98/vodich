const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const { assertWellFormedHtml } = require('./helpers/html');

const { buildMonthReport } = require('../dist/household/household-calc');
const { HouseholdService } = require('../dist/household/household.service');

const root = path.join(__dirname, '..');
const day = (iso) => new Date(`${iso}T00:00:00Z`);

const BOOK_ID = 1;
const SECTIONS = ['tong-quan', 'thu', 'chi', 'loai-thu', 'loai-chi', 'so-no', 'tro-ly', 'cai-dat'];
/** Tổng quan chỉ để đọc — không có form ghi nào khi sổ đã có dữ liệu. */
const WRITE_SECTIONS = SECTIONS.filter((s) => s !== 'tong-quan');

const CONFIG = { anchorDate: day('2026-05-01') };

// ─── Sổ dựng tay: đủ cả 3 kiểu loại và cả 2 chiều nợ ───

const INCOME_CATEGORIES = [
  { id: 1n, name: 'Lương vợ', kind: 'normal', active: true, note: '' },
  { id: 2n, name: 'Lương chồng', kind: 'normal', active: true, note: '' },
  { id: 3n, name: 'Rút tiết kiệm', kind: 'saving', active: true, note: '' },
  { id: 4n, name: 'Người ta trả nợ', kind: 'debt', active: true, note: '' },
];

const EXPENSE_CATEGORIES = [
  { id: 11n, name: 'Ăn uống', kind: 'variable', active: true, note: '' },
  { id: 12n, name: 'Xăng xe', kind: 'fixed', active: true, note: '' },
  { id: 13n, name: 'Tiết kiệm 2 vợ chồng', kind: 'saving', active: true, note: '' },
  { id: 14n, name: 'Tiết kiệm con', kind: 'saving', active: true, note: '' },
  { id: 15n, name: 'Trả nợ', kind: 'debt', active: true, note: '' },
];

const DEBTS = [
  {
    id: 101n,
    direction: 'owe',
    name: 'Vay ngân hàng',
    counterparty: 'Ngân hàng',
    initialAmount: 904000000n,
    startDate: day('2026-05-01'),
    dueDate: null,
    note: '',
  },
  {
    id: 102n,
    direction: 'lend',
    name: 'Cho anh Nam vay',
    counterparty: 'Anh Nam',
    initialAmount: 50000000n,
    startDate: day('2026-05-10'),
    dueDate: day('2026-12-31'),
    note: '',
  },
];

const income = (over) => ({ categoryId: 1n, month: '2026-06', amount: 0n, principal: 0n, interest: 0n, debtId: null, ...over });
const expense = (over) => ({ categoryId: 11n, month: '2026-06', amount: 0n, principal: 0n, interest: 0n, debtId: null, ...over });

/**
 * Tháng 5 là tháng "đã qua" (để thử phần dồn qua tháng), tháng 6 là tháng đang xem.
 *
 * Tháng 5: thu 60tr · ăn uống 5tr · gửi tiết kiệm 20tr  ⇒ còn lại 35tr
 * Tháng 6: thu 65tr · ăn 6tr + xăng 2tr · gửi tiết kiệm 20tr + 2tr · trả nợ gốc 4tr + lãi 5tr
 *          · rút tiết kiệm 3tr · anh Nam trả gốc 10tr + lãi 500k
 */
function ledger(over = {}) {
  return {
    config: CONFIG,
    month: '2026-06',
    incomeCategories: INCOME_CATEGORIES,
    expenseCategories: EXPENSE_CATEGORIES,
    debts: DEBTS,
    incomes: [
      income({ month: '2026-05', categoryId: 1n, amount: 30000000n }),
      income({ month: '2026-05', categoryId: 2n, amount: 30000000n }),
      income({ categoryId: 1n, amount: 30000000n }),
      income({ categoryId: 2n, amount: 35000000n }),
      income({ categoryId: 3n, amount: 3000000n }), // rút tiết kiệm ra tiêu
      income({ categoryId: 4n, amount: 10500000n, principal: 10000000n, interest: 500000n, debtId: 102n }),
    ],
    expenses: [
      expense({ month: '2026-05', categoryId: 11n, amount: 5000000n }),
      expense({ month: '2026-05', categoryId: 13n, amount: 20000000n }),
      expense({ categoryId: 11n, amount: 6000000n }),
      expense({ categoryId: 12n, amount: 2000000n }),
      expense({ categoryId: 13n, amount: 20000000n }),
      expense({ categoryId: 14n, amount: 2000000n }),
      expense({ categoryId: 15n, amount: 9000000n, principal: 4000000n, interest: 5000000n, debtId: 101n }),
    ],
    ...over,
  };
}

const debtOf = (report, name) => report.debts.find((d) => d.name === name);
const catOf = (rows, name) => rows.find((r) => r.name === name);

// ─── Rule 1: ba ô của Tổng quan ───

test('chi tiêu: thu nhập KHÔNG gồm tiền rút tiết kiệm, chi phí KHÔNG gồm tiền gửi tiết kiệm', () => {
  const report = buildMonthReport(ledger());

  assert.equal(report.income, 75500000, 'lương 30tr + 35tr + gốc & lãi anh Nam trả 10,5tr');
  assert.equal(report.savingOut, 3000000, 'rút tiết kiệm nằm riêng, không cộng vào thu nhập');
  assert.equal(report.expense, 17000000, 'ăn 6tr + xăng 2tr + trả nợ 9tr (gốc lẫn lãi đều là tiền ra)');
  assert.equal(report.savingIn, 22000000, 'gửi tiết kiệm nằm riêng, không cộng vào chi phí');
});

// ─── Rule 2: tiết kiệm dồn qua các tháng ───

test('chi tiêu: tiết kiệm DỒN qua các tháng, trừ đi phần đã rút', () => {
  const report = buildMonthReport(ledger());

  // Tháng 5 gửi 20tr; tháng 6 gửi 22tr rồi rút ra 3tr.
  assert.equal(report.savingBalance, 39000000, '20tr + 22tr − 3tr');
  assert.equal(report.savingNet, 19000000, 'riêng tháng 6 tăng 19tr');

  const may = buildMonthReport(ledger({ month: '2026-05' }));
  assert.equal(may.savingBalance, 20000000, 'đứng ở tháng 5 thì chưa thấy tiền của tháng 6');
});

test('chi tiêu: mọi loại đánh dấu tiết kiệm dồn vào CHUNG một ô, không loại nào bị reset', () => {
  const report = buildMonthReport(ledger());

  assert.deepEqual(report.savingByCategory.map((row) => row.name), ['Tiết kiệm 2 vợ chồng', 'Tiết kiệm con']);
  assert.equal(catOf(report.savingByCategory, 'Tiết kiệm 2 vợ chồng').amount, 20000000);
  assert.equal(report.savingByCategory.reduce((all, row) => all + row.amount, 0), report.savingIn);

  // Không còn kiểu quỹ nào "hết tháng là mất" như mô hình cũ: thêm một tháng nữa là dồn tiếp.
  const book = ledger({ month: '2026-07' });
  book.expenses.push(expense({ month: '2026-07', categoryId: 13n, amount: 5000000n }));
  assert.equal(buildMonthReport(book).savingBalance, 44000000, '39tr của tháng 6 + 5tr gửi thêm tháng 7');
});

// ─── Rule 3: tiền còn lại ───

test('chi tiêu: còn lại = mọi thứ vào trừ mọi thứ ra, và cộng dồn qua các tháng', () => {
  const report = buildMonthReport(ledger());

  // Vào: 30 + 35 + 3 (rút) + 10,5 = 78,5tr · Ra: 6 + 2 + 20 + 2 + 9 = 39tr
  assert.equal(report.leftover, 39500000);
  assert.equal(report.leftoverPrevious, 35000000, 'tháng 5: 60tr − 5tr ăn − 20tr gửi tiết kiệm');
  assert.equal(report.leftoverTotal, 74500000);
  assert.equal(report.leftoverTotal, report.leftoverPrevious + report.leftover);
});

test('chi tiêu: tiền chuyển vào/ra tiết kiệm không bị đếm hai lần', () => {
  const base = buildMonthReport(ledger());
  const book = ledger();
  // Gửi thêm 1tr vào tiết kiệm: tiền rời khỏi ví đúng MỘT lần.
  book.expenses.push(expense({ categoryId: 13n, amount: 1000000n }));
  const report = buildMonthReport(book);

  assert.equal(report.savingBalance, base.savingBalance + 1000000);
  assert.equal(report.leftover, base.leftover - 1000000);
  assert.equal(report.expense, base.expense, 'gửi tiết kiệm không làm phồng ô Chi phí');
});

// ─── Rule 4: sổ nợ hai chiều ───

test('chi tiêu: trả nợ thì GỐC tự trừ vào khoản được chọn, lãi thì không', () => {
  const debt = debtOf(buildMonthReport(ledger()), 'Vay ngân hàng');

  assert.equal(debt.initialAmount, 904000000);
  assert.equal(debt.principalPaid, 4000000);
  assert.equal(debt.interestPaid, 5000000);
  assert.equal(debt.remaining, 900000000, '904tr − 4tr tiền gốc; 5tr lãi không làm giảm nợ');
  assert.equal(debt.principalThisMonth, 4000000);
  assert.equal(debt.settled, false);
});

test('chi tiêu: người khác trả nợ mình thì trừ vào khoản CHO VAY, không đụng khoản mình nợ', () => {
  const report = buildMonthReport(ledger());
  const lend = debtOf(report, 'Cho anh Nam vay');
  const owe = debtOf(report, 'Vay ngân hàng');

  assert.equal(lend.principalPaid, 10000000);
  assert.equal(lend.remaining, 40000000, '50tr − 10tr gốc anh Nam đã trả');
  assert.equal(lend.progress, 20);
  assert.equal(owe.remaining, 900000000, 'khoản mình nợ không bị đụng tới');

  assert.equal(report.oweRemaining, 900000000);
  assert.equal(report.lendRemaining, 40000000);
  assert.equal(report.debtNet, -860000000, 'nợ nhiều hơn cho vay');
  assert.equal(report.debtPrincipalPaid, 4000000);
  assert.equal(report.debtPrincipalCollected, 10000000);
});

test('chi tiêu: trả hết gốc thì khoản nợ báo đã tất toán', () => {
  const book = ledger();
  book.expenses.push(expense({ categoryId: 15n, amount: 900000000n, principal: 900000000n, debtId: 101n }));
  const debt = debtOf(buildMonthReport(book), 'Vay ngân hàng');

  assert.equal(debt.remaining, 0);
  assert.equal(debt.settled, true);
  assert.equal(debt.progress, 100);
});

test('chi tiêu: gốc trả ở các tháng TRƯỚC vẫn tính, tháng SAU thì chưa', () => {
  const book = ledger();
  book.expenses.push(expense({ month: '2026-05', categoryId: 15n, amount: 4000000n, principal: 4000000n, debtId: 101n }));
  book.expenses.push(expense({ month: '2026-07', categoryId: 15n, amount: 4000000n, principal: 4000000n, debtId: 101n }));
  const debt = debtOf(buildMonthReport(book), 'Vay ngân hàng');

  assert.equal(debt.principalPaid, 8000000, 'tháng 5 + tháng 6, chưa tính tháng 7');
  assert.equal(debt.remaining, 896000000);
});

// ─── Không để tiền biến mất ───

test('chi tiêu: khoản của loại đã bị xoá vẫn nằm trong công thức, không bốc hơi', () => {
  const book = ledger();
  book.expenses.push(expense({ categoryId: null, amount: 700000n }));
  const report = buildMonthReport(book);

  assert.equal(report.expense, 17700000, 'vẫn bị trừ như một khoản chi thường');
  assert.equal(catOf(report.expenseByCategory, '(loại đã xoá)').amount, 700000);
});

test('chi tiêu: đứng ở tháng nào thì không thấy tiền của tháng sau', () => {
  const report = buildMonthReport(ledger({ month: '2026-05' }));

  assert.equal(report.income, 60000000, 'chỉ hai khoản lương của tháng 5');
  assert.equal(report.leftoverTotal, 35000000, 'không cộng tháng 6 vào');
  assert.equal(debtOf(report, 'Vay ngân hàng').principalPaid, 0, 'gốc của tháng 6 chưa được tính');
});

// ─── Gộp theo loại & dải 6 tháng ───

test('chi tiêu: gộp theo loại xếp nhiều tiền trước và tính đúng tỷ trọng', () => {
  const rows = buildMonthReport(ledger()).expenseByCategory;

  assert.deepEqual(rows.map((r) => r.name), ['Trả nợ', 'Ăn uống', 'Xăng xe']);
  assert.equal(catOf(rows, 'Trả nợ').share, 53, '9tr / 17tr');
  assert.equal(rows.reduce((all, r) => all + r.amount, 0), 17000000);
});

test('chi tiêu: dải xu hướng luôn đủ 6 tháng liền nhau, tháng trống vẫn có mặt', () => {
  const trend = buildMonthReport(ledger()).trend;

  assert.equal(trend.length, 6);
  assert.deepEqual(trend.map((t) => t.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.equal(trend[3].income, 0, 'tháng chưa ghi gì thì bằng 0 chứ không bị bỏ qua');
  assert.equal(trend[5].leftover, 39500000, 'tháng cuối dải là tháng đang xem');
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
    householdIncomeCategory: table('householdIncomeCategory', rows.incomeCategories ?? INCOME_CATEGORIES),
    householdExpenseCategory: table('householdExpenseCategory', rows.expenseCategories ?? EXPENSE_CATEGORIES),
    householdIncome: table('householdIncome', rows.incomes ?? []),
    householdExpense: table('householdExpense', rows.expenses ?? []),
    householdDebt: table('householdDebt', rows.debts ?? DEBTS),
  };
}

test('HouseholdService.book: chỉ trả về dòng của đúng tháng, phần cộng dồn nằm trong report', async () => {
  const service = new HouseholdService(
    makePrisma({
      incomes: [
        { id: 1n, ...income({ categoryId: 1n, amount: 30000000n }) },
        { id: 2n, ...income({ month: '2026-05', categoryId: 1n, amount: 28000000n }) },
      ],
      expenses: [{ id: 3n, ...expense({ month: '2026-05', categoryId: 13n, amount: 9000000n }) }],
    }),
  );

  const data = await service.book(BOOK_ID, '2026-06');
  assert.equal(data.incomes.length, 1, 'danh sách hiển thị chỉ có khoản của tháng đang xem');
  assert.equal(data.report.income, 30000000);
  assert.equal(data.report.savingBalance, 9000000, 'tiền gửi tiết kiệm ở tháng 5 vẫn còn nguyên ở tháng 6');
  assert.equal(data.report.leftoverPrevious, 19000000, '28tr thu − 9tr gửi tiết kiệm của tháng 5');
  assert.match((await service.book(BOOK_ID, 'linh tinh')).report.month, /^\d{4}-\d{2}$/, 'tháng sai định dạng rơi về tháng hiện tại');
});

/**
 * Khoản chi loại "trả nợ" BẮT BUỘC gắn được vào một khoản nợ đúng chiều của đúng sổ này.
 * Gửi lên id khoản nợ của sổ khác (hoặc khoản cho vay) thì phải bị TỪ CHỐI — nếu chỉ âm
 * thầm bỏ liên kết, người dùng tưởng đã trừ nợ xong mà thực ra không trừ gì cả.
 */
test('HouseholdService.addExpense: loại trả nợ phải chọn đúng khoản nợ của sổ này', async () => {
  const queries = [];
  const service = new HouseholdService({
    householdExpenseCategory: {
      findFirst: async ({ where }) => (where.householdId === BOOK_ID && where.id === 15n ? { id: 15n, kind: 'debt' } : null),
    },
    householdDebt: {
      findFirst: async ({ where }) => {
        queries.push(where);
        return where.householdId === BOOK_ID && where.id === 101n && where.direction === 'owe' ? { id: 101n } : null;
      },
    },
    householdExpense: { create: async ({ data }) => data },
  });
  const body = { categoryId: '15', occurredAt: '2026-06-05', principal: '4,000,000', interest: '5,000,000' };

  const ok = await service.addExpense(BOOK_ID, { ...body, debtId: '101' });
  assert.equal(ok.err, undefined);
  assert.equal(ok.month, '2026-06');
  assert.equal(queries[0].householdId, BOOK_ID, 'phải lọc khoản nợ theo id sổ');
  assert.equal(queries[0].direction, 'owe', 'khoản CHI chỉ trả được khoản mình nợ');

  const wrong = await service.addExpense(BOOK_ID, { ...body, debtId: '102' });
  assert.match(wrong.err, /chọn khoản nợ/i, 'khoản nợ không đúng chiều/không thuộc sổ này thì từ chối ghi');
});

test('HouseholdService.addExpense: số tiền = gốc + lãi, không cho ghi khoản 0đ', async () => {
  let saved = null;
  const service = new HouseholdService({
    householdExpenseCategory: { findFirst: async ({ where }) => ({ id: where.id, kind: where.id === 15n ? 'debt' : 'normal' }) },
    householdDebt: { findFirst: async () => ({ id: 101n }) },
    householdExpense: { create: async ({ data }) => (saved = data) },
  });

  await service.addExpense(BOOK_ID, { categoryId: '15', debtId: '101', principal: '4000000', interest: '5000000', occurredAt: '2026-06-05' });
  assert.equal(saved.amount, 9000000n);
  assert.equal(saved.principal, 4000000n);
  assert.equal(saved.interest, 5000000n);
  assert.equal(saved.debtId, 101n);

  const empty = await service.addExpense(BOOK_ID, { categoryId: '11', amount: '0', occurredAt: '2026-06-05' });
  assert.match(empty.err, /lớn hơn 0/);
});

/**
 * Chép khoản thu tháng trước chỉ được chép loại `normal`. Chép nhầm "người ta trả nợ" là tự
 * trừ gốc một lần không có thật; chép nhầm "rút tiết kiệm" là tự móc két một lần không có thật.
 */
test('HouseholdService.copyIncomeFromPreviousMonth: chỉ chép loại thường, bỏ thu nợ & rút tiết kiệm', async () => {
  let created = null;
  const service = new HouseholdService({
    householdIncome: {
      findMany: async ({ where, select }) => {
        if (select) return [];
        return where.month === '2026-05'
          ? [
              { id: 1n, categoryId: 1n, amount: 30000000n, note: 'lương', debtId: null },
              { id: 2n, categoryId: 3n, amount: 3000000n, note: 'rút két', debtId: null },
              { id: 3n, categoryId: 4n, amount: 10500000n, note: 'anh Nam trả', debtId: 102n },
            ]
          : [];
      },
      createMany: async ({ data }) => (created = data),
    },
    householdIncomeCategory: { findMany: async ({ where }) => (where.kind === 'normal' ? [{ id: 1n }, { id: 2n }] : []) },
  });

  const result = await service.copyIncomeFromPreviousMonth(BOOK_ID, '2026-06');
  assert.equal(created.length, 1, 'chỉ chép đúng khoản lương');
  assert.equal(created[0].categoryId, 1n);
  assert.equal(created[0].month, '2026-06');
  assert.match(result.msg, /Đã chép 1 khoản thu/);
});

test('HouseholdService.addExpense: tháng lấy theo NGÀY chi, không theo tháng đang xem', async () => {
  let saved = null;
  const service = new HouseholdService({
    householdExpenseCategory: { findFirst: async ({ where }) => ({ id: where.id, kind: 'normal' }) },
    householdExpense: { create: async ({ data }) => (saved = data) },
  });

  await service.addExpense(BOOK_ID, { categoryId: '11', amount: '500000', occurredAt: '2026-05-28', month: '2026-06' });
  assert.equal(saved.month, '2026-05', 'ghi lùi ngày thì dòng đó về đúng tháng của nó');
});

// ─── Giao diện ───

function viewLocals(section, over = {}) {
  const source = ledger();
  const report = buildMonthReport(source);
  const currentBook = {
    id: BOOK_ID,
    name: 'Sổ chi tiêu gia đình',
    ownerAdminId: 7n,
    ownerAdmin: { id: 7n, username: 'admin', displayName: 'Admin' },
    permissions: [{ id: 5n, admin: { id: 9n, username: 'subadmin', displayName: 'Sub Admin' } }],
  };
  const rows = (list) =>
    list
      .filter((row) => row.month === '2026-06')
      .map((row, index) => ({ id: BigInt(index + 1), occurredAt: day('2026-06-10'), note: '', ...row }));
  const book = {
    report,
    incomeCategories: INCOME_CATEGORIES,
    expenseCategories: EXPENSE_CATEGORIES,
    debts: DEBTS,
    incomes: rows(source.incomes),
    expenses: rows(source.expenses),
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
    chat: [
      { id: 1n, role: 'user', content: 'Tháng này tiêu nhiều nhất vào đâu?', askedBy: 'Admin', createdAt: day('2026-06-20') },
      { id: 2n, role: 'assistant', content: 'Nhiều nhất là khoản Trả nợ: 9.000.000đ.', askedBy: '', createdAt: day('2026-06-20') },
    ],
    aiConfigured: true,
    draft: null,
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
    assert.doesNotMatch(html, /onsubmit=|onchange=/, `mục ${section} còn JS inline, vi phạm CSP`);
    assert.doesNotMatch(html, /ví tuần|chi chung/i, `mục ${section} còn chữ của mô hình ví tiền cũ`);
    // Rule của bảng tính chiphi.xlsx: trần/tháng, mức tuần, dự phòng dồn sang quỹ Đi chơi.
    assert.doesNotMatch(html, /Trần\/tháng|mức tuần|Chi 1 lần|Chi dần|dồn hết sang quỹ/i, `mục ${section} còn rule của bảng tính cũ`);
    assert.match(html, /Quản lý chi tiêu|Sổ chi tiêu/);
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
    ...viewLocals('so-no'),
    formatMoney: (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0),
  });
  assert.match(html, /value="904,000,000"/, 'ô nhập tiền phải hiện sẵn dạng có dấu phẩy');
  assert.match(html, /class="money-input"/, 'ô nhập tiền phải tự chèn dấu phẩy khi gõ');
});

test('household view: tổng quan bày đủ ba ô Tiết kiệm / Chi phí / Thu nhập', async () => {
  const html = await renderSection('tong-quan');

  assert.match(html, /🐷 Tiết kiệm đang có/);
  assert.match(html, /💸 Chi phí tháng/);
  assert.match(html, /💵 Thu nhập tháng/);
  assert.match(html, /39000000/, 'số tiết kiệm dồn qua các tháng phải hiện ra');
  assert.match(html, /dồn qua tất cả các tháng/i);
  assert.match(html, /metric-card/, 'dùng chung ô số liệu với module đội bóng');
  assert.match(html, /900000000/, 'nợ còn lại sau khi trừ gốc phải hiện ra');
});

test('household view: mục khai chi có ô gốc/lãi và ô chọn khoản nợ', async () => {
  const html = await renderSection('chi');
  const debtSelect = html.split('name="debtId"')[1].split('</select>')[0];

  assert.match(html, /name="principal"/);
  assert.match(html, /name="interest"/);
  assert.match(html, /data-entry-kind/, 'ô chọn loại phải có mốc để JS bật/tắt phần trả nợ');
  assert.match(html, /data-kind="debt"/, 'loại kiểu trả nợ phải khai rõ kind ra HTML');
  assert.match(debtSelect, /Vay ngân hàng/, 'chỉ liệt kê khoản MÌNH nợ');
  assert.doesNotMatch(debtSelect, /anh Nam/i, 'khoản cho vay không được lọt vào ô trả nợ');
});

test('household view: mục khai thu chỉ cho chọn khoản CHO VAY khi thu tiền nợ về', async () => {
  const html = await renderSection('thu');
  const debtSelect = html.split('name="debtId"')[1].split('</select>')[0];

  assert.match(debtSelect, /Cho anh Nam vay/);
  assert.doesNotMatch(debtSelect, /Vay ngân hàng/, 'khoản mình nợ không được lọt vào ô thu nợ');
  assert.match(html, /Chép các khoản thu của tháng trước/);
});

test('household view: loại chi phí khai được đủ BỐN kiểu, có cố định & phát sinh', async () => {
  const html = await renderSection('loai-chi');

  for (const kind of ['fixed', 'variable', 'saving', 'debt']) {
    assert.match(html, new RegExp(`value="${kind}"`), `thiếu kiểu ${kind}`);
  }
  assert.match(html, /Chi phí cố định/);
  assert.match(html, /Chi phí phát sinh/);
  assert.doesNotMatch(html, /value="normal"/, 'bên chi phí không còn kiểu normal');
});

test('household view: loại thu nhập vẫn ba kiểu, không dính cố định/phát sinh', async () => {
  const html = await renderSection('loai-thu');

  assert.match(html, /value="normal"/);
  assert.match(html, /Rút tiết kiệm/);
  assert.match(html, /Người ta trả nợ mình/);
  assert.doesNotMatch(html, /value="fixed"|value="variable"/, 'cố định/phát sinh chỉ có ở bên chi phí');
});

test('household view: mục chi có nút chép khoản CỐ ĐỊNH của tháng trước', async () => {
  const html = await renderSection('chi');

  assert.match(html, /action="\/household\/expenses\/copy"/);
  assert.match(html, /Chép các khoản chi cố định của tháng trước/);
});

test('household view: đã bỏ hẳn nạp danh mục mẫu, dải 6 tháng và cài đặt chung', async () => {
  for (const section of SECTIONS) {
    const html = await renderSection(section);
    assert.doesNotMatch(html, /Nạp danh mục mẫu|household\/seed/, `mục ${section} còn phần nạp mẫu`);
    assert.doesNotMatch(html, /Sáu tháng gần nhất/, `mục ${section} còn dải 6 tháng`);
    assert.doesNotMatch(html, /household\/config|name="anchorDate"/, `mục ${section} còn form cài đặt chung`);
  }
  // Cài đặt giờ chỉ còn đúng khung phân quyền.
  const settings = await renderSection('cai-dat');
  assert.match(settings, /Phân quyền admin/);
  assert.doesNotMatch(settings, /Cài đặt chung|Danh mục mẫu/);
});

test('household view: sổ nợ tách rõ hai chiều và hiện tiến độ trả', async () => {
  const html = await renderSection('so-no');

  assert.match(html, /Mình đang nợ/);
  assert.match(html, /Ai đang nợ mình/);
  assert.match(html, /name="direction"/);
  assert.match(html, /name="counterparty"/);
  assert.match(html, /hh-bar-fill/, 'phải có thanh tiến độ trả nợ');
  assert.match(html, /40000000/, 'còn phải thu của khoản cho vay');
});

test('household view: sổ nợ tách KHAI mới và SỬA khoản cũ thành hai phần riêng', async () => {
  const html = await renderSection('so-no');

  assert.match(html, /➕ Khai khoản nợ mới/);
  assert.match(html, /⚙️ Sửa khoản nợ đã khai/);
  assert.doesNotMatch(html, /Khai &amp; sửa khoản nợ/, 'không còn gộp chung một khối');

  // Phần KHAI phải nằm ngoài <details>, không thì lại bị gập vào như cũ.
  const collapsed = html.slice(html.indexOf('<details'));
  assert.doesNotMatch(collapsed, /Khai khoản nợ mới/, 'form khai mới không được nằm trong khối gập');
  assert.match(collapsed, /action="\/household\/debts\/101"/, 'form sửa thì nằm trong khối gập');

  // Đúng một form thêm mới (action không kèm id) — trước đây dễ nhân đôi khi tách khối.
  const addForms = [...html.matchAll(/action="\/household\/debts"/g)];
  assert.equal(addForms.length, 1, 'chỉ được có MỘT form khai khoản nợ mới');
});

test('household view: trợ lý bày hội thoại và form ghi nhanh, nói rõ AI không tự ghi', async () => {
  const html = await renderSection('tro-ly');

  assert.match(html, /action="\/household\/ai\/ask"/);
  assert.match(html, /action="\/household\/ai\/draft"/);
  assert.match(html, /Tháng này tiêu nhiều nhất vào đâu\?/, 'phải hiện lại lịch sử trò chuyện');
});

test('household view: bản nháp trợ lý là form điền sẵn trỏ về đúng đường ghi thường', async () => {
  const html = await renderSection('tro-ly', {
    draft: { type: 'expense', categoryId: '11', categoryName: 'Ăn uống', amount: 65000, occurredAt: '2026-06-21', note: 'Ăn trưa' },
  });

  assert.match(html, /action="\/household\/expenses"/, 'bấm xác nhận thì đi qua đúng route ghi khoản chi');
  assert.match(html, /value="65000"/);
  assert.match(html, /value="2026-06-21"/);
  assert.match(html, /Ghi vào sổ/);
});

test('household view: trợ lý chưa có API key thì khoá ô nhập chứ không để bấm rồi lỗi', async () => {
  const html = await renderSection('tro-ly', { aiConfigured: false, chat: [] });

  assert.match(html, /GROQ_API_KEY/);
  assert.match(html, /disabled/);
});

test('household view: chọn tháng tự chuyển ngay, không cần bấm nút', async () => {
  const html = await renderSection('thu');
  assert.match(html, /type="month"[^>]*data-autosubmit/, 'ô chọn tháng phải có data-autosubmit');
});


// ─── Chép khoản lặp lại của tháng trước ───

/**
 * Chỉ loại CỐ ĐỊNH mới được chép. Chép "phát sinh" là bịa ra một khoản chưa hề tiêu; chép
 * "trả nợ" là tự trừ gốc một lần không có thật; chép "gửi tiết kiệm" là tự móc két.
 */
test('HouseholdService.copyExpenseFromPreviousMonth: chỉ chép loại CỐ ĐỊNH', async () => {
  let created = null;
  const service = new HouseholdService({
    householdExpense: {
      findMany: async ({ where, select }) => {
        if (select) return [];
        return where.month === '2026-05'
          ? [
              { id: 1n, categoryId: 12n, amount: 2000000n, note: 'xăng' }, // fixed
              { id: 2n, categoryId: 11n, amount: 6000000n, note: 'ăn' }, // variable
              { id: 3n, categoryId: 13n, amount: 20000000n, note: 'tiết kiệm' }, // saving
              { id: 4n, categoryId: 15n, amount: 9000000n, note: 'trả nợ' }, // debt
            ]
          : [];
      },
      createMany: async ({ data }) => (created = data),
    },
    householdExpenseCategory: { findMany: async ({ where }) => (where.kind === 'fixed' ? [{ id: 12n }] : []) },
  });

  const result = await service.copyExpenseFromPreviousMonth(BOOK_ID, '2026-06');
  assert.equal(created.length, 1, 'chỉ chép khoản của loại cố định');
  assert.equal(created[0].categoryId, 12n);
  assert.equal(created[0].amount, 2000000n);
  assert.match(result.msg, /Đã chép 1 khoản chi cố định/);
});

test('HouseholdService.copyExpenseFromPreviousMonth: loại đã có khoản tháng này thì bỏ qua', async () => {
  let created = null;
  const service = new HouseholdService({
    householdExpense: {
      findMany: async ({ where, select }) => {
        if (select) return [{ categoryId: 12n }]; // tháng 6 đã ghi khoản của loại 12
        return where.month === '2026-05' ? [{ id: 1n, categoryId: 12n, amount: 2000000n, note: '' }] : [];
      },
      createMany: async ({ data }) => (created = data),
    },
    householdExpenseCategory: { findMany: async () => [{ id: 12n }] },
  });

  const result = await service.copyExpenseFromPreviousMonth(BOOK_ID, '2026-06');
  assert.equal(created, null, 'không tạo dòng trùng');
  assert.match(result.err, /không có khoản chi cố định nào mới/);
});

// ─── Khoản nợ đã xong ───

test('chi tiêu: khoản vừa khai chưa điền tiền KHÔNG bị coi là đã xong', () => {
  const book = ledger();
  book.debts = [...DEBTS, { ...DEBTS[0], id: 103n, name: 'Mới khai', initialAmount: 0n }];
  const fresh = debtOf(buildMonthReport(book), 'Mới khai');

  assert.equal(fresh.remaining, 0);
  assert.equal(fresh.settled, false, 'còn lại 0 vì chưa điền số tiền, không phải vì đã trả xong');
});

test('household view: khoản nợ đã xong gập xuống mục riêng, không nằm trong ô chọn khi khai chi', async () => {
  const book = ledger();
  // Trả nốt 900tr còn lại của khoản ngân hàng ⇒ tất toán.
  book.expenses.push(expense({ categoryId: 15n, amount: 900000000n, principal: 900000000n, debtId: 101n }));
  const report = buildMonthReport(book);
  const locals = { ...viewLocals('so-no'), report, book: { ...viewLocals('so-no').book, report } };
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), locals);

  assert.match(html, /✅ Đã xong/, 'phải có mục gập cho khoản đã tất toán');
  const openList = html.slice(html.indexOf('Mình đang nợ ai'), html.indexOf('✅ Đã xong'));
  assert.doesNotMatch(openList, /Vay ngân hàng/, 'khoản đã xong không còn ở danh sách đang theo dõi');

  // Ô chọn khoản nợ ở mục khai chi cũng không được đề nghị khoản đã xong nữa.
  const chi = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), { ...locals, section: 'chi', path: '/household/chi' });
  const debtSelect = chi.split('name="debtId"')[1].split('</select>')[0];
  assert.doesNotMatch(debtSelect, /Vay ngân hàng/);
});

test('household view: form sửa khoản nợ không còn ô Trạng thái vô nghĩa', async () => {
  const html = await renderSection('so-no');
  assert.doesNotMatch(html, /Tạm dừng/, 'nút không tác động tới con số nào thì đừng để trên màn hình');
  assert.doesNotMatch(html, /name="active"/);
});

// ─── Khoản cố định: dự kiến vs đã chi thật ───

/** Prisma giả cho phần ghi khoản chi cố định, có sẵn quỹ "Tiết kiệm du lịch". */
function fixedExpensePrisma(over = {}) {
  const created = [];
  return {
    created,
    prisma: {
      householdExpenseCategory: {
        findFirst: async ({ where }) => {
          if (where.kind === 'saving') return over.jar === null ? null : { id: 99n };
          return where.id === 12n ? { id: 12n, kind: 'fixed' } : null;
        },
        create: async () => ({ id: 99n }),
      },
      householdExpense: { create: async ({ data }) => created.push(data) },
    },
  };
}

test('HouseholdService.addExpense: khoản cố định lưu cả mức dự kiến lẫn tiền đã chi thật', async () => {
  const { created, prisma } = fixedExpensePrisma();
  const service = new HouseholdService(prisma);

  await service.addExpense(BOOK_ID, { categoryId: '12', amount: '2,000,000', actualAmount: '1,500,000', occurredAt: '2026-06-05' });

  assert.equal(created[0].amount, 1500000n, 'amount LUÔN là tiền đã chi thật');
  assert.equal(created[0].plannedAmount, 2000000n, 'mức dự kiến lưu riêng để còn đối chiếu');
});

test('HouseholdService.addExpense: phần dư KHÔNG được ghi thành dòng chi nào', async () => {
  const { created, prisma } = fixedExpensePrisma();
  const service = new HouseholdService(prisma);

  const result = await service.addExpense(BOOK_ID, { categoryId: '12', amount: '2000000', actualAmount: '1500000', occurredAt: '2026-06-05' });

  assert.equal(created.length, 1, 'chỉ đúng MỘT dòng: khoản chi thật. Phần dư là số tự tính.');
  assert.equal(created[0].amount, 1500000n);
  assert.equal(created[0].plannedAmount, 2000000n, 'mức dự kiến lưu lại để công thức suy ra phần dư');
  assert.match(result.msg, /quỹ du lịch/, 'vẫn báo cho người dùng biết phần dư đi đâu');
});

test('HouseholdService.addExpense: chi VƯỢT dự kiến thì quỹ du lịch không bị trừ âm', async () => {
  const { created, prisma } = fixedExpensePrisma();
  const service = new HouseholdService(prisma);

  await service.addExpense(BOOK_ID, { categoryId: '12', amount: '2000000', actualAmount: '2500000', occurredAt: '2026-06-05' });
  assert.equal(created[0].amount, 2500000n);

  const book = ledger();
  book.expenses.push(expense({ categoryId: 12n, amount: 2500000n, plannedAmount: 2000000n }));
  assert.equal(buildMonthReport(book).travelAllTime, 0, 'chi vượt thì phần dư là 0, không phải số âm');
});

test('household view: mục chi có ô "đã chi thực tế" chỉ dành cho loại cố định', async () => {
  const html = await renderSection('chi');

  assert.match(html, /name="actualAmount"/);
  assert.match(html, /data-entry-actual/, 'phải có mốc để JS chỉ hiện ô này với loại cố định');
  assert.match(html, /data-amount-label/, 'nhãn ô số tiền đổi thành "dự kiến" khi chọn loại cố định');
});

// ─── Quỹ du lịch (số SUY RA) ───

/**
 * Quỹ du lịch KHÔNG có dòng nào trong sổ: nó cộng từ phần dư (dự kiến − đã chi) của mọi khoản
 * cố định, và trừ đi các khoản chi khai vào loại tên "Tiết kiệm du lịch".
 */
function travelBook(over = {}) {
  const book = ledger(over);
  book.expenseCategories = [...EXPENSE_CATEGORIES, { id: 20n, name: 'Tiết kiệm du lịch', kind: 'variable', active: true, note: '' }];
  return book;
}

test('chi tiêu: quỹ du lịch cộng phần dư của khoản cố định, không cần dòng ghi nào', () => {
  const book = travelBook();
  book.expenses.push(expense({ month: '2026-05', categoryId: 12n, amount: 1500000n, plannedAmount: 2000000n }));
  book.expenses.push(expense({ categoryId: 12n, amount: 800000n, plannedAmount: 1000000n }));

  const report = buildMonthReport(book);
  assert.equal(report.travelAllTime, 700000, '500k của tháng 5 + 200k của tháng 6');
  assert.equal(report.travelYear, 2026);
});

test('chi tiêu: tiêu vào loại "Tiết kiệm du lịch" thì quỹ bị TRỪ', () => {
  const book = travelBook();
  book.expenses.push(expense({ categoryId: 12n, amount: 1500000n, plannedAmount: 2000000n }));
  book.expenses.push(expense({ categoryId: 20n, amount: 300000n }));

  assert.equal(buildMonthReport(book).travelAllTime, 200000, '500k dư − 300k đã tiêu');
});

test('chi tiêu: "còn du lịch năm ..." chỉ tính trong NĂM đó, tổng luỹ kế thì tính hết', () => {
  const book = travelBook();
  book.expenses.push(expense({ month: '2025-11', categoryId: 12n, amount: 0n, plannedAmount: 1000000n }));
  book.expenses.push(expense({ categoryId: 12n, amount: 600000n, plannedAmount: 1000000n }));

  const report = buildMonthReport(book);
  assert.equal(report.travelThisYear, 400000, 'chỉ phần dư sinh trong năm 2026');
  assert.equal(report.travelAllTime, 1400000, 'gồm cả 1tr của năm 2025');
});

test('chi tiêu: quỹ du lịch KHÔNG đụng tới ô 🐷 Tiết kiệm đang có', () => {
  const book = travelBook();
  const base = buildMonthReport(book);
  book.expenses.push(expense({ categoryId: 12n, amount: 1500000n, plannedAmount: 2000000n }));
  const report = buildMonthReport(book);

  assert.equal(report.travelAllTime, 500000);
  assert.equal(report.savingBalance, base.savingBalance, 'ô 🐷 chỉ đếm tiền đã CẤT ĐI thật');
});

/**
 * Tiền của quỹ du lịch vẫn nằm trong "còn lại" — nó chỉ là phần đã đánh dấu để dành, chưa rời
 * khỏi ví. Đẳng thức tiền mặt vì thế không được đụng tới quỹ này.
 */
test('chi tiêu: quỹ du lịch là số đánh dấu, không làm lệch phép tính tiền mặt', () => {
  const book = travelBook();
  book.expenses.push(expense({ categoryId: 12n, amount: 1500000n, plannedAmount: 2000000n }));
  const r = buildMonthReport(book);

  assert.equal(r.leftover, r.income + r.savingOut - r.expense - r.savingIn, 'còn lại = thu + rút − chi − gửi');
  assert.ok(r.travelAllTime > 0, 'quỹ có tiền nhưng không xuất hiện trong đẳng thức trên');
});

// ─── Sửa khoản đã ghi ───

test('HouseholdService.updateExpense: ghi đè đúng dòng, vẫn lọc theo id sổ', async () => {
  const where = [];
  let saved = null;
  const service = new HouseholdService({
    householdExpense: {
      findFirst: async ({ where: w }) => {
        where.push(w);
        return w.householdId === BOOK_ID ? { id: 5n, month: '2026-06' } : null;
      },
      updateMany: async ({ where: w, data }) => {
        where.push(w);
        saved = data;
        return { count: 1 };
      },
    },
    householdExpenseCategory: { findFirst: async ({ where: w }) => ({ id: w.id, kind: 'variable' }) },
  });

  const result = await service.updateExpense(BOOK_ID, 5n, { categoryId: '11', amount: '750000', occurredAt: '2026-06-09', note: 'sửa lại' });
  assert.equal(result.err, undefined);
  assert.equal(saved.amount, 750000n);
  assert.equal(saved.note, 'sửa lại');
  for (const w of where) assert.equal(w.householdId, BOOK_ID, 'mọi truy vấn đều kèm id sổ');
});

test('HouseholdService.updateExpense: không sửa được dòng của sổ khác', async () => {
  const service = new HouseholdService({
    householdExpense: { findFirst: async ({ where }) => (where.householdId === BOOK_ID ? { id: 5n, month: '2026-06' } : null) },
    householdExpenseCategory: { findFirst: async () => ({ id: 11n, kind: 'variable' }) },
  });

  const result = await service.updateExpense(2, 5n, { categoryId: '11', amount: '750000', occurredAt: '2026-06-09' });
  assert.match(result.err, /Không tìm thấy khoản chi/);
});

test('HouseholdService.updateExpense: dùng lại đúng bộ kiểm của lúc ghi mới', async () => {
  const service = new HouseholdService({
    householdExpense: { findFirst: async () => ({ id: 5n, month: '2026-06' }) },
    householdExpenseCategory: { findFirst: async ({ where }) => (where.id === 15n ? { id: 15n, kind: 'debt' } : null) },
    householdDebt: { findFirst: async () => null },
  });

  // Loại trả nợ mà không chọn được khoản nợ hợp lệ ⇒ từ chối, y như lúc ghi mới.
  const result = await service.updateExpense(BOOK_ID, 5n, { categoryId: '15', debtId: '999', principal: '1000', occurredAt: '2026-06-09' });
  assert.match(result.err, /chọn khoản nợ/i);
});

test('household view: dòng khoản thu/chi bấm vào là mở form sửa, không còn nút Xoá lộ thiên', async () => {
  for (const [section, action] of [['thu', 'income'], ['chi', 'expenses']]) {
    const html = await renderSection(section);
    assert.match(html, /class="hh-entry"/, `mục ${section} phải dùng dòng bấm được`);
    assert.match(html, new RegExp(`action="/household/${action}/1"`), `mục ${section} thiếu form sửa`);
    assert.match(html, new RegExp(`action="/household/${action}/1/delete"`), `mục ${section} thiếu nút xoá trong form`);
    // Nút Xoá chỉ được nằm BÊN TRONG phần thân đã mở, không nằm ở dòng tóm tắt.
    const summaries = html.match(/<summary>[\s\S]*?<\/summary>/g) || [];
    assert.ok(summaries.length > 0, `mục ${section} phải có dòng tóm tắt`);
    for (const summary of summaries) {
      assert.doesNotMatch(summary, /btn-danger/, `mục ${section} còn nút xoá ngay trên dòng tóm tắt`);
    }
  }
});

test('household view: tổng quan có ô "Còn du lịch năm ..."', async () => {
  const html = await renderSection('tong-quan');
  assert.match(html, /Còn du lịch năm 2026/);
});


// ─── Hai loại phần trăm, đừng lẫn ───

/**
 * CA THẬT (31/7/2026): chủ sổ khai Dự phòng dự kiến 3tr, đã chi 2tr, và thấy cột "Tỷ trọng"
 * ghi 100% — hiểu nhầm thành "đã tiêu hết quỹ 3tr". Con số đúng về số học (2tr là khoản chi
 * DUY NHẤT của tháng nên chiếm 100% tổng chi) nhưng CÁI NHÃN sai. Nay tách hai số rõ ràng.
 */
test('chi tiêu: "% tổng chi" và "đã dùng bao nhiêu mức dự kiến" là HAI số khác nhau', () => {
  const book = ledger({ incomes: [], expenses: [] });
  book.expenses.push(expense({ categoryId: 12n, amount: 2000000n, plannedAmount: 3000000n }));
  const [row] = buildMonthReport(book).expenseByCategory;

  assert.equal(row.amount, 2000000);
  assert.equal(row.planned, 3000000);
  assert.equal(row.share, 100, 'khoản chi duy nhất của tháng ⇒ chiếm 100% TỔNG CHI');
  assert.equal(row.usedPercent, 67, 'nhưng mới dùng 2tr/3tr mức dự kiến ⇒ 67%');
});

test('chi tiêu: loại không đặt mức dự kiến thì không có phần trăm "đã dùng"', () => {
  const row = buildMonthReport(ledger()).expenseByCategory.find((r) => r.name === 'Ăn uống');

  assert.equal(row.planned, 0);
  assert.equal(row.usedPercent, 0, 'không đặt mức thì không bịa ra tỷ lệ nào');
});

test('chi tiêu: chi vượt mức dự kiến thì "đã dùng" quá 100%', () => {
  const book = ledger({ incomes: [], expenses: [] });
  book.expenses.push(expense({ categoryId: 12n, amount: 2500000n, plannedAmount: 2000000n }));
  const [row] = buildMonthReport(book).expenseByCategory;

  assert.equal(row.usedPercent, 125);
});

test('household view: bảng chi theo loại chỉ còn "đã dùng", bỏ hẳn cột tỷ trọng', async () => {
  const book = ledger();
  book.expenses.push(expense({ categoryId: 12n, amount: 2000000n, plannedAmount: 3000000n }));
  const report = buildMonthReport(book);
  const base = viewLocals('tong-quan');
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), {
    ...base,
    report,
    book: { ...base.book, report },
  });

  assert.match(html, /Đã dùng/, 'phải có cột đã dùng bao nhiêu mức dự kiến');
  assert.match(html, /của 3000000đ/, 'ghi rõ đang so với mức dự kiến nào');
  // Cột tỷ trọng (chiếm bao nhiêu phần tổng chi tháng) đã bỏ — chủ sổ thấy rối, và với sổ
  // chỉ có một loại thì nó luôn là 100%, chẳng nói lên điều gì.
  assert.doesNotMatch(html, /<th>Tỷ trọng<\/th>|% tổng chi|% tổng thu/, 'không còn cột tỷ trọng');
});

/**
 * Chủ sổ chốt bỏ HẾT các khối hướng dẫn cách dùng (31/7/2026). Giữ lại đúng bốn thứ có việc
 * thật: phản hồi sau thao tác, ô trống chỉ đường, cảnh báo thiếu API key, và khung phân quyền.
 */
test('household view: không còn khối hướng dẫn cách dùng nào', async () => {
  const FORBIDDEN = [
    /khai <strong>mức dự kiến<\/strong>/,
    /Chỉ chép loại/,
    /Sổ nợ chỉ <strong>khai<\/strong>/,
    /Khai xong mới ghi tiền trả/,
    /không bao giờ tự ghi/,
    /metric-drop-note/,
    /Thiếu bên nào thì chưa/,
  ];
  for (const section of SECTIONS) {
    const html = await renderSection(section);
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(html, pattern, `mục ${section} còn khối hướng dẫn: ${pattern}`);
    }
  }

  // Nhưng những thứ CÓ VIỆC THẬT thì phải còn.
  const chi = await renderSection('chi', { book: { ...viewLocals('chi').book, expenseCategories: [] } });
  assert.match(chi, /Chưa có loại chi phí nào/, 'ô trống phải chỉ được đường đi tiếp');
  const troLy = await renderSection('tro-ly', { aiConfigured: false });
  assert.match(troLy, /GROQ_API_KEY/, 'cảnh báo cấu hình thật thì giữ');
});

/**
 * CA THẬT (31/7/2026): đổi quy tắc "bỏ trống ô đã chi" từ *chi đúng dự kiến* sang *đã chi 0đ*
 * ở service, nhưng quên chữ trong `placeholder` của chính ô đó — màn hình nói một đằng, code
 * làm một nẻo. Chủ sổ tự phát hiện. Test này khoá lại: không ô nào được HỨA một hành vi khác
 * với hành vi thật.
 */
test('household view: không còn chữ nào hứa "bỏ trống = đúng dự kiến"', async () => {
  for (const section of SECTIONS) {
    const html = await renderSection(section);
    assert.doesNotMatch(html, /đúng dự kiến/i, `mục ${section} còn hứa hành vi cũ`);
  }

  // Và hành vi thật đúng là 0đ — kiểm thẳng ở service để hai bên không lệch nhau lần nữa.
  let saved = null;
  const service = new HouseholdService({
    householdExpenseCategory: { findFirst: async ({ where }) => ({ id: where.id, kind: 'fixed' }) },
    householdExpense: { create: async ({ data }) => (saved = data) },
  });
  await service.addExpense(BOOK_ID, { categoryId: '12', amount: '2000000', occurredAt: '2026-06-05' });
  assert.equal(saved.amount, 0n, 'bỏ trống ô "đã chi" là 0đ, đúng như màn hình không hứa gì khác');
});
