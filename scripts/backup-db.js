// Xuất toàn bộ dữ liệu DB ra JSON để backup (đề phòng Supabase free không có backup).
// Chạy: node scripts/backup-db.js  (đọc DATABASE_URL từ .env / env)
// Output ghi vào thư mục backups/ (đã .gitignore) — xem README phần Backup về lý do KHÔNG
// commit dữ liệu thật vào repo public.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, Prisma } = require('@prisma/client');

// Thứ tự không quan trọng khi backup; DMMF cho danh sách tất cả model.
const prisma = new PrismaClient();

function replacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function main() {
  const models = Prisma.dmmf.datamodel.models;
  const data = {};
  let total = 0;
  for (const model of models) {
    const delegate = prisma[lowerFirst(model.name)];
    if (!delegate?.findMany) continue;
    const rows = await delegate.findMany();
    data[model.name] = rows;
    total += rows.length;
    console.log(`  ${model.name}: ${rows.length}`);
  }

  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = { exportedAt: new Date().toISOString(), models: Object.keys(data), data };
  const json = JSON.stringify(payload, replacer, 0);
  fs.writeFileSync(path.join(dir, `backup-${stamp}.json`), json);
  fs.writeFileSync(path.join(dir, 'latest.json'), json);
  console.log(`\nĐã backup ${total} bản ghi -> backups/backup-${stamp}.json (và latest.json)`);
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
