const assert = require('node:assert/strict');
const test = require('node:test');

const { PlayerAccessService } = require('../dist/players/player-access.service');
const { PlayersController } = require('../dist/players/players.controller');
const { clientTournamentWhere, clientTeamWhere } = require('../dist/common/player-scope');
const { TournamentCrudService } = require('../dist/tournaments/tournament-crud.service');
const { TeamCrudService } = require('../dist/teams/team-crud.service');
const { AuthService } = require('../dist/auth/auth.service');

/**
 * Quyền XEM của thành viên (9/2026).
 *
 * Mô hình mối đe doạ:
 * 1. Admin phụ Bob gửi lên id giải của Alice trong form phân quyền — phải bị lọc bỏ, và lệnh
 *    "bỏ tích" của Bob không được thu quyền mà Alice đã cấp cho giải của Alice.
 * 2. Vận động viên có tên trong giải nhưng CHƯA được cấp quyền — không được thấy giải.
 */

const ROOT = { id: '1', email: 'admin', displayName: 'Admin gốc', role: 'ADMIN' };
const ALICE = { id: '10', email: 'alice', displayName: 'Alice', role: 'ADMIN' };
const BOB = { id: '20', email: 'bob', displayName: 'Bob', role: 'ADMIN' };
const BOTH = new Set(['TOURNAMENTS', 'TEAMS']);

function scopesToAdmin(where, adminId) {
  const or = where?.OR;
  if (!Array.isArray(or)) return false;
  return or.some((c) => c.ownerAdminId === adminId) && or.some((c) => c.permissions?.some?.adminId === adminId);
}

/** Prisma giả: giải 1, 2 của Alice; giải 3 của Bob. Ghi lại mọi lệnh xoá/tạo quyền. */
function fakePrisma() {
  const tournaments = [
    { id: 1n, name: 'Cúp Alice 1', ownerAdminId: 10n },
    { id: 2n, name: 'Cúp Alice 2', ownerAdminId: 10n },
    { id: 3n, name: 'Cúp Bob', ownerAdminId: 20n },
  ];
  const writes = [];
  const inScope = (where) => (row) => {
    if (!where || !where.OR) return true;
    return where.OR.some((clause) => clause.ownerAdminId === row.ownerAdminId);
  };
  return {
    writes,
    tournament: {
      findMany: async ({ where, select }) =>
        tournaments.filter(inScope(where)).map((row) => ({
          id: row.id,
          name: row.name,
          ...(select?.playerAccess ? { playerAccess: row.id === 1n ? [{ id: 100n }] : [] } : {}),
        })),
    },
    teamClub: { findMany: async () => [] },
    playerTournamentAccess: {
      deleteMany: (args) => ({ op: 'delete', ...args }),
      createMany: (args) => ({ op: 'create', ...args }),
    },
    playerTeamAccess: {
      deleteMany: (args) => ({ op: 'delete-team', ...args }),
      createMany: (args) => ({ op: 'create-team', ...args }),
    },
    $transaction: async (ops) => {
      ops.forEach((op) => writes.push(op));
      return ops;
    },
  };
}

test('targetsFor: admin phụ chỉ thấy giải của mình, admin gốc thấy hết', async () => {
  const service = new PlayerAccessService(fakePrisma());
  const forBob = await service.targetsFor(BOB, BOTH, 5n);
  assert.deepEqual(forBob.tournaments.map((t) => t.name), ['Cúp Bob']);

  const forRoot = await service.targetsFor(ROOT, BOTH, 5n);
  assert.deepEqual(forRoot.tournaments.map((t) => t.name).sort(), ['Cúp Alice 1', 'Cúp Alice 2', 'Cúp Bob']);
  assert.equal(forRoot.tournaments.find((t) => t.id === 1n).granted, true, 'ô đã cấp phải hiện là đã tích');
});

test('targetsFor: thiếu feature TEAMS thì không liệt kê đội, dù là chủ đội', async () => {
  const prisma = fakePrisma();
  let askedTeams = false;
  prisma.teamClub.findMany = async () => {
    askedTeams = true;
    return [];
  };
  await new PlayerAccessService(prisma).targetsFor(ALICE, new Set(['TOURNAMENTS']), 5n);
  assert.equal(askedTeams, false, 'không có TEAMS thì không được đụng tới bảng đội');
});

test('save: Bob gửi id giải của Alice lên thì bị lọc bỏ, và không thu được quyền của Alice', async () => {
  const prisma = fakePrisma();
  const service = new PlayerAccessService(prisma);
  // Bob tích giải 1 (của Alice) và giải 3 (của mình), bỏ tích... không có gì.
  await service.save(BOB, BOTH, 5n, [1n, 3n], []);

  const del = prisma.writes.find((w) => w.op === 'delete');
  const create = prisma.writes.find((w) => w.op === 'create');
  assert.deepEqual(del.where.tournamentId.in, [3n], 'lệnh xoá chỉ được đụng giải trong phạm vi của Bob');
  assert.deepEqual(del.where.tournamentId.notIn, [3n], 'giải 3 đang tích thì giữ');
  assert.deepEqual(
    create.data.map((row) => row.tournamentId),
    [3n],
    'giải 1 của Alice bị lọc khỏi danh sách cấp dù Bob gửi lên',
  );
  assert.equal(create.data[0].grantedByAdminId, 20n, 'ghi lại ai cấp');
});

