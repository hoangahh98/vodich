/**
 * Bắt HTML dựng sai cấu trúc — cụ thể là thẻ mở chưa đóng đã có thẻ khác chen vào,
 * kiểu `<form action="/x/<input ...>/delete">`.
 *
 * Vì sao cần: EJS render ra chuỗi đó hoàn toàn "thành công", không lỗi gì. Trình duyệt
 * mới là chỗ vỡ — thuộc tính bị cắt ngang nên phần còn lại (`/delete" data-confirm="...`)
 * hiện ra màn hình như chữ, và `action` trỏ sai URL nên bấm vào là lỗi.
 *
 * Snapshot KHÔNG bắt được loại lỗi này nếu ảnh chụp được tạo ra khi HTML đã hỏng sẵn —
 * nó đóng băng luôn cái sai. Nên phải kiểm cấu trúc, không chỉ so chuỗi.
 */

/** Nội dung script/style/comment có thể chứa `<` hợp lệ, bỏ ra trước khi soi. */
function stripNonMarkup(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
}

/**
 * Trả về các đoạn thẻ hỏng. Một thẻ hợp lệ đi từ `<tên` tới `>` mà không gặp `<` nào;
 * gặp `<` trước khi đóng nghĩa là thẻ trước đó chưa kết thúc.
 */
function findMalformedTags(html) {
  const cleaned = stripNonMarkup(html);
  const matches = cleaned.match(/<\/?[a-zA-Z][^<>]*</g) || [];
  return matches.map((snippet) => snippet.slice(0, 160));
}

/** Đếm thẻ mở/đóng của một loại thẻ để bắt trường hợp thiếu `</form>`. */
function countTags(html, tag) {
  const cleaned = stripNonMarkup(html);
  const open = (cleaned.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
  const close = (cleaned.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
  return { open, close };
}

function assertWellFormedHtml(assert, html, label) {
  const malformed = findMalformedTags(html);
  assert.deepEqual(
    malformed,
    [],
    `${label}: có thẻ HTML dựng sai (thẻ mở bị chen ngang). Đoạn đầu tiên:\n  ${malformed[0] || ''}`,
  );
  for (const tag of ['form', 'table', 'select']) {
    const { open, close } = countTags(html, tag);
    assert.equal(open, close, `${label}: <${tag}> mở ${open} lần nhưng đóng ${close} lần`);
  }
}

module.exports = { assertWellFormedHtml, findMalformedTags, countTags };
