// Đánh dấu MỌI migration là "đã áp dụng" cho một DB vừa dựng lại bằng `prisma db push`.
// Chạy: node scripts/baseline-db.js   (đọc DATABASE_URL từ env)
//
// VÌ SAO CẦN: khôi phục sau thảm hoạ đi theo đường `db push` + `npm run restore` (xem README,
// mục "Dựng lại DB từ số không") — chuỗi migration KHÔNG dựng nổi schema từ DB trống. Nhưng
// `db push` không ghi gì vào bảng `_prisma_migrations`, nên DB mới có schema đầy đủ mà lịch sử
// migration trống rỗng. Lần deploy kế tiếp, `start:prod` chạy `prisma migrate deploy` và nó
// TỪ CHỐI NGAY, không chạy migration nào:
//
//     Error: P3005
//     The database schema is not empty.
//
// `start:prod` là `prisma migrate deploy && node dist/main.js`, vế đầu chết thì app KHÔNG bao giờ
// khởi động — dù dữ liệu đã khôi phục đúng từng đồng. Đúng lúc đang cần nó nhất.
//
// Kiểm chứng bằng diễn tập thật 18/9/2026: chạy đủ db push -> restore -> baseline thì
// `migrate deploy` chạy được; bỏ đúng bước baseline thì gãy P3005 như trên.
//
// Script này lấp đúng khoảng đó: ghi tên từng migration vào `_prisma_migrations` để
// `migrate deploy` biết là đã xong. Đây là cách "baseline" chính chủ của Prisma.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

/** Tên mọi migration theo đúng thứ tự thời gian (tên thư mục đã có tiền tố ngày giờ). */
function migrationNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Thiếu DATABASE_URL. Trỏ nó sang DB VỪA DỰNG LẠI rồi chạy lại.');
    process.exitCode = 1;
    return;
  }
  const names = migrationNames();
  console.log(`Đánh dấu ${names.length} migration là đã áp dụng...\n`);

  let marked = 0;
  let already = 0;
  for (const name of names) {
    try {
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], { stdio: 'pipe', shell: process.platform === 'win32' });
      marked++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      // Đã có trong _prisma_migrations rồi thì bỏ qua — chạy lại script phải vô hại.
      const output = `${error.stdout || ''}${error.stderr || ''}`;
      if (/already recorded as applied|is already recorded/i.test(output)) {
        already++;
        console.log(`  · ${name} (đã có sẵn)`);
        continue;
      }
      console.error(`\nDừng ở ${name}:\n${output.trim()}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nXong: ${marked} migration vừa đánh dấu, ${already} đã có sẵn.`);
  console.log('Giờ `prisma migrate deploy` sẽ bỏ qua chúng, app khởi động được bình thường.');
}

if (require.main === module) main();

module.exports = { migrationNames };
