const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');

const { AdminService } = require('../dist/admin/admin.service');
const { AuthService } = require('../dist/auth/auth.service');
const { TeamCrudService } = require('../dist/teams/team-crud.service');
const { TeamFundService } = require('../dist/teams/team-fund.service');
const { TournamentCrudService } = require('../dist/tournaments/tournament-crud.service');
const { TournamentPaymentService } = require('../dist/tournaments/tournament-payment.service');
const { TournamentRegistrationService } = require('../dist/tournaments/tournament-registration.service');

test('TournamentCrudService creates normalized tournament payload', async () => {
  let createdData;
  const service = new TournamentCrudService({
    tournament: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 1n, ...data };
      },
    },
  });

  await service.create(
    {
      name: '  Test Cup  ',
      venue: ' Court 1 ',
      expectedPlayers: '6',
      playType: 'DOUBLES',
      format: 'GROUP_KNOCKOUT',
      knockoutQualifierCount: '8',
      courtCost: '1,000',
      foodCost: '500',
      prizeCost: '300',
      otherCost: '200',
      prizeRate1: '70',
      prizeRate2: '40',
      prizeRate3: '10',
      externalRegistrationEnabled: 'on',
    },
    { id: '9', email: 'subadmin', displayName: 'Sub Admin', role: 'ADMIN' },
  );

  assert.equal(createdData.name, 'Test Cup');
  assert.equal(createdData.venue, 'Court 1');
  assert.equal(createdData.knockoutQualifierCount, 2);
  assert.equal(createdData.courtCost, 1000);
  assert.equal(createdData.prizeRate1, 70);
  assert.equal(createdData.prizeRate2, 30);
  assert.equal(createdData.prizeRate3, 0);
  assert.equal(createdData.externalRegistrationEnabled, true);
  assert.equal(createdData.ownerAdminId, 9n);
});

test('TournamentPaymentService bulk update uses minimum fee when amount is blank', async () => {
  const updates = [];
  const tournament = { expectedPlayers: 4, courtCost: 100, foodCost: 100, prizeCost: 100, otherCost: 100 };
  const service = new TournamentPaymentService({
    tournamentRegistration: {
      findMany: async () => [{ id: 7n, tournament }],
      update: (payload) => {
        updates.push(payload);
        return payload;
      },
    },
    $transaction: async (items) => items,
  });

  await service.updatePayments({ amount_7: '', status_7: 'PAID' });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 7n);
  assert.equal(updates[0].data.paidAmount, 50000);
  assert.equal(updates[0].data.paymentStatus, 'PAID');
});

test('TournamentRegistrationService external registration normalizes email and reserve status', async () => {
  let upsertPayload;
  const service = new TournamentRegistrationService({
    tournament: {
      findUniqueOrThrow: async () => ({ id: 3n, externalRegistrationEnabled: true, expectedPlayers: 1, courtCost: 0, foodCost: 0, prizeCost: 0, otherCost: 0 }),
    },
    player: {
      findUnique: async () => null,
    },
    tournamentRegistration: {
      count: async () => 1,
      upsert: async (payload) => {
        upsertPayload = payload;
        return payload.create;
      },
    },
  });

  await service.registerExternal(3n, '  Guest Player  ', ' GUEST@Example.COM ', 'B');

  assert.deepEqual(upsertPayload.where, { tournamentId_externalEmail: { tournamentId: 3n, externalEmail: 'guest@example.com' } });
  assert.equal(upsertPayload.create.externalName, 'Guest Player');
  assert.equal(upsertPayload.create.source, 'EXTERNAL');
  assert.equal(upsertPayload.create.status, 'RESERVE');
});

