const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const { HouseholdService } = require('../dist/household/household.service');

const root = path.join(__dirname, '..');
const day = (iso) => new Date(`${iso}T00:00:00Z`);

/**
 * Prisma giả cho module chi tiêu: chỉ trả về đúng những gì `summary()` / `monthBook()` đọc.
 * Không mô phỏng ghi dữ liệu — phần đó đã đơn giản (create/delete thẳng).
 */
function makePrisma({ config, members = [], txns = [], incomes = [], allocations = [] }) {
  return {
    householdConfig: { findUnique: async () => config, create: async () => config },
    householdMember: { findMany: async () => members },
    householdTxn: { findMany: async () => txns },
    householdIncome: {
      aggregate: async () => ({ _sum: { amount: BigInt(incomes.reduce((t, i) => t + Number(i.amount), 0)) } }),
      findMany: async ({ where, distinct } = {}) => {
        if (distinct) return [...new Set(incomes.map((i) => i.month))].map((month) => ({ month }));
        return incomes.filter((i) => !where?.month || i.month === where.month);
      },
    },
    householdAllocation: {
      findMany: async ({ where, distinct } = {}) => {
        if (distinct) return [...new Set(allocations.map((a) => a.month))].map((month) => ({ month }));
        return allocations.filter((a) => !where?.month || a.month === where.month);
      },
    },
  };
}

const CONFIG = {
  id: 1,
  weeklyAllowance: 500000n,
  weekStartDow: 1,
  anchorDate: day('2026-07-06'), // thứ Hai
};

const member = (over) => ({
  id: 1n,
  name: 'Chồng',
  cycle: 'weekly',
  allowance: null,
  startedOn: day('2026-07-06'),
  active: true,
  sortOrder: 1,
  ...over,
});

/** Đầu tuần hiện tại, dùng để dựng giao dịch "trong kỳ này" bất kể chạy test ngày nào. */
function thisWeekStart() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() - 1 + 7) % 7)); // tuần bắt đầu thứ Hai
  return d;
}

test('HouseholdService: ví tuần KHÔNG cộng dồn — chỉ trừ khoản chi của tuần hiện tại', async () => {
  const wk = thisWeekStart();
  const lastWeek = new Date(wk.getTime() - 3 * 24 * 3600 * 1000);
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({})],
      txns: [
        { amount: 120000n, memberId: 1n, occurredAt: new Date(wk.getTime() + 3600 * 1000) }, // tuần này
        { amount: 400000n, memberId: 1n, occurredAt: lastWeek }, // tuần trước — không ảnh hưởng ví tuần này
      ],
    }),
  );

  const [wallet] = (await service.summary()).wallets;
  assert.equal(wallet.allowance, 500000);
  assert.equal(wallet.spentThisPeriod, 120000);
  assert.equal(wallet.remaining, 380000, 'ví = 500k − chi tuần này, không cộng dồn phần dư tuần trước');
  assert.equal(wallet.spentTotal, 520000);
  assert.equal(wallet.periodLabel, 'Tuần này');
  assert.equal(wallet.overspend, 0, 'không tuần nào tiêu quá 500k');
});

test('HouseholdService: tiêu quá ví thì nhà phải bù, trừ tiếp vào quỹ chung', async () => {
  const wk = thisWeekStart();
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({})],
      txns: [{ amount: 700000n, memberId: 1n, occurredAt: new Date(wk.getTime() + 3600 * 1000) }],
      incomes: [{ month: '2026-07', amount: 30000000n }],
    }),
  );

  const summary = await service.summary();
  const [wallet] = summary.wallets;
  assert.equal(wallet.remaining, -200000);
  assert.equal(wallet.overspend, 200000);
  assert.equal(summary.overspendTotal, 200000);
  assert.equal(
    summary.potBalance,
    30000000 - summary.allowanceBudget - 200000,
    'quỹ chung chịu cả phần tiền tiêu đã trích lẫn phần bù vượt ví',
  );
});

