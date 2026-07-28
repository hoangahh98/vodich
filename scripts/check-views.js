/**
 * Quét cấu trúc HTML của MỌI file .ejs mà không cần render.
 *
 * Bỏ các thẻ EJS ra trước khi soi, vì `<%= x %>` có chứa dấu `>` — chính chỗ này đã làm
 * một lần sửa hàng loạt bằng regex chèn thẻ vào GIỮA thuộc tính `action` của 4 form
 * (28/7/2026). Render vẫn "thành công", nên chỉ soi cấu trúc mới bắt được.
 *
 * Chạy: node scripts/check-views.js
 */
const fs = require('node:fs');
const path = require('node:path');

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');

function listViews(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listViews(full));
    else if (entry.name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

/** Bỏ thẻ EJS, comment HTML và nội dung script/style — chỗ nào cũng có thể chứa `<`, `>` hợp lệ. */
function stripForScan(source) {
  return source
    .replace(/<%[\s\S]*?%>/g, 'EJS')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
}

function scan(file) {
  const cleaned = stripForScan(fs.readFileSync(file, 'utf8'));
  const problems = [];

  // Thẻ mở chưa đóng đã có `<` khác chen vào.
  for (const snippet of cleaned.match(/<\/?[a-zA-Z][^<>]*</g) || []) {
    problems.push({ kind: 'thẻ bị chen ngang', snippet });
  }

  // Mảnh thuộc tính lọt ra ngoài thẻ, kiểu `...">/delete" data-confirm="..."`.
  for (const snippet of cleaned.match(/>[^<>]*\b[a-z-]+="[^"<>]*"/g) || []) {
    if (/^>\s*$/.test(snippet)) continue;
    problems.push({ kind: 'mảnh thuộc tính lọt ra ngoài thẻ', snippet });
  }

  return problems;
}

const files = listViews(VIEWS_DIR);
let broken = 0;
for (const file of files) {
  const problems = scan(file);
  if (!problems.length) continue;
  broken++;
  console.log(`\n❌ ${path.relative(process.cwd(), file).split(path.sep).join('/')}`);
  for (const p of problems.slice(0, 5)) {
    console.log(`   [${p.kind}] ${p.snippet.replace(/\s+/g, ' ').slice(0, 150)}`);
  }
  if (problems.length > 5) console.log(`   ... và ${problems.length - 5} chỗ nữa`);
}

console.log(`\nĐã quét ${files.length} file .ejs — ${broken} file có vấn đề cấu trúc.`);
process.exitCode = broken ? 1 : 0;
