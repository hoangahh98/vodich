const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const { matchSnapshot } = require('./helpers/snapshot');

const root = path.join(__dirname, '..');
const renderView = (view, locals) => ejs.renderFile(path.join(root, 'src/views', view), locals);

/**
 * Snapshot GIAO DIỆN THEO QUYỀN.
 *
 * Ẩn nút không phải là bảo mật — phần chặn thật nằm ở FeatureGuard (xem
 * authorization.test.js). Nhưng nút hiện SAI vẫn là lỗi thật: người dùng bấm vào rồi
 * ăn 403, hoặc tệ hơn là lộ ra sự tồn tại của module họ không được vào. Bộ snapshot này
 * khoá lại chính xác những gì từng vai nhìn thấy, để một thay đổi vô tình ở view lộ ra ngay.
 */

const formatMoney = (value) => String(Math.round(Number(value) || 0));

function locals(over = {}) {
  return {
    currentUser: { id: '7', role: 'ADMIN', displayName: 'Admin', email: 'admin@test' },
    featureSet: new Set(),
    isRoot: false,
    path: '/',
    formatMoney,
    ...over,
  };
}

const ROLES = [
  {
    name: 'client',
    mo_ta: 'vận động viên: chỉ giải đấu, đội bóng, du lịch',
    locals: locals({
      currentUser: { id: '77', role: 'CLIENT', displayName: 'Vận động viên', email: 'vdv@test' },
      featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL']),
    }),
  },
  {
    name: 'admin-han-che',
    mo_ta: 'admin chỉ được cấp TEAMS',
    locals: locals({
      currentUser: { id: '20', role: 'ADMIN', displayName: 'Bob', email: 'bob' },
      featureSet: new Set(['TEAMS']),
    }),
  },
  {
    name: 'admin-goc',
    mo_ta: 'admin gốc: thấy hết, kể cả Phân quyền và Log',
    locals: locals({
      currentUser: { id: '1', role: 'ADMIN', displayName: 'Admin gốc', email: 'admin' },
      featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'MEDICAL', 'HOUSEHOLD', 'PERMISSIONS']),
      isRoot: true,
    }),
  },
];

for (const role of ROLES) {
  test(`snapshot trang chủ — ${role.mo_ta}`, async () => {
    matchSnapshot(`home-${role.name}`, await renderView('home.ejs', role.locals));
  });
}

test('snapshot trang lỗi 403', async () => {
  matchSnapshot('error-403', await renderView('error.ejs', locals({ message: 'Không có quyền' })));
});

test('snapshot trang phân quyền của admin gốc', async () => {
  const html = await renderView('permissions.ejs', {
    ...locals({ isRoot: true, featureSet: new Set(['PERMISSIONS']), path: '/permissions' }),
    admins: [
      { id: 2n, username: 'subadmin', displayName: 'Sub Admin', permissions: [{ feature: 'TEAMS' }] },
      { id: 3n, username: 'ketoan', displayName: 'Kế Toán', permissions: [] },
    ],
    features: ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'MEDICAL', 'HOUSEHOLD'],
  });
  matchSnapshot('permissions-admin-goc', html);
});

// ─── Sổ chi tiêu: chủ sổ thấy khung phân quyền, người được mời thì không ───

function householdLocals(over = {}) {
  const currentBook = {
    id: 1,
    name: 'Sổ chi tiêu gia đình',
    ownerAdminId: 7n,
    ownerAdmin: { id: 7n, username: 'admin', displayName: 'Admin' },
    permissions: [{ id: 5n, admin: { id: 9n, username: 'subadmin', displayName: 'Sub Admin' } }],
  };
  const anchorDate = new Date('2026-07-06T00:00:00Z');
  return {
    ...locals({ featureSet: new Set(['HOUSEHOLD']), path: '/household/cai-dat' }),
    section: 'cai-dat',
    config: { id: 1, weeklyAllowance: 500000n, weekStartDow: 1, anchorDate },
    summary: {
      defaultWeeklyAllowance: 500000,
      weekStartDow: 1,
      anchorDate,
      wallets: [],
      weeklyPayout: 0,
      totalIncome: 0,
      manualAllocation: 0,
      savingsTotal: 0,
      debtTotal: 0,
      otherAllocationTotal: 0,
      allowanceBudget: 0,
      kidSavingsTotal: 0,
      commonSpent: 0,
      overspendTotal: 0,
      potBalance: 0,
      spentThisWeek: 0,
      spentThisMonth: 0,
      spentTotal: 0,
    },
    members: [{ id: 1n, name: 'Chồng', cycle: 'weekly', allowance: null, startedOn: anchorDate, active: true }],
    txns: [],
    book: {
      month: '2026-07',
      incomes: [],
      allocations: [],
      incomeTotal: 0,
      allocationTotal: 0,
      manualAllocationTotal: 0,
      allowanceCost: 0,
      weeksInMonth: 4,
      leftover: 0,
      months: ['2026-07'],
    },
    books: [currentBook],
    currentBook,
    isOwner: true,
    admins: [{ id: 9n, username: 'other', displayName: 'Admin Khác' }],
    msg: '',
    err: '',
    ...over,
  };
}

test('snapshot cài đặt sổ chi tiêu — chủ sổ được cấp/gỡ quyền', async () => {
  matchSnapshot('household-caidat-chu-so', await renderView('household/index.ejs', householdLocals()));
});

test('snapshot cài đặt sổ chi tiêu — người được mời KHÔNG thấy khung phân quyền', async () => {
  const html = await renderView(
    'household/index.ejs',
    householdLocals({
      currentUser: { id: '9', role: 'ADMIN', displayName: 'Sub Admin', email: 'subadmin' },
      isOwner: false,
    }),
  );
  matchSnapshot('household-caidat-duoc-moi', html);
});
