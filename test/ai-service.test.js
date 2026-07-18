const assert = require('node:assert/strict');
const test = require('node:test');

const { friendlyError, retryAfterMs } = require('../dist/common/ai.service');

const headers = (map) => ({ headers: { get: (name) => map[name] ?? null } });

test('lỗi 400 thường KHÔNG được báo nhầm thành sai API key', () => {
  // Groq đặt type="invalid_request_error" cho gần như mọi lỗi 400. Trước đây điều kiện
  // bắt cả chữ "invalid" nên nguyên nhân thật (json_validate_failed) bị che mất.
  const detail = '{"error":{"message":"Failed to validate JSON.","type":"invalid_request_error","code":"json_validate_failed"}}';
  const message = friendlyError(400, detail);
  assert.ok(!message.includes('GROQ_API_KEY'), 'không được đổ cho API key');
  assert.ok(message.includes('json_validate_failed'), 'phải giữ nguyên nhân thật để còn debug');
});

test('lỗi thật sự về key vẫn được nhận ra', () => {
  assert.ok(friendlyError(401, '').includes('GROQ_API_KEY'));
  assert.ok(friendlyError(400, 'Invalid API Key provided').includes('GROQ_API_KEY'));
});

test('429 và 503 có thông báo thân thiện riêng', () => {
  assert.ok(friendlyError(429, '').includes('hết lượt'));
  assert.ok(friendlyError(503, '').includes('quá tải'));
});

test('retryAfterMs ưu tiên header retry-after (giây)', () => {
  assert.equal(retryAfterMs(headers({ 'retry-after': '12' })), 12000);
});

test('retryAfterMs đọc được x-ratelimit-reset-tokens dạng "52.065s"', () => {
  assert.equal(retryAfterMs(headers({ 'x-ratelimit-reset-tokens': '52.065s' })), 52065);
});

test('retryAfterMs trả null khi không có header để gọi rơi về backoff mặc định', () => {
  assert.equal(retryAfterMs(headers({})), null);
  assert.equal(retryAfterMs(headers({ 'retry-after': 'abc' })), null);
});
