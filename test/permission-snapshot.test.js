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
    mo_ta: 'vận động viên: chỉ giải đấu và đội bóng',
    locals: locals({
      currentUser: { id: '77', role: 'CLIENT', displayName: 'Vận động viên', email: 'vdv@test' },
      featureSet: new Set(['TOURNAMENTS', 'TEAMS']),
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
      featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'PERMISSIONS']),
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
    features: ['TOURNAMENTS', 'TEAMS', 'PERMISSIONS'],
  });
  matchSnapshot('permissions-admin-goc', html);
});

