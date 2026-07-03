const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

if (!process.env.E2E_DATABASE_URL) {
  console.log('E2E_DATABASE_URL is not set; skipping DB seed.');
  process.exit(0);
}

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const statePath = path.join(__dirname, '..', '.e2e-state.json');

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  await prisma.tournament.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.teamClub.deleteMany({ where: { name: { startsWith: 'E2E ' } } });

  const adminPassword = process.env.E2E_ADMIN_PASSWORD || '123456789';
  await prisma.appUser.upsert({
    where: { username: 'e2e_admin' },
    update: {
      passwordHash: await bcrypt.hash(adminPassword, 10),
      displayName: 'E2E Admin',
      role: 'ADMIN',
    },
    create: {
      username: 'e2e_admin',
      passwordHash: await bcrypt.hash(adminPassword, 10),
      displayName: 'E2E Admin',
      role: 'ADMIN',
    },
  });

  const playerA = await upsertPlayer('e2e-an@test.local', 'E2E An', 'B');
  const playerB = await upsertPlayer('e2e-binh@test.local', 'E2E Binh', 'C');

  const tournament = await prisma.tournament.create({
    data: {
      name: `E2E Test Cup ${Date.now()}`,
      venue: 'E2E Court',
      expectedPlayers: 8,
      courtCount: 2,
      playType: 'DOUBLES',
      format: 'ROUND_ROBIN',
      touchScore: 11,
      maxScore: 15,
      knockoutTouchScore: 15,
      knockoutMaxScore: 19,
      externalRegistrationEnabled: true,
    },
  });

  await prisma.tournamentRegistration.createMany({
    data: [
      {
        tournamentId: tournament.id,
        playerId: playerA.id,
        skillLevel: playerA.skillLevel,
        source: 'INTERNAL',
        status: 'ACTIVE',
      },
      {
        tournamentId: tournament.id,
        playerId: playerB.id,
        skillLevel: playerB.skillLevel,
        source: 'INTERNAL',
        status: 'ACTIVE',
      },
    ],
  });

  const team = await prisma.teamClub.create({
    data: {
      name: `E2E Team ${Date.now()}`,
      description: 'Seeded for browser tests',
      members: {
        create: [
          { playerId: playerA.id, memberType: 'FIXED' },
          { playerId: playerB.id, memberType: 'GUEST' },
        ],
      },
    },
  });

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        tournamentId: tournament.id.toString(),
        teamId: team.id.toString(),
        adminUsername: 'e2e_admin',
        adminPassword,
      },
      null,
      2,
    ),
  );

  console.log(`Seeded E2E data: tournament=${tournament.id.toString()} team=${team.id.toString()}`);
}

function upsertPlayer(email, displayName, skillLevel) {
  return prisma.player.upsert({
    where: { email },
    update: { displayName, skillLevel },
    create: { email, displayName, skillLevel },
  });
}
