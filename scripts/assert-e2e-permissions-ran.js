/**
 * Chốt chặn cuối của CI: bộ e2e phân quyền tự `test.skip` khi thiếu E2E_DATABASE_URL.
 * Rất tiện lúc chạy máy cá nhân, nhưng trên CI thì đó là bẫy — test bảo mật không chạy
 * mà pipeline vẫn xanh. Script này biến "im lặng bỏ qua" thành lỗi ồn ào.
 */
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_SPEC = 'permissions.spec.js';
const MIN_TESTS = 8;
const reportPath = path.join(__dirname, '..', 'test-results', 'results.json');

if (!fs.existsSync(reportPath)) {
  fail(`Không thấy ${path.relative(process.cwd(), reportPath)}. Playwright chưa chạy hoặc thiếu reporter json.`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const results = [];

for (const suite of report.suites || []) collect(suite);

function collect(suite) {
  for (const spec of suite.specs || []) {
    for (const testCase of spec.tests || []) {
      results.push({ file: spec.file || suite.file || '', title: spec.title, status: testCase.status });
    }
  }
  for (const child of suite.suites || []) collect(child);
}

const permissionTests = results.filter((r) => r.file.replace(/\\/g, '/').endsWith(REQUIRED_SPEC));

if (permissionTests.length < MIN_TESTS) {
  fail(`Chỉ thấy ${permissionTests.length} test trong ${REQUIRED_SPEC}, cần ít nhất ${MIN_TESTS}.`);
}

const skipped = permissionTests.filter((r) => r.status === 'skipped');
if (skipped.length) {
  fail(
    `${skipped.length}/${permissionTests.length} test phân quyền bị BỎ QUA — gần như chắc chắn do thiếu E2E_DATABASE_URL.\n` +
      skipped.map((r) => `  - ${r.title}`).join('\n'),
  );
}

console.log(`OK: ${permissionTests.length} test phân quyền đã chạy thật (không có test nào bị skip).`);

function fail(message) {
  console.error(`\n[e2e-phân-quyền] ${message}\n`);
  process.exit(1);
}