test('HouseholdService: con nhận theo tháng, phần ngân sách tuần dư vào quỹ tiết kiệm của con', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({ id: 3n, name: 'Con zai', cycle: 'monthly', allowance: null })],
    }),
  );

  const [kid] = (await service.summary()).wallets;
  assert.equal(kid.periodLabel, 'Tháng này');
  assert.equal(kid.rollover, true, 'ví của con cộng dồn qua các tháng');
  assert.equal(kid.allowance, 500000, 'con cầm tay 500k cho cả tháng');
  assert.equal(kid.weeklyBudget, 500000, 'nhà vẫn dành mức tuần chuẩn cho con');
  assert.equal(kid.budgetTotal, kid.weeks * 500000);
  assert.equal(kid.handedTotal, kid.months * 500000);
  assert.equal(kid.kidSavings, 500000 * (kid.weeks - kid.months));
  assert.ok(kid.weeks > kid.months, 'số tuần luôn nhiều hơn số tháng nên quỹ của con luôn lớn dần');
});

test('HouseholdService: con tiêu không hết thì phần thừa dồn sang tháng sau', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({ id: 3n, name: 'Con zai', cycle: 'monthly' })],
      txns: [{ amount: 200000n, memberId: 3n, occurredAt: new Date() }],
    }),
  );

  const [kid] = (await service.summary()).wallets;
  assert.equal(kid.remaining, kid.handedTotal - 200000, 'ví = tổng đã nhận − tổng đã tiêu, không reset theo tháng');
  assert.ok(kid.remaining > 0);
  assert.equal(kid.kidShortfall, 0);
  assert.equal(kid.kidSavings, 500000 * (kid.weeks - kid.months), 'chưa tiêu lẹm thì quỹ tiết kiệm nguyên vẹn');
  assert.equal(kid.overspend, 0, 'nhà chưa phải bù đồng nào');
});

test('HouseholdService: con tiêu quá phần cầm tay thì trừ vào quỹ tiết kiệm của chính con', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({ id: 3n, name: 'Con zai', cycle: 'monthly' })],
      incomes: [{ month: '2026-07', amount: 30000000n }],
      txns: [{ amount: 900000n, memberId: 3n, occurredAt: new Date() }],
    }),
  );

  const summary = await service.summary();
  const [kid] = summary.wallets;
  const over = 900000 - kid.handedTotal; // phần vượt quá tiền cầm tay

  assert.ok(over > 0, 'kịch bản phải thực sự vượt phần cầm tay');
  assert.equal(kid.remaining, -over);
  assert.equal(kid.kidShortfall, over);
  assert.equal(kid.kidSavings, 500000 * (kid.weeks - kid.months) - over, 'tiêu quá ⇒ tiết kiệm ít đi đúng bằng phần vượt');
  assert.equal(kid.overspend, 0, 'quỹ của con còn đủ nên nhà chưa phải bù');
  assert.equal(summary.potBalance, 30000000 - summary.allowanceBudget, 'quỹ chung không đổi vì con tự gánh');
});

test('HouseholdService: con tiêu vượt cả quỹ tiết kiệm thì nhà mới phải bù', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({ id: 3n, name: 'Con zai', cycle: 'monthly' })],
      incomes: [{ month: '2026-07', amount: 30000000n }],
      txns: [{ amount: 99000000n, memberId: 3n, occurredAt: new Date() }],
    }),
  );

  const summary = await service.summary();
  const [kid] = summary.wallets;
  assert.equal(kid.kidSavings, 0, 'quỹ của con cạn sạch');
  assert.equal(kid.overspend, 99000000 - kid.budgetTotal, 'phần vượt cả ngân sách nhà dành mới là nhà bù');
  assert.equal(summary.potBalance, 30000000 - summary.allowanceBudget - summary.overspendTotal);
});

