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

  // ─── Hai admin thường để test rò dữ liệu chéo trong trình duyệt thật ───
  // Alice có TOURNAMENTS + TEAMS, Bob CHỈ có TEAMS. Mỗi người sở hữu một đội riêng,
  // nên e2e kiểm được đúng hai thứ: thiếu feature thì bị chặn, và có feature nhưng
  // không sở hữu tài nguyên thì cũng bị chặn.
  const alice = await upsertAdmin('e2e_alice', 'E2E Alice', adminPassword, ['TOURNAMENTS', 'TEAMS']);
  const bob = await upsertAdmin('e2e_bob', 'E2E Bob', adminPassword, ['TEAMS']);

  const aliceTeam = await prisma.teamClub.create({
    data: { name: `E2E Alice Team ${Date.now()}`, description: 'Của riêng Alice', ownerAdminId: alice.id },
  });
  const bobTeam = await prisma.teamClub.create({
    data: { name: `E2E Bob Team ${Date.now()}`, description: 'Của riêng Bob', ownerAdminId: bob.id },
  });
  const aliceTournament = await prisma.tournament.create({
    data: {
      name: `E2E Alice Cup ${Date.now()}`,
      venue: 'E2E Court',
      expectedPlayers: 4,
      courtCount: 1,
      playType: 'DOUBLES',
      format: 'ROUND_ROBIN',
      touchScore: 11,
      maxScore: 15,
      knockoutTouchScore: 15,
      knockoutMaxScore: 19,
      ownerAdminId: alice.id,
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
        aliceUsername: 'e2e_alice',
        bobUsername: 'e2e_bob',
        aliceTeamId: aliceTeam.id.toString(),
        bobTeamId: bobTeam.id.toString(),
        aliceTournamentId: aliceTournament.id.toString(),
      },
      null,
      2,
    ),
  );

  console.log(`Seeded E2E data: tournament=${tournament.id.toString()} team=${team.id.toString()}`);
  console.log(`Seeded phân quyền: alice=${alice.id} (đội ${aliceTeam.id}) bob=${bob.id} (đội ${bobTeam.id})`);
}

/** Admin thường (không phải admin gốc) kèm đúng bộ feature được cấp. */
async function upsertAdmin(username, displayName, password, features) {
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.appUser.upsert({
    where: { username },
    update: { passwordHash, displayName, role: 'ADMIN' },
    create: { username, passwordHash, displayName, role: 'ADMIN' },
  });
  await prisma.adminFeaturePermission.deleteMany({ where: { adminId: admin.id } });
  await prisma.adminFeaturePermission.createMany({
    data: features.map((feature) => ({ adminId: admin.id, feature })),
    skipDuplicates: true,
  });
  return admin;
}

function upsertPlayer(email, displayName, skillLevel) {
  return prisma.player.upsert({
    where: { email },
    update: { displayName, skillLevel },
    create: { email, displayName, skillLevel },
  });
}
