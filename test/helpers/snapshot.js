const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertWellFormedHtml } = require('./html');

const SNAPSHOT_DIR = path.join(__dirname, '..', '__snapshots__');

/**
 * Snapshot tự viết thay vì dùng `assert.snapshot` của Node: dự án chốt Node 20 (xem
 * package.json engines) mà API đó chỉ có từ Node 22 và còn là experimental.
 *
 * Cách chạy lại khi giao diện đổi có chủ ý:
 *   UPDATE_SNAPSHOTS=1 npm test
 * rồi ĐỌC diff trong git trước khi commit — snapshot chỉ có giá trị nếu người ta thật sự
 * nhìn phần thay đổi, không phải bấm cập nhật cho hết đỏ.
 */
function matchSnapshot(name, content) {
  const file = path.join(SNAPSHOT_DIR, `${name}.snap.html`);
  // Kiểm cấu trúc TRƯỚC khi so/ghi ảnh chụp. Nếu không, một lần chạy với HTML hỏng sẽ
  // ghi đè ảnh chụp bằng chính cái hỏng đó và từ đó về sau test luôn xanh.
  assertWellFormedHtml(assert, content, `snapshot "${name}"`);
  const actual = normalizeHtml(content);

  if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(file, actual, 'utf8');
    if (process.env.UPDATE_SNAPSHOTS !== '1') {
      console.log(`  ↳ tạo snapshot mới: ${path.relative(process.cwd(), file)}`);
    }
    return;
  }

  // Chuẩn hoá cả bản mong đợi: Git trên Windows đổi file đã commit sang CRLF lúc checkout,
  // nên so thô sẽ đỏ toàn bộ snapshot sau mỗi lần clone lại dù nội dung y hệt.
  const expected = normalizeHtml(fs.readFileSync(file, 'utf8'));
  assert.equal(
    actual,
    expected,
    `Snapshot "${name}" đã đổi. Nếu là chủ ý: chạy "UPDATE_SNAPSHOTS=1 npm test" rồi soi kỹ diff trước khi commit.`,
  );
}

/** Bỏ khác biệt vô nghĩa (thụt lề, xuống dòng) để snapshot không đỏ vì format lại HTML. */
function normalizeHtml(html) {
  return String(html)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/>\s+</g, '>\n<');
}

module.exports = { matchSnapshot, normalizeHtml };
