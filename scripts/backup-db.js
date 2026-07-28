// Xuất toàn bộ dữ liệu DB ra JSON để backup (đề phòng Supabase free không có backup).
// Chạy: node scripts/backup-db.js  (đọc DATABASE_URL từ .env / env)
// Output ghi vào thư mục backups/ (đã .gitignore) — xem README phần Backup về lý do KHÔNG
// commit dữ liệu thật vào repo public.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, Prisma } = require('@prisma/client');

// Thứ tự không quan trọng khi backup; DMMF cho danh sách tất cả model.
const prisma = new PrismaClient();

/**
 * AppLog là log vận hành, không phải dữ liệu nghiệp vụ: chiếm ~80% dung lượng backup và
 * phình thêm mỗi ngày. Backup tự động chạy hằng ngày mà kèm nó thì repo backup tăng vài GB
 * một năm. Mất log cũ không phải thảm hoạ — mất giải đấu/đội bóng/sổ chi tiêu mới là.
 * Cần cả log thì chạy: BACKUP_INCLUDE_LOGS=true npm run backup
 */
const OPERATIONAL_MODELS = new Set(['AppLog']);
const includeLogs = process.env.BACKUP_INCLUDE_LOGS === 'true';

function replacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function main() {
  const models = Prisma.dmmf.datamodel.models;
  const data = {};
  const skipped = [];
  const rawFallback = [];
  let total = 0;
  for (const model of models) {
    const delegate = prisma[lowerFirst(model.name)];
    if (!delegate?.findMany) continue;
    if (OPERATIONAL_MODELS.has(model.name) && !includeLogs) {
      console.log(`  ${model.name}: (bỏ qua — log vận hành, đặt BACKUP_INCLUDE_LOGS=true nếu cần)`);
      continue;
    }
    try {
      const rows = await delegate.findMany();
      data[model.name] = rows;
      total += rows.length;
      console.log(`  ${model.name}: ${rows.length}`);
    } catch (error) {
      const code = error?.code;
      if (code === 'P2021') {
        // Bảng thật sự chưa tồn tại (migration chưa deploy) -> không có gì để mất.
        skipped.push(model.name);
        console.log(`  ${model.name}: (bỏ qua — bảng chưa tồn tại)`);
        continue;
      }
      if (code === 'P2022') {
        // Cột chưa tồn tại = client đã generate theo schema MỚI còn DB thì chưa migrate.
        // Bảng vẫn CÓ dữ liệu. Bỏ qua ở đây là ra một bản backup thiếu mà vẫn báo "xong" —
        // đúng lúc nguy hiểm nhất, vì người ta backup ngay TRƯỚC khi chạy migration.
        // Nên đọc lại bằng SQL thô để lấy đúng các cột đang có thật trong DB.
        const rows = await rawRows(model);
        data[model.name] = rows;
        total += rows.length;
        rawFallback.push(model.name);
        console.log(`  ${model.name}: ${rows.length} (đọc bằng SQL thô — DB chưa có cột mới)`);
        continue;
      }
      throw error;
    }
  }

  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = {
    exportedAt: new Date().toISOString(),
    models: Object.keys(data),
    // Ghi lại để lúc khôi phục biết bảng nào đọc theo cột cũ, bảng nào vắng mặt có chủ ý.
    skippedModels: skipped,
    rawFallbackModels: rawFallback,
    data,
  };
  const json = JSON.stringify(payload, replacer, 0);
  fs.writeFileSync(path.join(dir, `backup-${stamp}.json`), json);
  fs.writeFileSync(path.join(dir, 'latest.json'), json);
  console.log(`\nĐã backup ${total} bản ghi -> backups/backup-${stamp}.json (và latest.json)`);
  if (rawFallback.length) console.log(`Đọc bằng SQL thô (DB chưa migrate): ${rawFallback.join(', ')}`);
  if (skipped.length) console.log(`Bảng chưa tồn tại, không có dữ liệu: ${skipped.join(', ')}`);
}

/**
 * Đọc thẳng bảng theo tên vật lý, không qua model — dùng khi client và DB lệch schema.
 *
 * PHẢI đổi tên cột DB về tên field của Prisma (`week_start_dow` -> `weekStartDow`), nếu
 * không file backup sẽ có hai dạng khoá lẫn lộn và restore-db.js chết với
 * "Unknown argument `week_start_dow`" — đúng lúc đang cần khôi phục.
 */
async function rawRows(model) {
  const table = model.dbName || model.name;
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
  const fieldByColumn = new Map(
    model.fields.filter((f) => f.kind === 'scalar').map((f) => [f.dbName || f.name, f.name]),
  );
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([column, value]) => [fieldByColumn.get(column) || column, value])),
  );
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

main()
  .catch((error) => {
    console.error('Backup thất bại:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