test('save: bỏ tích thì thu quyền, nhưng chỉ trong phạm vi của người thao tác', async () => {
  const prisma = fakePrisma();
  await new PlayerAccessService(prisma).save(ALICE, BOTH, 5n, [2n], []);
  const del = prisma.writes.find((w) => w.op === 'delete');
  assert.deepEqual(del.where.tournamentId.in.sort(), [1n, 2n], 'phạm vi của Alice là giải 1 và 2');
  assert.deepEqual(del.where.tournamentId.notIn, [2n], 'giải 1 bị bỏ tích sẽ bị thu, giải 2 giữ');
  assert.deepEqual(del.where.playerId, 5n);
});

test('save: admin gốc cấp được cho mọi giải', async () => {
  const prisma = fakePrisma();
  await new PlayerAccessService(prisma).save(ROOT, BOTH, 5n, [1n, 3n], []);
  const create = prisma.writes.find((w) => w.op === 'create');
  assert.deepEqual(create.data.map((row) => row.tournamentId).sort(), [1n, 3n]);
});

test('countFilters: số quyền hiện trên danh sách cũng đếm theo phạm vi của admin', () => {
  const filters = new PlayerAccessService({}).countFilters(BOB, BOTH);
  assert.ok(scopesToAdmin(filters.tournamentAccess.where.tournament, 20n));
  const rootFilters = new PlayerAccessService({}).countFilters(ROOT, BOTH);
  assert.deepEqual(rootFilters.tournamentAccess.where.tournament, {}, 'admin gốc không bị giới hạn');
  const noTeams = new PlayerAccessService({}).countFilters(BOB, new Set(['TOURNAMENTS']));
  assert.deepEqual(noTeams.teamAccess.where, { id: -1n }, 'không có TEAMS thì đếm đội ra 0');
});

// ─── Vận động viên chỉ thấy giải/đội đã được cấp quyền ───

test('clientTournamentWhere: đi qua bảng quyền xem, không qua bảng đăng ký của player', () => {
  const where = clientTournamentWhere({ email: 'an@test' });
  const [byAccess, byExternal] = where.OR;
  assert.equal(byAccess.playerAccess.some.player.email.equals, 'an@test');
  // Người đăng ký ngoài (không có hồ sơ player) là ngoại lệ duy nhất còn đi qua bảng đăng ký.
  assert.equal(byExternal.registrations.some.playerId, null, 'chỉ dòng đăng ký KHÔNG gắn player');
  assert.equal(byExternal.registrations.some.externalEmail.equals, 'an@test');
});

test('clientTeamWhere: so bằng email, không bao giờ dùng user.id làm playerId', () => {
  const where = clientTeamWhere({ id: '5', email: 'an@test' });
  assert.equal(JSON.stringify(where).includes('playerId'), false, 'user.id của người đăng ký ngoài là id đăng ký, không phải id VĐV');
  assert.equal(where.playerAccess.some.player.email.equals, 'an@test');
});

test('TournamentCrudService.canView với CLIENT hỏi bảng giải kèm bộ lọc quyền xem', async () => {
  let seen;
  const prisma = { tournament: { count: async ({ where }) => { seen = where; return 0; } } };
  const client = { id: '77', email: 'an@test', displayName: 'An', role: 'CLIENT' };
  assert.equal(await new TournamentCrudService(prisma).canView(client, 9n), false);
  assert.equal(seen.id, 9n);
  assert.ok(seen.OR[0].playerAccess, 'phải lọc theo quyền xem');
});

test('TeamCrudService.list với CLIENT lọc theo quyền xem đội', async () => {
  let seen;
  const prisma = { teamClub: { findMany: async ({ where }) => { seen = where; return []; } } };
  const client = { id: '77', email: 'an@test', displayName: 'An', role: 'CLIENT' };
  await new TeamCrudService(prisma).list(client);
  assert.ok(seen.playerAccess, 'đội hiện ra phải là đội đã cấp quyền');
});

// ─── Trang Thành viên: cần TOURNAMENTS hoặc TEAMS ───

function fakeRes(featureSet) {
  const res = { statusCode: 200, locals: { featureSet }, rendered: null, redirected: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.render = (view, data) => { res.rendered = { view, data }; return res; };
  res.redirect = (url) => { res.redirected = url; };
  return res;
}

test('PlayersController: admin chỉ có TEAMS vẫn vào được để cấp quyền đội', async () => {
  const players = { list: async () => [] };
  const access = new PlayerAccessService({});
  const controller = new PlayersController(players, access, new AuthService({}));
  const res = fakeRes(new Set(['TEAMS']));
  await controller.players({ session: { user: BOB } }, res);
  assert.equal(res.rendered.view, 'players/index');
});

test('PlayersController: admin không có feature nào thì 403, CLIENT cũng 403', async () => {
  const controller = new PlayersController({ list: async () => [] }, new PlayerAccessService({}), new AuthService({}));
  const noFeature = fakeRes(new Set());
  await controller.players({ session: { user: BOB } }, noFeature);
  assert.equal(noFeature.statusCode, 403);

  const client = fakeRes(new Set(['TOURNAMENTS', 'TEAMS']));
  await controller.players({ session: { user: { id: '7', email: 'an@test', displayName: 'An', role: 'CLIENT' } } }, client);
  assert.equal(client.statusCode, 403);
});
