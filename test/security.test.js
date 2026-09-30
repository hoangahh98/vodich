const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { checkSameOrigin } = require('../dist/common/csrf');
const { safeParams, shouldSkipHttpLog } = require('../dist/logs/log.service');

const root = path.join(__dirname, '..');

// ─── CSRF: chặn POST đến từ site khác ───

function req(method, headers = {}, hostname = 'duhy.onrender.com') {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, hostname, get: (name) => lower[name.toLowerCase()] };
}

test('CSRF: GET không bị đụng vào (chỉ request ghi mới phải kiểm)', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(checkSameOrigin(req(method)).ok, true);
  }
});

test('CSRF: POST cùng origin được đi qua', () => {
  const host = { host: 'duhy.onrender.com' };
  assert.equal(checkSameOrigin(req('POST', { ...host, origin: 'https://duhy.onrender.com' })).ok, true);
  assert.equal(checkSameOrigin(req('POST', { ...host, referer: 'https://duhy.onrender.com/teams/1' })).ok, true);
});

test('CSRF: POST từ site lạ bị chặn', () => {
  const result = checkSameOrigin(req('POST', { host: 'duhy.onrender.com', origin: 'https://evil.example' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /Origin lạ/);
});

test('CSRF: Origin giả dạng tên miền con của kẻ tấn công vẫn bị chặn', () => {
  const result = checkSameOrigin(req('POST', { host: 'duhy.onrender.com', origin: 'https://duhy.onrender.com.evil.example' }));
  assert.equal(result.ok, false, 'khớp tiền tố không được tính là cùng origin');
});

test('CSRF: Sec-Fetch-Site được tin trước Origin', () => {
  const host = { host: 'duhy.onrender.com' };
  // Trình duyệt tự gắn Sec-Fetch-Site, trang web không giả được -> tin nó trước.
  assert.equal(checkSameOrigin(req('POST', { ...host, 'sec-fetch-site': 'same-origin' })).ok, true);
  assert.equal(checkSameOrigin(req('POST', { ...host, 'sec-fetch-site': 'none' })).ok, true, 'người dùng tự mở app');
  assert.equal(checkSameOrigin(req('POST', { ...host, 'sec-fetch-site': 'cross-site' })).ok, false);
  assert.equal(checkSameOrigin(req('POST', { ...host, 'sec-fetch-site': 'same-site' })).ok, false, 'khác origin cùng tên miền cha vẫn chặn');
});

test('CSRF: Sec-Fetch-Site cross-site thắng cả Origin trông có vẻ hợp lệ', () => {
  const result = checkSameOrigin(
    req('POST', { host: 'duhy.onrender.com', origin: 'https://duhy.onrender.com', 'sec-fetch-site': 'cross-site' }),
  );
  assert.equal(result.ok, false, 'Origin do client gửi, Sec-Fetch-Site do trình duyệt gắn — tin cái sau');
});

/**
 * CA THẬT (log production 28/7/2026 10:18:47): iPhone iOS 18.7, app mở từ màn hình chính,
 * Safari gửi đúng chữ `Origin: null`. Bản đầu chặn thẳng -> thao tác ghi đầu tiên sau khi
 * deploy bị 403, app hỏng trên thiết bị chính của người dùng.
 */
test('CSRF: Origin "null" của PWA iOS KHÔNG bị coi là site lạ', () => {
  const iphone = { host: 'duhy.onrender.com', origin: 'null' };
  assert.equal(checkSameOrigin(req('POST', iphone)).ok, true, 'Origin null nghĩa là không khai, không phải đến từ site lạ');

  // Vẫn kiểm được khi có Referer đi kèm.
  assert.equal(checkSameOrigin(req('POST', { ...iphone, referer: 'https://duhy.onrender.com/teams' })).ok, true);
  assert.equal(checkSameOrigin(req('POST', { ...iphone, referer: 'https://evil.example/x' })).ok, false);

  // Và Sec-Fetch-Site vẫn thắng nếu có.
  assert.equal(checkSameOrigin(req('POST', { ...iphone, 'sec-fetch-site': 'cross-site' })).ok, false);
});

test('CSRF: không có tín hiệu nào thì cho qua, dựa vào cookie sameSite=lax', () => {
  const result = checkSameOrigin(req('POST', { host: 'duhy.onrender.com' }));
  assert.equal(result.ok, true, 'chặn ở đây là làm hỏng trình duyệt cũ mà không thêm bảo vệ thật');
  assert.match(result.reason, /sameSite/);
});

test('CSRF: Origin rác không làm nổ server, chỉ bị chặn', () => {
  const result = checkSameOrigin(req('POST', { host: 'duhy.onrender.com', origin: 'không-phải-url' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /không hợp lệ/);
});

test('CSRF: localhost kèm cổng vẫn chạy được (dev và e2e)', () => {
  assert.equal(checkSameOrigin(req('POST', { host: 'localhost:3000', origin: 'http://localhost:3000' }, 'localhost')).ok, true);
});

test('CSRF: CSRF_ALLOWED_ORIGINS mở thêm đúng host được khai báo', () => {
  process.env.CSRF_ALLOWED_ORIGINS = 'https://tenmien-khac.vn';
  try {
    assert.equal(checkSameOrigin(req('POST', { host: 'duhy.onrender.com', origin: 'https://tenmien-khac.vn' })).ok, true);
    assert.equal(checkSameOrigin(req('POST', { host: 'duhy.onrender.com', origin: 'https://con-lai.vn' })).ok, false);
  } finally {
    delete process.env.CSRF_ALLOWED_ORIGINS;
  }
});

// ─── Log: không được ghi bí mật, không được bỏ sót write action ───

test('log: mọi trường nhạy cảm bị che, kể cả tên biến thể', () => {
  const line = safeParams({
    username: 'alice',
    password: 'sieu-bi-mat',
    newPassword: 'cung-bi-mat',
    apiKey: 'gsk_abc',
    api_key: 'gsk_def',
    sessionToken: 'xyz',
    cardNumber: '4111111111111111',
    csrfToken: 'nope',
  });
  assert.match(line, /username=alice/, 'trường bình thường vẫn ghi để còn truy vết được');
  for (const secret of ['sieu-bi-mat', 'cung-bi-mat', 'gsk_abc', 'gsk_def', 'xyz', '4111111111111111', 'nope']) {
    assert.ok(!line.includes(secret), `log KHÔNG được chứa "${secret}"`);
  }
});

test('log: trường nhạy cảm nằm trong object lồng nhau cũng bị che', () => {
  const line = safeParams({ account: { label: 'chính', password: 'lo-mat-roi' }, list: [{ token: 'cung-lo' }] });
  assert.ok(!line.includes('lo-mat-roi'), 'không được ghi mật khẩu lồng bên trong');
  assert.ok(!line.includes('cung-lo'), 'không được ghi token trong mảng');
  assert.match(line, /label:chính/, 'phần không nhạy cảm vẫn giữ để đọc log còn hiểu');
});

test('log: giá trị khổng lồ bị cắt, không phình log', () => {
  const line = safeParams({ note: 'A'.repeat(500000) });
  assert.ok(line.length < 1000, `log phải ngắn, đang là ${line.length} ký tự`);
});

test('log: body rỗng hoặc không phải object thì trả chuỗi rỗng, không nổ', () => {
  assert.equal(safeParams(undefined), '');
  assert.equal(safeParams('chuỗi'), '');
  assert.equal(safeParams({ a: null, b: undefined }), 'a=&b=');
});

test('log: MỌI write action đều được ghi, chỉ tài nguyên tĩnh GET mới bỏ qua', () => {
  const request = (method, p) => ({ method, path: p });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(shouldSkipHttpLog(request(method, '/teams/1/members'), 302), false, `${method} phải được ghi`);
    assert.equal(shouldSkipHttpLog(request(method, '/js/app.js'), 200), false, `${method} vào đường tĩnh vẫn phải ghi`);
  }
  assert.equal(shouldSkipHttpLog(request('GET', '/css/app.css'), 200), true, 'CSS 200 thì bỏ qua cho đỡ rác');
  assert.equal(shouldSkipHttpLog(request('GET', '/css/app.css'), 404), false, 'nhưng hễ lỗi là phải ghi');
  assert.equal(shouldSkipHttpLog(request('GET', '/teams'), 403), false, 'truy cập bị từ chối luôn được ghi');
});

// ─── Bề mặt công khai: danh sách route mở phải là cố ý ───

/**
 * FeatureGuard chạy toàn cục theo kiểu mặc-định-chặn, nên rủi ro còn lại không phải
 * "quên gác" mà là "lỡ mở". Test này khoá danh sách controller được đánh @Public:
 * thêm @Public vào chỗ khác là test đỏ, buộc người sửa phải cân nhắc.
 */
const EXPECTED_PUBLIC = [
  'src/auth/auth.controller.ts', // trang đăng nhập/đăng xuất
  'src/health.controller.ts', // Render gọi khi chưa có session
  'src/tournaments/external-registration.controller.ts', // người ngoài tự đăng ký giải qua link
];

function listControllers(dir = path.join(root, 'src')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listControllers(full));
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

test('chỉ đúng những controller đã được duyệt mới là @Public', () => {
  const actual = listControllers()
    .filter((file) => /^\s*@Public\(\)/m.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(
    actual,
    [...EXPECTED_PUBLIC].sort(),
    'Có controller được mở công khai ngoài danh sách duyệt. Nếu là chủ ý, thêm vào EXPECTED_PUBLIC kèm lý do.',
  );
});

/**
 * Bề mặt công khai duy nhất có dữ liệu thật là trang đăng ký ngoài, nên nó phải kín.
 *
 * CA THẬT: `GET /external-register/:id` chỉ `findUnique` theo id rồi render, trong khi POST mới
 * kiểm `externalRegistrationEnabled`. Endpoint là @Public nên người lạ dò `/1`, `/2`, `/3`... là
 * lấy được TÊN của mọi giải trong hệ thống, kể cả giải chưa hề mở đăng ký ngoài.
 */
const { ExternalRegistrationController } = require('../dist/tournaments/external-registration.controller');

function captureRes() {
  const captured = { status: 200, view: null, data: null };
  const res = {
    locals: {},
    status(code) {
      captured.status = code;
      return res;
    },
    render(view, data) {
      captured.view = view;
      captured.data = data;
      return res;
    },
  };
  return { res, captured };
}

function externalController(findFirst) {
  return new ExternalRegistrationController({ tournament: { findFirst } }, {}, {}, {});
}

test('đăng ký ngoài: chỉ tìm giải ĐANG MỞ đăng ký, không tra theo mỗi id', async () => {
  const seen = [];
  const controller = externalController(async (args) => {
    seen.push(args.where);
    return null;
  });
  const { res, captured } = captureRes();

  await controller.externalRegister(res, '7');

  assert.deepEqual(seen[0], { id: 7n, externalRegistrationEnabled: true }, 'phải lọc ngay trong truy vấn');
  assert.equal(captured.view, 'error', 'giải chưa mở đăng ký thì không được render trang đăng ký');
  assert.equal(captured.status, 404);
});

test('đăng ký ngoài: giải không mở và giải không tồn tại phải trả lời GIỐNG HỆT nhau', async () => {
  // Phân biệt hai câu trả lời chính là xác nhận id nào đang tồn tại — vẫn dò ra danh sách giải.
  const controller = externalController(async () => null);
  const missing = captureRes();
  const closed = captureRes();

  await controller.externalRegister(missing.res, '999999');
  await controller.externalRegister(closed.res, '1');

  assert.equal(missing.captured.status, closed.captured.status);
  assert.deepEqual(missing.captured.data, closed.captured.data);
});

test('đăng ký ngoài: giải đang mở thì vẫn vào được trang đăng ký', async () => {
  const tournament = { id: 3n, name: 'Test Cup', externalRegistrationEnabled: true };
  const controller = externalController(async () => tournament);
  const { res, captured } = captureRes();

  await controller.externalRegister(res, '3');

  assert.equal(captured.view, 'external-register');
  assert.equal(captured.data.tournament, tournament);
});

test('FeatureGuard được đăng ký toàn cục qua APP_GUARD', () => {
  const appModule = fs.readFileSync(path.join(root, 'src/app.module.ts'), 'utf8');
  assert.match(appModule, /provide:\s*APP_GUARD/, 'thiếu APP_GUARD thì mọi route mất lớp gác mặc định');
  assert.match(appModule, /useClass:\s*FeatureGuard/);
});

test('CsrfMiddleware được gắn cho toàn bộ route', () => {
  const appModule = fs.readFileSync(path.join(root, 'src/app.module.ts'), 'utf8');
  assert.match(appModule, /apply\(LocalsMiddleware,\s*CsrfMiddleware\)\.forRoutes\('\*'\)/);
});

test('không controller nào còn tự gắn @UseGuards(FeatureGuard) chồng lên guard toàn cục', () => {
  const offenders = listControllers().filter((file) => fs.readFileSync(file, 'utf8').includes('UseGuards(FeatureGuard)'));
  assert.deepEqual(offenders, [], 'guard toàn cục đã lo rồi, gắn lại chỉ chạy trùng');
});

test('secret không bị nhúng thẳng vào mã nguồn hay lọt ra view', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|ejs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(text), `${file} có vẻ chứa Groq API key thật`);
    assert.ok(!/postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@/.test(text), `${file} có vẻ chứa chuỗi kết nối DB kèm mật khẩu`);
    if (file.endsWith('.ejs')) {
      assert.ok(!/process\.env/.test(text), `${file}: view không được đọc thẳng biến môi trường`);
    }
  }
});

/**
 * Vòng quay đứng riêng là trang mới ở lớp ngoài cùng (HomeController), nơi FeatureGuard chỉ
 * đòi đăng nhập chứ không có `@FeatureAccess`. Kiểm thẳng: chưa đăng nhập thì đá về /login,
 * không được render trang.
 */
const { HomeController } = require('../dist/home.controller');

test('trang vòng quay và trang đọc điểm đều đòi đăng nhập', () => {
  const home = new HomeController();
  for (const route of ['wheel', 'scoreReader']) {
    let rendered = null;
    let redirected = null;
    const res = { locals: {}, render: (view) => (rendered = view), redirect: (url) => (redirected = url) };
    home[route]({ session: {} }, res);
    assert.equal(rendered, null, `${route}: chưa đăng nhập mà vẫn render trang`);
    assert.equal(redirected, '/login', `${route}: phải đá về trang đăng nhập`);
  }
});