test('HouseholdService: người tạm dừng và người bắt đầu muộn không được trích tiền sai', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [
        member({ id: 1n, name: 'Chồng' }),
        member({ id: 2n, name: 'Bà ngoại', startedOn: day('2099-01-01') }),
        member({ id: 3n, name: 'Con zai', active: false }),
      ],
    }),
  );
  const summary = await service.summary();
  const [husband, future, paused] = summary.wallets;

  assert.ok(husband.weeks >= 1);
  assert.equal(future.weeks, 0, 'chưa tới ngày bắt đầu thì chưa trích đồng nào');
  assert.equal(future.budgetTotal, 0);
  assert.equal(paused.weeks, 0, 'tạm dừng thì ngừng trích tiền tuần');
  assert.equal(summary.weeklyPayout, 1000000, 'chỉ tính người đang nhận');
});

test('HouseholdService: sổ tháng tự trích tiền tiêu cả nhà, không cần nhập tay', async () => {
  const service = new HouseholdService(
    makePrisma({
      config: CONFIG,
      members: [member({ id: 1n, name: 'Chồng' }), member({ id: 2n, name: 'Vợ' })],
      incomes: [
        { id: 1n, month: '2026-07', source: 'Lương chồng', amount: 18000000n, note: '' },
        { id: 2n, month: '2026-07', source: 'Lương vợ', amount: 12000000n, note: '' },
        { id: 3n, month: '2026-06', source: 'Lương chồng', amount: 17000000n, note: '' },
      ],
      allocations: [{ id: 1n, month: '2026-07', kind: 'savings', name: 'Tiết kiệm', amount: 6000000n, note: '' }],
    }),
  );

  const book = await service.monthBook('2026-07');
  assert.equal(book.incomes.length, 2, 'chỉ lấy khoản thu của đúng tháng');
  assert.equal(book.incomeTotal, 30000000);
  assert.equal(book.manualAllocationTotal, 6000000);
  // Tháng 7/2026 có 4 ngày thứ Hai (6, 13, 20, 27) ⇒ 2 người × 4 tuần × 500k.
  assert.equal(book.weeksInMonth, 4);
  assert.equal(book.allowanceCost, 4000000);
  assert.equal(book.allocationTotal, 10000000);
  assert.equal(book.leftover, 20000000, 'còn lại = thu − trích tay − tiền tiêu tự trích');
  assert.ok(book.months.includes('2026-06') && book.months.includes('2026-07'));

  // Tháng sai định dạng thì rơi về tháng hiện tại thay vì nổ.
  assert.match((await service.monthBook('linh tinh')).month, /^\d{4}-\d{2}$/);
});

