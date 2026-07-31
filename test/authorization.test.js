const assert = require('node:assert/strict');
const test = require('node:test');

const { FeatureGuard } = require('../dist/common/feature.guard');
const { ownedOrSharedWhere, availableAdminsWhere, isRootAdmin } = require('../dist/common/admin-scope');
const { requireFeature, requireUser, safeNext, wantsJson } = require('../dist/common/controller-utils');
const { AuthService } = require('../dist/auth/auth.service');
const { TeamCrudService } = require('../dist/teams/team-crud.service');
const { TournamentCrudService } = require('../dist/tournaments/tournament-crud.service');
const { MedicalService } = require('../dist/medical/medical.service');
const { HouseholdService } = require('../dist/household/household.service');
const { HouseholdAccessService } = require('../dist/household/household-access.service');

/**
 * Test PHÂN QUYỀN và CHỐNG RÒ DỮ LIỆU giữa hai admin.
 *
 * Mô hình mối đe doạ: admin B đã đăng nhập hợp lệ, đoán/nhặt được id tài nguyên của
 * admin A rồi gọi thẳng URL. Ẩn nút trên giao diện không cản được gì — nên mọi khẳng
 * định ở đây đều nhắm vào TẦNG SERVER: câu truy vấn có kèm bộ lọc chủ sở hữu không,
 * và guard có chặn không.
 */

const ALICE = { id: '10', email: 'alice', displayName: 'Alice', role: 'ADMIN' };
const BOB = { id: '20', email: 'bob', displayName: 'Bob', role: 'ADMIN' };
const ROOT = { id: '1', email: 'admin', displayName: 'Admin gốc', role: 'ADMIN' };
const CLIENT = { id: '77', email: 'player@test', displayName: 'VĐV', role: 'CLIENT' };

/** Bắt lại mệnh đề `where` mà service gửi xuống Prisma để soi có lọc theo chủ sở hữu không. */
function spyPrisma(shape) {
  const calls = [];
  const record = (model, method) => async (args = {}) => {
    calls.push({ model, method, where: args.where });
    const handler = shape?.[model]?.[method];
    return typeof handler === 'function' ? handler(args) : handler;
  };
  const model = (name, methods) => Object.fromEntries(methods.map((m) => [m, record(name, m)]));
  return {
    calls,
    lastWhere: () => calls[calls.length - 1]?.where,
    teamClub: model('teamClub', ['findMany', 'findFirst', 'count', 'create', 'update']),
    teamMember: model('teamMember', ['groupBy', 'findMany']),
    tournament: model('tournament', ['findMany', 'findFirst', 'count', 'create']),
    medPatient: model('medPatient', ['findMany', 'findFirst']),
    householdConfig: model('householdConfig', ['findMany', 'findUnique', 'create']),
    householdIncomeCategory: model('householdIncomeCategory', ['findMany', 'findFirst', 'deleteMany', 'create', 'update']),
    householdExpenseCategory: model('householdExpenseCategory', ['findMany', 'findFirst', 'deleteMany', 'create', 'update']),
    householdIncome: model('householdIncome', ['findMany', 'findFirst', 'deleteMany', 'create', 'createMany']),
    householdExpense: model('householdExpense', ['findMany', 'findFirst', 'deleteMany', 'create']),
    householdDebt: model('householdDebt', ['findMany', 'findFirst', 'deleteMany', 'create', 'update']),
    householdChatMessage: model('householdChatMessage', ['findMany', 'createMany', 'deleteMany']),
    householdPermission: model('householdPermission', ['create', 'deleteMany']),
    appUser: model('appUser', ['findMany']),
  };
}

/** Mệnh đề where có ràng buộc "chủ sở hữu là adminId, hoặc đã được cấp quyền" không? */
function scopesToAdmin(where, adminId) {
  const or = where?.OR;
  if (!Array.isArray(or)) return false;
  const owner = or.some((clause) => clause.ownerAdminId === adminId);
  const shared = or.some((clause) => clause.permissions?.some?.adminId === adminId);
  return owner && shared;
}

// ─── Nền tảng: biểu thức lọc theo chủ sở hữu ───

test('ownedOrSharedWhere chỉ mở đúng dữ liệu của chính admin đó', () => {
  const where = ownedOrSharedWhere(ALICE);
  assert.ok(scopesToAdmin(where, 10n), 'phải lọc theo id của Alice');
  assert.ok(!scopesToAdmin(where, 20n), 'không được lọt sang id của Bob');
});