test('AuthService logs in admin and client with normalized identities', async () => {
  const adminHash = await bcrypt.hash('secret', 4);
  const auth = new AuthService({
    appUser: {
      findUnique: async ({ where }) => (where.username === 'admin' ? { id: 1n, username: 'admin', displayName: 'Root', role: 'ADMIN', passwordHash: adminHash } : null),
    },
    player: {
      findUnique: async ({ where }) => (where.email === 'player@test.local' ? { id: 2n, email: 'player@test.local', displayName: 'Player' } : null),
    },
    tournamentRegistration: {
      findFirst: async () => null,
    },
    adminFeaturePermission: {
      findMany: async () => [],
    },
  });

  const admin = await auth.login(' ADMIN ', 'secret', 'ADMIN');
  const client = await auth.login(' PLAYER@Test.Local ', '123456789', 'CLIENT');

  assert.equal(admin.email, 'admin');
  assert.equal(admin.role, 'ADMIN');
  assert.equal(client.email, 'player@test.local');
  assert.equal(client.role, 'CLIENT');
});

test('AdminService saves delegated admin profile and filtered permissions in one transaction', async () => {
  const operations = [];
  const adminService = new AdminService({
    appUser: {
      update: (payload) => {
        operations.push(['update', payload]);
        return payload;
      },
    },
    adminFeaturePermission: {
      deleteMany: (payload) => {
        operations.push(['deleteMany', payload]);
        return payload;
      },
      createMany: (payload) => {
        operations.push(['createMany', payload]);
        return payload;
      },
    },
    $transaction: async (items) => items,
  });

  await adminService.savePermissions({
    username_5: ' SubAdmin ',
    displayName_5: ' Sub Admin ',
    password_5: '',
    features_5: ['TEAMS', 'INVALID'],
  });

  assert.equal(operations[0][1].data.username, 'subadmin');
  assert.equal(operations[0][1].data.displayName, 'Sub Admin');
  assert.deepEqual(operations[2][1].data, [{ adminId: 5n, feature: 'TEAMS' }]);
});

test('TeamFundService sets fund and seeds fixed member payments from previous balance', async () => {
  let fundPayload;
  const paymentUpserts = [];
  const service = new TeamFundService(
    { previousMonthBalance: async () => 250000 },
    {
      teamMonthFund: {
        upsert: async (payload) => {
          fundPayload = payload;
          return payload.create;
        },
      },
      teamMember: {
        findMany: async () => [{ id: 10n }, { id: 11n }],
      },
      teamMemberPayment: {
        upsert: (payload) => {
          paymentUpserts.push(payload);
          return payload;
        },
      },
      $transaction: async (items) => items,
    },
  );

  await service.setFund(1n, '2026-07', '100,000', '300,000', '', ' July fund ');

  assert.equal(fundPayload.create.previousBalance, 250000);
  assert.equal(fundPayload.create.monthlyFee, 100000);
  assert.equal(fundPayload.create.notes, 'July fund');
  assert.equal(paymentUpserts.length, 2);
  assert.equal(paymentUpserts[0].create.paidAmount, 100000);
});

test('TeamCrudService restricts client teams to active memberships', async () => {
  let teamWhere;
  let countWhere;
  const service = new TeamCrudService({
    teamClub: {
      findMany: async ({ where }) => {
        teamWhere = where;
        return [{ id: 3n, name: 'Member Team' }];
      },
      count: async ({ where }) => {
        countWhere = where;
        return where.id === 3n ? 1 : 0;
      },
    },
    teamMember: {
      groupBy: async ({ where }) => {
        assert.deepEqual(where.teamId.in, [3n]);
        return [{ teamId: 3n, _count: { _all: 2 } }];
      },
    },
  });

  const user = { id: '7', email: 'player@test.local', displayName: 'Player', role: 'CLIENT' };
  const teams = await service.list(user);
  const canView = await service.canView(user, 3n);

  assert.equal(teams.length, 1);
  assert.equal(teams[0].activeMemberCount, 2);
  assert.equal(teamWhere.members.some.active, true);
  assert.equal(teamWhere.members.some.OR[0].playerId, 7n);
  assert.equal(teamWhere.members.some.OR[1].player.is.email.equals, 'player@test.local');
  assert.equal(canView, true);
  assert.equal(countWhere.id, 3n);
  assert.equal(countWhere.members.some.active, true);
});