function viewLocals(section, over = {}) {
  const summary = {
    defaultWeeklyAllowance: 500000,
    weekStartDow: 1,
    anchorDate: CONFIG.anchorDate,
    wallets: [
      { id: 1n, name: 'Chồng', active: true, cycle: 'weekly', allowance: 500000, weeklyBudget: 500000, hasOwnRate: false, startedOn: CONFIG.anchorDate, weeks: 4, months: 1, budgetTotal: 2000000, periodLabel: 'Tuần này', rollover: false, handedTotal: 2000000, spentThisPeriod: 380000, remaining: 120000, spentTotal: 900000, overspend: 0, kidSavings: 0, kidShortfall: 0 },
      { id: 3n, name: 'Con zai', active: true, cycle: 'monthly', allowance: 500000, weeklyBudget: 500000, hasOwnRate: false, startedOn: CONFIG.anchorDate, weeks: 4, months: 1, budgetTotal: 2000000, periodLabel: 'Tháng này', rollover: true, handedTotal: 500000, spentThisPeriod: 200000, remaining: 300000, spentTotal: 200000, overspend: 0, kidSavings: 1500000, kidShortfall: 0 },
    ],
    weeklyPayout: 1000000,
    totalIncome: 30000000,
    manualAllocation: 8000000,
    savingsTotal: 5000000,
    debtTotal: 3000000,
    otherAllocationTotal: 0,
    allowanceBudget: 4000000,
    kidSavingsTotal: 1500000,
    commonSpent: 1000000,
    overspendTotal: 0,
    potBalance: 17000000,
    spentThisWeek: 380000,
    spentThisMonth: 1100000,
    spentTotal: 1100000,
  };
  return {
    currentUser: { role: 'ADMIN', displayName: 'Admin', email: 'admin@test' },
    featureSet: new Set(['HOUSEHOLD']),
    isRoot: true,
    path: section === 'tong-quan' ? '/household' : `/household/${section}`,
    formatMoney: (value) => String(Math.round(Number(value) || 0)),
    section,
    config: { ...CONFIG },
    summary,
    members: [
      { id: 1n, name: 'Chồng', cycle: 'weekly', allowance: null, startedOn: CONFIG.anchorDate, active: true },
      { id: 3n, name: 'Con zai', cycle: 'monthly', allowance: null, startedOn: CONFIG.anchorDate, active: true },
    ],
    txns: [
      { id: 1n, amount: 120000n, memberId: 1n, occurredAt: day('2026-07-20'), description: 'Cà phê', member: { name: 'Chồng' } },
      { id: 2n, amount: 900000n, memberId: null, occurredAt: day('2026-07-19'), description: 'Tiền điện', member: null },
    ],
    book: {
      month: '2026-07',
      incomes: [{ id: 1n, source: 'Lương chồng', amount: 18000000n, note: '' }],
      allocations: [{ id: 1n, kind: 'savings', name: 'Tiết kiệm', amount: 6000000n, note: '' }],
      incomeTotal: 18000000,
      allocationTotal: 10000000,
      manualAllocationTotal: 6000000,
      allowanceCost: 4000000,
      weeksInMonth: 4,
      leftover: 8000000,
      months: ['2026-07', '2026-06'],
    },
    msg: '',
    err: '',
    ...over,
  };
}

test('household view renders all sections without email-scan leftovers', async () => {
  for (const section of ['tong-quan', 'thu-nhap', 'chi-tieu', 'cai-dat']) {
    const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals(section));
    assert.doesNotMatch(html, /VPBank|Gmail|Quét ngay|IMAP/i, `section ${section} còn sót phần quét email`);
    assert.doesNotMatch(html, /dư của mỗi người được/i, `section ${section} còn mô tả rollover cũ cho cả nhà`);
    assert.match(html, /Quản lý chi tiêu/);
  }
});

test('household view: tổng quan phân biệt ví tuần reset và ví tháng cộng dồn của con', async () => {
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals('tong-quan'));
  assert.match(html, /số dư tuần cũ bị xoá/i, 'ví hàng tuần phải nói rõ là reset');
  assert.match(html, /dồn sang tháng sau/i, 'ví của con phải nói rõ là cộng dồn');
  assert.match(html, /Quỹ tiết kiệm của con/i);
  assert.match(html, /1500000/, 'số dư quỹ của con phải hiện ra');
  assert.match(html, /còn trong ví \(dồn\)/i);
});

test('household view: thu & phân bổ hiện khoản tiền tiêu tự trích', async () => {
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals('thu-nhap'));
  assert.match(html, /tự trích/i);
  assert.match(html, /4 tuần trong tháng/);
});

test('household view: chi chung hiển thị tách khỏi ví cá nhân', async () => {
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals('chi-tieu'));
  assert.match(html, /Chi chung/, 'khoản không gắn người phải hiện là chi chung');
  assert.match(html, /19\/07\/2026/, 'ngày hiển thị theo giờ Việt Nam, không lùi 1 ngày');
});

test('household view: cài đặt cho chọn chu kỳ tuần/tháng', async () => {
  const html = await ejs.renderFile(path.join(root, 'src/views/household/index.ejs'), viewLocals('cai-dat'));
  assert.match(html, /name="cycle"/);
  assert.match(html, /Hàng tháng \(con\)/);
});
