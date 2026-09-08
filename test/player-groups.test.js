const assert = require('node:assert/strict');
const test = require('node:test');

const { GroupService } = require('../dist/groups/group.service');
const { mergeDistinct } = require('../dist/tournaments/tournament-registration.controller');
const { requireAnyFeature } = require('../dist/common/controller-utils');
const { AuthService } = require('../dist/auth/auth.service');

/**
 * Nhóm thành viên (9/2026): tạo đội / thêm vào giải bằng cách chọn nhóm.
 *
 * Ba thứ phải đúng:
 * 1. Admin phụ chỉ thấy và dùng được nhóm mình tạo — id nhóm lạ gửi lên bị lọc ngay trong truy vấn.
 * 2. Người trùng giữa các nhóm, hoặc vừa ở nhóm vừa được tích lẻ, chỉ tính MỘT lần.
 * 3. Thêm người vào nhóm thì tự vào mọi đội đang liên kết nhóm đó.
 */

const ROOT = { id: '1', email: 'admin', displayName: 'Admin gốc', role: 'ADMIN' };
const BOB = { id: '20', email: 'bob', displayName: 'Bob', role: 'ADMIN' };

test('scope: admin phụ lọc theo ownerAdminId, admin gốc không giới hạn', () => {
  const service = new GroupService({}, {});
  assert.deepEqual(service.scope(BOB), { ownerAdminId: 20n });
  assert.deepEqual(service.scope(ROOT), {});
});

test('playerIdsOfGroups: lọc nhóm theo phạm vi ngay trong truy vấn và bỏ trùng người', async () => {
  let seen;
  const prisma = {
    playerGroupMember: {
      findMany: async ({ where }) => {
        seen = where;
        return [{ playerId: 5n }, { playerId: 7n }, { playerId: 5n }];
      },
    },
  };
  const ids = await new GroupService(prisma, {}).playerIdsOfGroups(BOB, [1n, 2n]);
  assert.deepEqual(seen.groupId.in, [1n, 2n]);
  assert.deepEqual(seen.group, { ownerAdminId: 20n }, 'nhóm của admin khác không được lộ người');
  assert.deepEqual(ids, [5n, 7n], 'người ở hai nhóm chỉ tính một lần');
  assert.deepEqual(await new GroupService(prisma, {}).playerIdsOfGroups(BOB, []), [], 'không tích nhóm nào thì không hỏi DB');
});

test('addMembers: nhóm ngoài phạm vi thì không thêm; trong phạm vi thì đưa luôn vào mọi đội liên kết', async () => {
  const added = [];
  const teamMembers = { addMember: async (teamId, playerId, type) => added.push(`${teamId}:${playerId}:${type}`) };
  const prisma = {
    playerGroup: { findFirst: async ({ where }) => (where.ownerAdminId === 20n && where.id === 9n ? { id: 9n } : null) },
    playerGroupMember: { createMany: async ({ data }) => ({ count: data.length }) },
    teamClubGroup: { findMany: async () => [{ teamId: 100n }, { teamId: 200n }] },
  };
  const service = new GroupService(prisma, teamMembers);

  assert.equal(await service.addMembers(BOB, 8n, [5n]), 0, 'nhóm 8 không phải của Bob');
  assert.deepEqual(added, []);

  assert.equal(await service.addMembers(BOB, 9n, [5n, 5n, 6n]), 2, 'bỏ trùng trước khi ghi');
  assert.deepEqual(added.sort(), ['100:5:FIXED', '100:6:FIXED', '200:5:FIXED', '200:6:FIXED'], 'mỗi người vào cả hai đội, là thành viên cố định');
});

test('removeMember và delete đều ràng buộc theo phạm vi ngay trong where', async () => {
  const wheres = [];
  const prisma = {
    playerGroupMember: { deleteMany: async ({ where }) => wheres.push(where) },
    playerGroup: { deleteMany: async ({ where }) => wheres.push(where) },
  };
  const service = new GroupService(prisma, {});
  await service.removeMember(BOB, 9n, 5n);
  await service.delete(BOB, 9n);
  assert.deepEqual(wheres[0].group, { ownerAdminId: 20n });
  assert.equal(wheres[1].ownerAdminId, 20n);
});

test('mergeDistinct: người tích lẻ + người của nhóm gộp lại không trùng', () => {
  assert.deepEqual(mergeDistinct([1n, 2n], [2n, 3n], [3n, 1n]), [1n, 2n, 3n]);
  assert.deepEqual(mergeDistinct([], []), []);
});

test('requireAnyFeature: vào được khi có MỘT trong các feature, CLIENT bị chặn', () => {
  const auth = new AuthService({});
  const res = (features) => ({ statusCode: 200, locals: { featureSet: new Set(features) }, status(c) { this.statusCode = c; return this; }, render() {}, redirect() {} });
  const ok = res(['TEAMS']);
  assert.equal(requireAnyFeature({ session: { user: BOB } }, ok, auth, ['TOURNAMENTS', 'TEAMS']), BOB);
  const none = res([]);
  assert.equal(requireAnyFeature({ session: { user: BOB } }, none, auth, ['TOURNAMENTS', 'TEAMS']), undefined);
  assert.equal(none.statusCode, 403);
  const client = res(['TOURNAMENTS', 'TEAMS']);
  assert.equal(requireAnyFeature({ session: { user: { id: '7', email: 'an@test', displayName: 'An', role: 'CLIENT' } } }, client, auth, ['TOURNAMENTS']), undefined);
  assert.equal(client.statusCode, 403);
});