test('availableAdminsWhere loại admin gốc và chính chủ sở hữu khỏi danh sách mời', () => {
  const where = availableAdminsWhere(10n, { teamPermissions: { none: { teamId: 1n } } });
  assert.equal(where.role, 'ADMIN');
  assert.equal(where.username.not, 'admin', 'admin gốc vốn thấy hết, không cần mời');
  assert.deepEqual(where.id.notIn, [10n], 'chủ sở hữu không tự mời mình');
  assert.deepEqual(where.teamPermissions, { none: { teamId: 1n } });
});

test('isRootAdmin không nhầm CLIENT trùng tên với admin gốc', () => {
  assert.ok(isRootAdmin({ ...ROOT }));
  assert.ok(!isRootAdmin({ id: '99', email: 'admin', displayName: 'Giả mạo', role: 'CLIENT' }));
  assert.ok(!isRootAdmin(undefined));
});

// ─── Đội bóng: admin B không đọc/sửa được đội của admin A ───

test('TeamCrudService.list luôn lọc theo chủ sở hữu với admin thường', async () => {
  const prisma = spyPrisma({ teamClub: { findMany: async () => [] } });
  await new TeamCrudService(prisma).list(BOB);
  assert.ok(scopesToAdmin(prisma.lastWhere(), 20n), 'Bob chỉ được thấy đội của Bob');
});

test('TeamCrudService.canManage từ chối đội của admin khác', async () => {
  const prisma = spyPrisma({ teamClub: { count: async ({ where }) => (scopesToAdmin(where, 10n) ? 1 : 0) } });
  const service = new TeamCrudService(prisma);
  assert.equal(await service.canManage(ALICE, 5n), true, 'Alice quản được đội của mình');
  assert.equal(await service.canManage(BOB, 5n), false, 'Bob KHÔNG quản được đội của Alice');
});

test('TeamCrudService.canManage chặn thẳng vai CLIENT, không cần hỏi DB', async () => {
  const prisma = spyPrisma({ teamClub: { count: async () => 1 } });
  assert.equal(await new TeamCrudService(prisma).canManage(CLIENT, 5n), false);
  assert.equal(prisma.calls.length, 0, 'CLIENT bị chặn trước khi chạm DB');
});

test('TeamCrudService: admin gốc thấy mọi đội, admin thường thì không', async () => {
  const prisma = spyPrisma({ teamClub: { findMany: async () => [] } });
  const service = new TeamCrudService(prisma);
  await service.list(ROOT);
  assert.deepEqual(prisma.lastWhere(), {}, 'admin gốc không bị giới hạn');
  await service.list(ALICE);
  assert.ok(scopesToAdmin(prisma.lastWhere(), 10n));
});

// ─── Giải đấu ───

test('TournamentCrudService.canManage chỉ đúng với giải mình sở hữu hoặc được cấp quyền', async () => {
  const prisma = spyPrisma({ tournament: { count: async ({ where }) => (scopesToAdmin(where, 10n) ? 1 : 0) } });
  const service = new TournamentCrudService(prisma);
  assert.equal(await service.canManage(ALICE, 3n), true);
  assert.equal(await service.canManage(BOB, 3n), false);
});

test('TournamentCrudService.create đóng dấu người tạo, không nhận ownerAdminId từ form', async () => {
  let created;
  const prisma = spyPrisma({
    tournament: {
      create: async ({ data }) => {
        created = data;
        return { id: 1n };
      },
    },
  });
  // Kẻ tấn công cố nhét ownerAdminId của người khác vào body.
  await new TournamentCrudService(prisma).create({ name: 'Cúp', ownerAdminId: '10' }, BOB);
  assert.equal(created.ownerAdminId, 20n, 'chủ sở hữu lấy từ phiên đăng nhập, không lấy từ body');
});

// ─── Hồ sơ y tế: nhạy cảm nhất, admin gốc CŨNG không được xem hết ───

test('MedicalService.getPatient lọc theo quyền ngay trong câu truy vấn', async () => {
  const prisma = spyPrisma({ medPatient: { findFirst: async () => null } });
  await new MedicalService(prisma).getPatient(9n, BOB);
  const where = prisma.lastWhere();
  assert.equal(where.id, 9n);
  assert.ok(scopesToAdmin(where, 20n), 'id hồ sơ đi kèm bộ lọc quyền, không tra id trần');
});

