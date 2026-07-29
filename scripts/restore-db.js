// Phục hồi DB từ file backup JSON (do backup-db.js tạo).
// Chạy: node scripts/restore-db.js [đường-dẫn-file]   (mặc định backups/latest.json)
//
// Dùng khi DB trống/mới (vd Supabase sập, tạo instance mới). Chèn theo thứ tự khóa ngoại,
// bỏ qua bản ghi trùng. KHÔNG xóa dữ liệu đang có.
//
// Dựng bảng TRƯỚC khi chạy script này bằng `npx prisma db push` — KHÔNG phải
// `prisma migrate deploy`: chuỗi migration hiện không dựng được schema từ DB trống
// (migration đầu tiên đã là ALTER TABLE trên bảng chưa ai tạo). Xem README.
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
  'KnightCharacter', 'KnightProgress',
  'MedPatient', 'MedPatientPermission', 'MedPrescription', 'MedPrescriptionItem', 'MedCabinetItem',
  // Sổ chi tiêu: config là gốc, rồi tới các danh mục (quỹ / nợ / chi phí cố định),
  // cuối cùng mới tới các dòng trỏ vào danh mục đó.
  'HouseholdConfig', 'HouseholdPermission', 'HouseholdIncome',
  'HouseholdFund', 'HouseholdDebt', 'HouseholdFixedCost',
  'HouseholdFundEntry', 'HouseholdDebtPayment', 'HouseholdFixedSpend', 'HouseholdExtraCost',
];

/**
 * Danh sách trên từng thiếu 13 bảng (y tế, chi tiêu, game Hiệp Sĩ) mà không báo gì:
 * vòng lặp chỉ chạy theo ORDER nên bảng vắng mặt bị bỏ qua IM LẶNG — backup có dữ liệu
 * nhưng khôi phục xong là mất sạch, và chỉ phát hiện ra đúng lúc cần nó nhất.
 * Nay thêm model mới mà quên khai ở đây thì script dừng ngay với thông báo rõ ràng.
 */
function assertOrderCoversSchema() {
  const all = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const missing = all.filter((name) => !ORDER.includes(name));
  if (missing.length) {
    throw new Error(
      `restore-db.js thiếu ${missing.length} bảng trong ORDER: ${missing.join(', ')}.\n` +
        'Thêm vào ORDER đúng thứ tự khoá ngoại (cha trước con) rồi chạy lại.',
    );
  }
  const unknown = ORDER.filter((name) => !all.includes(name));
  if (unknown.length) throw new Error(`ORDER có bảng không còn tồn tại: ${unknown.join(', ')}`);
}

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

/** Tên cột DB -> tên field Prisma, để đọc được cả file backup cũ lấy bằng SQL thô. */
const fieldNameByColumn = buildColumnAliases();

function buildColumnAliases() {
  const map = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    map[model.name] = {};
    for (const field of model.fields) {
      if (field.kind === 'scalar' && field.dbName) map[model.name][field.dbName] = field.name;
    }
  }
  return map;
}

function coerce(modelName, row) {
  const types = fieldTypes[modelName] || {};
  const aliases = fieldNameByColumn[modelName] || {};
  const out = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = types[rawKey] ? rawKey : aliases[rawKey] || rawKey;
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
  assertOrderCoversSchema();

  const file = process.argv[2] || path.join(process.cwd(), 'backups', 'latest.json');
  if (!fs.existsSync(file)) {
    console.error(`Không tìm thấy file backup: ${file}`);
    process.exitCode = 1;
    return;
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = payload.data || {};

  // Backup chứa bảng mà script không biết chèn ⇒ dừng, đừng khôi phục nửa vời.
  const unhandled = Object.keys(data).filter((name) => !ORDER.includes(name) && (data[name] || []).length);
  if (unhandled.length) {
    throw new Error(`File backup có bảng chưa được khai trong ORDER: ${unhandled.join(', ')}`);
  }

  const treasurerPatches = [];
  let total = 0;

  for (const modelName of ORDER) {
    const rows = data[modelName] || [];
    if (!rows.length) continue;
    const delegate = prisma[lowerFirst(modelName)];
    if (!delegate?.createMany) continue;

    const prepared = rows.map((row) => coerce(modelName, row));
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

  const resequenced = await resetSequences();

  console.log(`\nĐã phục hồi ${total} bản ghi từ ${path.basename(file)}. Vá ${treasurerPatches.length} thủ quỹ.`);
  console.log(`Đã đặt lại ${resequenced} bộ đếm id.`);
}

/**
 * Đặt lại bộ đếm id sau khi chèn bản ghi kèm id sẵn có.
 *
 * Không làm bước này thì DB khôi phục xong TRÔNG có vẻ ổn, nhưng bản ghi MỚI đầu tiên sẽ
 * lấy id = 1 và đâm vào id đã tồn tại -> lỗi trùng khoá chính. Đây là loại lỗi chỉ lộ ra
 * sau khi khôi phục vài phút, lúc người dùng bắt đầu nhập liệu lại.
 */
async function resetSequences() {
  let count = 0;
  for (const model of Prisma.dmmf.datamodel.models) {
    const idField = model.fields.find((f) => f.isId && f.hasDefaultValue && f.default?.name === 'autoincrement');
    if (!idField) continue;
    const table = model.dbName || model.name;
    const column = idField.dbName || idField.name;
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'),
              GREATEST(COALESCE((SELECT MAX("${column}") FROM "${table}"), 0), 1), true) AS value`,
    );
    if (row) count += 1;
  }
  return count;
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// Cho test nạp ORDER vào kiểm mà không chạy restore thật.
module.exports = { ORDER, assertOrderCoversSchema };

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Restore thất bại:', error.message || error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
