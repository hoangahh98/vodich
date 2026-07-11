// Phục hồi DB từ file backup JSON (do backup-db.js tạo).
// Chạy: node scripts/restore-db.js [đường-dẫn-file]   (mặc định backups/latest.json)
// Dùng khi DB trống/mới (vd Supabase sập, tạo instance mới). Chèn theo thứ tự khóa ngoại,
// bỏ qua bản ghi trùng. KHÔNG xóa dữ liệu đang có.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// Thứ tự chèn: cha trước con. TravelTrip có khóa vòng (treasurerMemberId -> TravelTripMember)
// nên chèn trip với treasurer=null trước, chèn member, rồi vá lại treasurer.
const ORDER = [
  'AppUser', 'Player', 'AdminFeaturePermission',
  'Tournament', 'TournamentPermission', 'TournamentRegistration', 'MatchGame',
  'TeamClub', 'TeamClubPermission', 'TeamMember', 'TeamMonthFund', 'TeamMemberPayment', 'TeamExpense',
  'AppLog',
  'TravelDestination', 'TravelSuggestion', 'TravelPerson',
  'TravelTrip', 'TravelTripMember', 'TravelTripPermission', 'TravelTripCollection',
  'TravelTripExpense', 'TravelTripExpenseSplit',
];

const fieldTypes = buildFieldTypes();

function buildFieldTypes() {
  const map = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    map[model.name] = {};
    for (const field of model.fields) {
      if (field.kind === 'scalar') map[model.name][field.name] = field.type;
    }
  }
  return map;
}

function coerce(modelName, row) {
  const types = fieldTypes[modelName] || {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const type = types[key];
    if (value === null || value === undefined || !type) {
      out[key] = value;
    } else if (type === 'BigInt') {
      out[key] = BigInt(value);
    } else if (type === 'DateTime') {
      out[key] = new Date(value);
    } else {
      out[key] = value; // String/Int/Boolean/Decimal (Prisma nhận Decimal dạng chuỗi)
    }
  }
  return out;
}

async function main() {
  const file = process.argv[2] || path.join(process.cwd(), 'backups', 'latest.json');
  if (!fs.existsSync(file)) {
    console.error(`Không tìm thấy file backup: ${file}`);
    process.exitCode = 1;
    return;
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = payload.data || {};
  const treasurerPatches = [];
  let total = 0;

  for (const modelName of ORDER) {
    const rows = data[modelName] || [];
    if (!rows.length) continue;
    const delegate = prisma[lowerFirst(modelName)];
    if (!delegate?.createMany) continue;

    let prepared = rows.map((row) => coerce(modelName, row));
    if (modelName === 'TravelTrip') {
      prepared.forEach((trip) => {
        if (trip.treasurerMemberId !== null && trip.treasurerMemberId !== undefined) {
          treasurerPatches.push({ id: trip.id, treasurerMemberId: trip.treasurerMemberId });
          trip.treasurerMemberId = null;
        }
      });
    }
    const result = await delegate.createMany({ data: prepared, skipDuplicates: true });
    total += result.count;
    console.log(`  ${modelName}: +${result.count}/${rows.length}`);
  }

  for (const patch of treasurerPatches) {
    await prisma.travelTrip.update({ where: { id: patch.id }, data: { treasurerMemberId: patch.treasurerMemberId } }).catch(() => undefined);
  }

  console.log(`\nĐã phục hồi ${total} bản ghi từ ${path.basename(file)}. Vá ${treasurerPatches.length} thủ quỹ.`);
  console.log('Lưu ý: chạy `npx prisma migrate deploy` trước khi restore để bảng đã tồn tại.');
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

main()
  .catch((error) => {
    console.error('Restore thất bại:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