test('MedicalService: admin gốc KHÔNG mặc nhiên xem được bệnh án nhà người khác', async () => {
  const prisma = spyPrisma({ medPatient: { findMany: async () => [] } });
  await new MedicalService(prisma).listPatients(ROOT);
  assert.ok(scopesToAdmin(prisma.lastWhere(), 1n), 'admin gốc vẫn phải được cấp quyền tường minh');
});

// ─── Sổ chi tiêu: bộ lọc theo sổ trong MỌI truy vấn ───

test('HouseholdService: mọi truy vấn đọc đều kèm householdId', async () => {
  const empty = { findMany: async () => [] };
  const prisma = spyPrisma({
    householdConfig: { findUnique: async () => ({ id: 1, anchorDate: new Date() }) },
    householdIncomeCategory: empty,
    householdExpenseCategory: empty,
    householdIncome: empty,
    householdExpense: empty,
    householdDebt: empty,
  });
  await new HouseholdService(prisma).book(1, '2026-06');
  const reads = prisma.calls.filter((c) => c.model !== 'householdConfig');
  assert.ok(reads.length >= 5, 'phải đọc đủ 5 bảng con của sổ');
  for (const call of reads) {
    assert.equal(call.where?.householdId, 1, `${call.model}.${call.method} thiếu bộ lọc householdId`);
  }
});

test('HouseholdService.deleteExpense không xoá được khoản chi của sổ khác', async () => {
  const prisma = spyPrisma({
    householdExpense: {
      findFirst: async ({ where }) => (where.householdId === 1 ? { id: 55n, month: '2026-06' } : null),
      deleteMany: async ({ where }) => ({ count: where.householdId === 1 ? 1 : 0 }),
    },
  });
  const service = new HouseholdService(prisma);

  assert.equal(await service.deleteExpense(1, 55n), '2026-06', 'xoá được khoản chi của chính sổ mình');
  assert.equal(prisma.lastWhere().householdId, 1, 'điều kiện xoá phải kèm id sổ');
  // Sổ khác: `findFirst` không thấy dòng nào nên không có lệnh xoá nào được phát ra.
  const before = prisma.calls.length;
  await service.deleteExpense(2, 55n);
  assert.ok(
    prisma.calls.slice(before).every((c) => c.where?.householdId === 2),
    'gửi id sổ khác thì mọi truy vấn vẫn bị khoá vào đúng sổ đó',
  );
});

test('HouseholdService.addExpense từ chối loại và khoản nợ không thuộc sổ này', async () => {
  let created = null;
  const prisma = spyPrisma({
    householdExpenseCategory: {
      findFirst: async ({ where }) => (where.householdId === 1 && where.id === 11n ? { id: 11n, kind: 'normal' } : null),
    },
    householdDebt: { findFirst: async ({ where }) => (where.householdId === 1 && where.id === 9n ? { id: 9n } : null) },
    householdExpense: {
      create: async ({ data }) => {
        created = data;
        return data;
      },
    },
  });
  const service = new HouseholdService(prisma);

  const ok = await service.addExpense(1, { categoryId: '11', amount: '500000', occurredAt: '2026-06-18' });
  assert.equal(ok.err, undefined);
  assert.equal(created.categoryId, 11n);
  assert.equal(prisma.calls[0].where.householdId, 1, 'tra loại phải kèm id sổ');

  created = null;
  const foreign = await service.addExpense(2, { categoryId: '11', amount: '500000', occurredAt: '2026-06-18' });
  assert.match(foreign.err, /Chưa chọn loại/, 'loại của sổ khác thì từ chối ghi');
  assert.equal(created, null, 'và tuyệt đối không tạo dòng nào');
});

test('HouseholdAccessService: admin thường chỉ thấy sổ của mình, chỉ chủ sổ được phân quyền', async () => {
  const books = [
    { id: 1, ownerAdminId: 10n, permissions: [] },
    { id: 2, ownerAdminId: 20n, permissions: [] },
  ];
  const prisma = spyPrisma({ householdConfig: { findMany: async ({ where }) => (Object.keys(where).length ? [books[1]] : books) } });
  const access = new HouseholdAccessService(prisma);

  await access.listBooks(BOB);
  assert.ok(scopesToAdmin(prisma.lastWhere(), 20n), 'admin thường bị lọc theo quyền');

  assert.equal(access.isOwner(BOB, books[1]), true);
  assert.equal(access.isOwner(BOB, books[0]), false, 'Bob không phải chủ sổ của Alice');
  assert.equal(access.isOwner(ROOT, books[0]), true, 'admin gốc vẫn phân quyền được');
});

