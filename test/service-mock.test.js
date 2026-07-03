const assert = require('node:assert/strict');
const test = require('node:test');

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

  await service.create({
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
  });

  assert.equal(createdData.name, 'Test Cup');
  assert.equal(createdData.venue, 'Court 1');
  assert.equal(createdData.knockoutQualifierCount, 2);
  assert.equal(createdData.courtCost, 1000);
  assert.equal(createdData.prizeRate1, 70);
  assert.equal(createdData.prizeRate2, 30);
  assert.equal(createdData.prizeRate3, 0);
  assert.equal(createdData.externalRegistrationEnabled, true);
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