test('HouseholdAccessService.resolveBook bỏ qua id sổ mà admin không được vào', async () => {
  const mine = { id: 2, ownerAdminId: 20n, permissions: [] };
  const prisma = spyPrisma({ householdConfig: { findMany: async () => [mine] } });
  const access = new HouseholdAccessService(prisma);

  // Bob cố mở sổ số 1 của Alice bằng ?book=1.
  const { current } = await access.resolveBook(BOB, '1');
  assert.equal(current.id, 2, 'id lạ bị bỏ qua, rơi về sổ hợp lệ của chính Bob');
});

test('HouseholdAccessService.removePermission ràng buộc theo đúng sổ', async () => {
  const prisma = spyPrisma({ householdPermission: { deleteMany: async () => ({ count: 0 }) } });
  await new HouseholdAccessService(prisma).removePermission(2, 77n);
  assert.deepEqual(prisma.lastWhere(), { id: 77n, householdId: 2 }, 'không gỡ được quyền của sổ khác');
});

// ─── Bộ khoá tính năng ───

test('AuthService.can: CLIENT không bao giờ chạm được module quản trị', () => {
  const auth = new AuthService({});
  for (const feature of ['MEDICAL', 'HOUSEHOLD', 'PERMISSIONS']) {
    assert.equal(auth.can(CLIENT, feature, new Set([feature])), false, `CLIENT không được ${feature}`);
  }
  assert.equal(auth.can(CLIENT, 'TOURNAMENTS'), true);
});

test('AuthService.can: admin thường chỉ có đúng feature được cấp', () => {
  const auth = new AuthService({});
  assert.equal(auth.can(ALICE, 'TEAMS', new Set(['TEAMS'])), true);
  assert.equal(auth.can(ALICE, 'MEDICAL', new Set(['TEAMS'])), false);
  assert.equal(auth.can(ALICE, 'TEAMS', undefined), false, 'không có bộ quyền thì mặc định CHẶN');
  assert.equal(auth.can(undefined, 'TEAMS', new Set(['TEAMS'])), false);
});

test('AuthService.can: admin gốc đi qua mọi feature', () => {
  const auth = new AuthService({});
  assert.equal(auth.can(ROOT, 'HOUSEHOLD'), true);
  assert.equal(auth.can(ROOT, 'PERMISSIONS'), true);
});

// ─── FeatureGuard: gác toàn cục, mặc định chặn ───

function guardContext({ user, handlerMeta = {}, classMeta = {}, accept = 'text/html' }) {
  const res = {
    statusCode: 200,
    locals: { featureSet: new Set(['TEAMS']) },
    redirectedTo: null,
    rendered: null,
    json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    render(view, data) {
      this.rendered = { view, data };
    },
  };
  res.json = (body) => {
    res.jsonBody = body;
  };
  const req = {
    method: 'GET',
    path: '/teams',
    url: '/teams',
    body: {},
    session: { user },
    get: (name) => (name.toLowerCase() === 'accept' ? accept : undefined),
  };
  const context = {
    getType: () => 'http',
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  };
  const reflector = {
    getAllAndOverride: (key) => (key in handlerMeta ? handlerMeta[key] : classMeta[key]),
  };
  return { req, res, context, reflector };
}

const denials = [];
const fakeLogs = { recordDenied: (req, status, reason) => denials.push({ path: req.path, status, reason }) };
const auth = new AuthService({});

test('FeatureGuard chặn người chưa đăng nhập và ĐƯA VÀO LOG', () => {
  denials.length = 0;
  const { res, context, reflector } = guardContext({ user: undefined });
  const allowed = new FeatureGuard(auth, reflector, fakeLogs).canActivate(context);

  assert.equal(allowed, false);
  assert.equal(res.redirectedTo, '/login');
  assert.equal(denials.length, 1, 'truy cập bị từ chối phải để lại dấu vết — guard chạy trước interceptor');
  assert.equal(denials[0].status, 401);
});

test('FeatureGuard chặn admin thiếu feature, trả 403 chứ không im lặng cho qua', () => {
  denials.length = 0;
  const { res, context, reflector } = guardContext({
    user: ALICE,
    classMeta: { featureAccess: 'MEDICAL' },
  });
  const allowed = new FeatureGuard(auth, reflector, fakeLogs).canActivate(context);

  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'error');
  assert.match(denials[0].reason, /MEDICAL/);
});

test('FeatureGuard cho qua khi admin có đúng feature', () => {
  const { context, reflector } = guardContext({ user: ALICE, classMeta: { featureAccess: 'TEAMS' } });
  assert.equal(new FeatureGuard(auth, reflector, fakeLogs).canActivate(context), true);
});

test('FeatureGuard: @AdminOnly chặn CLIENT dù CLIENT có feature đó', () => {
  const { res, context, reflector } = guardContext({
    user: CLIENT,
    classMeta: { featureAccess: 'TEAMS', adminOnly: true },
  });
  assert.equal(new FeatureGuard(auth, reflector, fakeLogs).canActivate(context), false);
  assert.equal(res.statusCode, 403);
});

test('FeatureGuard: @RootAdminOnly chỉ mở cho admin gốc', () => {
  const forAlice = guardContext({ user: ALICE, classMeta: { rootAdminOnly: true } });
  assert.equal(new FeatureGuard(auth, forAlice.reflector, fakeLogs).canActivate(forAlice.context), false);

  const forRoot = guardContext({ user: ROOT, classMeta: { rootAdminOnly: true } });
  assert.equal(new FeatureGuard(auth, forRoot.reflector, fakeLogs).canActivate(forRoot.context), true);
});

test('FeatureGuard: KHÔNG gắn metadata thì vẫn phải đăng nhập (mặc định chặn)', () => {
  const anonymous = guardContext({ user: undefined });
  assert.equal(new FeatureGuard(auth, anonymous.reflector, fakeLogs).canActivate(anonymous.context), false);

  const loggedIn = guardContext({ user: CLIENT });
  assert.equal(new FeatureGuard(auth, loggedIn.reflector, fakeLogs).canActivate(loggedIn.context), true);
});

test('FeatureGuard: chỉ @Public mới mở cho khách vãng lai', () => {
  const { context, reflector } = guardContext({ user: undefined, classMeta: { publicRoute: true } });
  assert.equal(new FeatureGuard(auth, reflector, fakeLogs).canActivate(context), true);
});

test('FeatureGuard trả JSON 401 cho lời gọi fetch, không redirect câm', () => {
  const { res, context, reflector } = guardContext({ user: undefined, accept: 'application/json' });
  new FeatureGuard(auth, reflector, fakeLogs).canActivate(context);
  assert.equal(res.statusCode, 401);
  assert.equal(res.redirectedTo, null, 'XHR không được nhận 302 sang trang login');
  assert.deepEqual(res.jsonBody, { error: 'Cần đăng nhập' });
});

// ─── Helper ở tầng controller ───

test('requireFeature chặn khi thiếu quyền và khi chưa đăng nhập', () => {
  const denied = { statusCode: 0, locals: { featureSet: new Set(['TEAMS']) }, status(c) { this.statusCode = c; return this; }, render() {}, redirect() {} };
  assert.equal(requireFeature({ session: { user: ALICE } }, denied, auth, 'MEDICAL'), undefined);
  assert.equal(denied.statusCode, 403);

  let redirected = null;
  const anonymous = { locals: {}, redirect: (url) => (redirected = url) };
  assert.equal(requireUser({ session: {} }, anonymous), undefined);
  assert.equal(redirected, '/login');
});

test('requireFeature với adminOnly chặn CLIENT', () => {
  const res = { statusCode: 0, locals: { featureSet: new Set(['TEAMS']) }, status(c) { this.statusCode = c; return this; }, render() {} };
  assert.equal(requireFeature({ session: { user: CLIENT } }, res, auth, 'TEAMS', true), undefined);
  assert.equal(res.statusCode, 403);
});

test('safeNext chặn chuyển hướng ra ngoài sau khi đăng nhập', () => {
  assert.equal(safeNext('/teams/1'), '/teams/1');
  assert.equal(safeNext('//evil.com'), '', 'protocol-relative URL bị chặn');
  assert.equal(safeNext('https://evil.com'), '');
  assert.equal(safeNext('javascript:alert(1)'), '');
  assert.equal(safeNext(undefined), '');
});

test('wantsJson phân biệt trình duyệt với lời gọi fetch', () => {
  const req = (headers) => ({ get: (name) => headers[name.toLowerCase()], path: '/x' });
  assert.equal(wantsJson(req({ accept: 'text/html,application/xhtml+xml' })), false);
  assert.equal(wantsJson(req({ accept: 'application/json' })), true);
  assert.equal(wantsJson(req({ 'x-requested-with': 'XMLHttpRequest' })), true);
});
