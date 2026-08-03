const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ejs = require('ejs');
const { normalizedPath } = require('../dist/logs/log-action');
const { TournamentDetailViewModelBuilder } = require('../dist/tournaments/tournament-detail-view-model');

const root = path.join(__dirname, '..');

function renderView(viewPath, locals) {
  return ejs.renderFile(path.join(root, 'src/views', viewPath), locals);
}

function commonLocals(route = '/') {
  return {
    currentUser: { role: 'ADMIN', displayName: 'Admin', email: 'admin@test' },
    featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'PERMISSIONS']),
    isRoot: true,
    path: route,
    formatMoney: (value) => String(Math.round(Number(value) || 0)),
  };
}

function tournamentLocals(section) {
  const common = commonLocals(`/tournaments/1/${section}`);
  const detail = {
    tournament: {
      id: 1n,
      name: 'Test Cup',
      venue: 'Court 1',
      expectedPlayers: 4,
      courtCost: 100,
      foodCost: 50,
      prizeCost: 200,
      otherCost: 20,
      prizeRate1: 50,
      prizeRate2: 30,
      prizeRate3: 20,
      format: 'GROUP_KNOCKOUT',
      playType: 'DOUBLES',
      courtCount: 2,
      knockoutQualifierCount: 4,
      touchScore: 11,
      maxScore: 15,
      knockoutTouchScore: 15,
      knockoutMaxScore: 19,
      externalRegistrationEnabled: true,
      startTime: new Date(),
      endTime: new Date(),
    },
    registrations: [
      {
        id: 1n,
        playerId: 1n,
        player: { id: 1n, displayName: 'An', email: 'an@test' },
        externalName: null,
        externalEmail: null,
        source: 'PLAYER',
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        paidAmount: 120,
        skillLevel: 'A',
      },
    ],
    reserveRegistrations: [],
    withdrawnRegistrations: [],
    players: [{ id: 2n, displayName: 'Binh', email: 'binh@test', skillLevel: 'B' }],
    matches: [
      {
        id: 1n,
        roundNumber: 1,
        courtNumber: 1,
        stage: 'Vòng bảng',
        groupName: 'A',
        teamA: 'An / Binh',
        teamB: 'Cuong / Dung',
        scoreA: 0,
        scoreB: 0,
        scoreOrder: 2,
        servingTeam: 'A',
        status: 'PLAYING',
      },
    ],
    rankingGroups: [{ groupName: 'A', rows: [{ teamName: 'An / Binh', played: 0, won: 0, lost: 0, rankingPoints: 0, pointDiff: 0 }] }],
    groupBoards: [{ groupName: 'A', teams: ['An / Binh', 'Cuong / Dung'] }],
  };
  const minimumFee = 100;
  const builder = new TournamentDetailViewModelBuilder();
  const detailContext = builder.build({
    currentUser: common.currentUser,
    detail,
    externalLink: 'https://render.example/external-register/1',
    minimumFee,
    tournamentLink: 'https://render.example/tournaments/1/players',
  });
  return {
    ...common,
    ...detail,
    ...detailContext,
    detailContext,
    minimumFee,
    section,
  };
}

test('permission page renders bulk edit and create admin controls', async () => {
  const html = await renderView('permissions.ejs', {
    ...commonLocals('/permissions'),
    admins: [{ id: 2n, username: 'subadmin', displayName: 'Sub Admin', permissions: [{ feature: 'TEAMS' }] }],
    features: ['TOURNAMENTS', 'TEAMS', 'PERMISSIONS'],
  });

  assert.match(html, /permission-create-form/);
  assert.match(html, /permission-create-action/);
  assert.match(html, /name="username_2"/);
  assert.match(html, /name="features_2"/);
});

function logLocals(over = {}) {
  return {
    ...commonLocals('/logs'),
    logs: [
      { createdAt: new Date('2026-08-03T03:00:00Z'), level: 'ERROR', username: 'admin@test', userRole: 'ADMIN',
        category: 'HTTP', action: 'POST /teams/1/expenses', method: 'POST', path: '/teams/1/expenses',
        statusCode: 500, durationMs: 12, details: '', errorMessage: 'boom' },
    ],
    level: 'ERROR',
    levels: ['ERROR', 'WARN', 'INFO', 'ALL'],
    category: 'ALL',
    categories: ['ALL', 'HTTP', 'ACCESS', 'REDIS'],
    user: 'ALL',
    users: [{ value: 'ALL', label: 'Tất cả' }, { value: 'admin@test', label: 'admin@test' }],
    ...over,
  };
}

test('log page filters by user and every filter link carries all three params', async () => {
  const html = await renderView('logs/index.ejs', logLocals({ user: 'admin@test' }));

  assert.match(html, /name="user"/, 'phải có ô chọn tài khoản');
  assert.match(html, /value="admin@test" selected/);
  // Bấm đổi mức mà mất tham số user thì bảng âm thầm quay về "mọi tài khoản".
  assert.match(html, /href="\/logs\?level=WARN&amp;category=ALL&amp;user=admin%40test"/);
  assert.match(html, /href="\/logs\?level=ERROR&amp;category=HTTP&amp;user=admin%40test"/);
  assert.match(html, /Bỏ lọc/, 'đang lọc một người thì phải có đường thoát');
});

test('log page keeps REDIS shortcut, hides clear-filter when unfiltered, and states empty results', async () => {
  const html = await renderView('logs/index.ejs', logLocals());
  assert.match(html, /href="\/logs\?level=ALL&amp;category=REDIS&amp;user=ALL"/, 'nhóm Redis vẫn mở mức về ALL như cũ');
  assert.doesNotMatch(html, /Bỏ lọc/, 'chưa lọc ai thì không bày nút bỏ lọc');

  const empty = await renderView('logs/index.ejs', logLocals({ logs: [] }));
  assert.match(empty, /Không có dòng log nào khớp/, 'bảng rỗng trơn trông như chưa tải xong');
});

/** Lọc theo tài khoản không có dòng nào: ô chọn phải hiện đúng người đó, không nhảy sang người khác. */
test('log page keeps the filtered account in the dropdown even with no rows', async () => {
  const html = await renderView('logs/index.ejs', logLocals({ user: 'ghost@test', logs: [] }));

  assert.match(html, /value="ghost@test" selected/);
  assert.match(html, /không có log/);
});

test('tournament schedule view keeps score modal and registration copy contract', async () => {
  const html = await renderView('tournaments/detail.ejs', tournamentLocals('schedule'));

  assert.match(html, /id="scoreModal"/);
  assert.match(html, /data-score-target="A"/);
  assert.match(html, /data-score-order-select="2"/);
  assert.match(html, /data-score-close data-loading-text=/);
  assert.match(html, /https:\/\/render\.example\/external-register\/1/);
});

test('tournament create and edit forms render prize settings', async () => {
  const common = commonLocals('/tournaments/new');
  const createHtml = await renderView('tournaments/form.ejs', {
    ...common,
    tournament: null,
    action: '/tournaments',
    prizeTotalPaid: 0,
  });
  const editHtml = await renderView('tournaments/form.ejs', {
    ...common,
    tournament: {
      id: 1n,
      name: 'Test Cup',
      venue: 'Court 1',
      expectedPlayers: 4,
      courtCount: 2,
      courtCost: 100,
      foodCost: 50,
      prizeCost: 200,
      otherCost: 20,
      prizeRate1: 50,
      prizeRate2: 30,
      prizeRate3: 20,
      format: 'ROUND_ROBIN',
      playType: 'SINGLES',
      touchScore: 11,
      maxScore: 15,
      knockoutTouchScore: 15,
      knockoutMaxScore: 19,
      knockoutQualifierCount: 2,
      externalRegistrationEnabled: false,
    },
    action: '/tournaments/1/edit',
    returnSection: 'settings',
    prizeTotalPaid: 500,
  });

  assert.match(createHtml, /data-prize-fund/);
  assert.match(createHtml, /Tạo giải|Táº¡o giáº£i/);
  assert.match(editHtml, /data-manual-prize-suggestion/);
  assert.match(editHtml, /\/tournaments\/1\/edit/);
});

test('external registration flow views render form and success login link', async () => {
  const form = await renderView('external-register.ejs', {
    tournament: { id: 1n, name: 'Test Cup' },
  });
  assert.match(form, /name="displayName"/);
  assert.match(form, /name="email"/);
  assert.match(form, /data-loading-text=/);

  const success = await renderView('external-success.ejs', {
    registration: { tournamentId: 1n, externalEmail: 'guest@test', status: 'ACTIVE' },
  });
  assert.match(success, /guest%40test/);
  assert.match(success, /next=/);
});

test('score reader renders for standalone friendly scoring', async () => {
  const html = await renderView('score-reader.ejs', commonLocals('/score-reader'));

  assert.match(html, /data-score-reader/);
  assert.match(html, /id="readerScoreA"/);
  assert.match(html, /\/uploads\/san_pick\.png/);
  assert.match(html, /score-reader-player-card side-a/);
  assert.match(html, /id="readerTeamAPlayerTitle"/);
  assert.match(html, /id="readerTeamBPlayerTitle"/);
  assert.match(html, /id="readerAPlayer1Name"/);
  assert.match(html, /id="readerBPlayer2Name"/);
  assert.match(html, /data-reader-serving-select="B"/);
  assert.doesNotMatch(html, /id="readerWinRally"/);
  assert.doesNotMatch(html, /id="readerLoseRally"/);
  assert.match(html, /data-reader-order="2"/);
  assert.match(html, /\/js\/score-reader\.js/);
  assert.doesNotMatch(html, /\/socket\.io\/socket\.io\.js/);
  assert.doesNotMatch(html, /\/js\/realtime\.js/);
  assert.doesNotMatch(html, /feature-hero-art/);
});

test('tournament route controllers stay split by workflow', () => {
  const controllerRoutes = {
    'src/tournaments/tournament.controller.ts': ['/tournaments', '/tournaments/new', '/tournaments/:id/edit', '/tournaments/:id/delete', '/tournaments/:id/:section'],
    'src/tournaments/tournament-registration.controller.ts': ['/tournaments/:id/registrations', '/tournaments/:id/registrations/bulk', '/tournaments/:id/payments', '/registrations/:id/skill'],
    'src/tournaments/tournament-schedule.controller.ts': ['/tournaments/:id/generate-schedule', '/tournaments/:id/manual-schedule'],
    'src/tournaments/external-registration.controller.ts': ['/external-register/:id'],
  };

  for (const [file, routes] of Object.entries(controllerRoutes)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const route of routes) assert.match(source, new RegExp(escapeRegExp(route)));
  }
});

test('viewport disables mobile zoom and log paths are normalized', async () => {
  const html = await renderView('partials/head.ejs', { title: 'Test' });

  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
  assert.equal(normalizedPath('/tournaments/123/players'), '/tournaments/:id/players');
  assert.equal(normalizedPath('/external-register/456'), '/external-register/:id');
});

/**
 * CA THẬT (31/7/2026): chủ app báo "vẫn zoom được ở mọi trang" dù thẻ meta viewport đã có
 * `user-scalable=no` từ lâu. Nguyên nhân: **iOS bỏ qua thẻ đó từ iOS 10**, nên nó chưa bao
 * giờ có tác dụng trên iPhone — thiết bị chính của người dùng. Phải chặn cử chỉ bằng JS.
 * Test này khoá cả ba lớp lại để lần sau không ai gỡ nhầm một lớp rồi tưởng vẫn còn khoá.
 */
test('khoá zoom đủ ba lớp: meta + CSS touch-action + chặn cử chỉ bằng JS', async () => {
  const head = await renderView('partials/head.ejs', { title: 'Test' });
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/js/no-zoom.js'), 'utf8');

  // Lớp 1 + 2: script phải nạp ở HEAD (không phải bottom-menu) để cả trang đăng nhập và
  // các màn hình game — vốn không có menu dưới — cũng được khoá.
  assert.match(head, /no-zoom\.js/, 'phải nạp script chặn cử chỉ ngay ở head');
  assert.match(css, /touch-action:\s*pan-x pan-y/, 'CSS phải cấm chụm ngón, chỉ cho cuộn');

  // Lớp 3: iOS chỉ chịu thua ba sự kiện gesture* của Safari.
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    assert.match(js, new RegExp(name), `thiếu chặn ${name} — iOS sẽ vẫn phóng to được`);
  }
  assert.match(js, /touches\.length > 1/, 'phải có phương án dự phòng cho chạm nhiều ngón');
  assert.match(js, /passive:\s*false/, 'không có passive:false thì preventDefault bị bỏ qua');
});

/**
 * CA THẬT (31/7/2026, ngay sau lần trên): zoom đã khoá được nhưng vẫn "kéo lê cả trang sang
 * ngang". Nguyên nhân: `overflow-x: hidden` nằm trong một media query nên chỉ ăn ở màn hẹp,
 * còn `touch-action: pan-x pan-y` thì vẫn cho phép kéo ngang. Nội dung rộng (bảng) phải tự
 * cuộn trong .table-wrap của nó chứ không được đẩy cả trang ra.
 */
test('trang không kéo lê sang ngang được: overflow-x khoá ở quy tắc CHUNG', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');

  // Cắt bỏ mọi khối @media rồi mới soi — quy tắc phải nằm ở phần chung.
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const htmlRule = base.match(/(^|\n)html\s*\{[^}]*\}/);
  const bodyRule = base.match(/(^|\n)body\s*\{[^}]*overflow-x[^}]*\}/);

  assert.ok(htmlRule, 'phải có quy tắc chung cho html');
  assert.match(htmlRule[0], /overflow-x:\s*hidden/, 'html phải chặn kéo ngang');
  assert.ok(bodyRule, 'body cũng phải chặn kéo ngang ở quy tắc chung, không nhét trong @media');
  assert.match(base, /overscroll-behavior:\s*none/, 'chặn kéo quá đà làm trang nhún nhảy');

  // Bảng rộng vẫn phải cuộn được trong khung của nó, nếu không là mất dữ liệu trên màn hẹp.
  assert.match(css, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/, '.table-wrap phải tự cuộn ngang');
});

/** Mọi trang hoàn chỉnh đều phải đi qua partials/head — nếu không là lọt lưới khoá zoom. */
test('không trang nào tự dựng <head> riêng để lọt lưới khoá zoom', () => {
  const views = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ejs')) views.push(full);
    }
  };
  walk(path.join(root, 'src/views'));

  for (const file of views) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/<head\b/.test(source)) continue;
    assert.ok(
      file.endsWith(`partials${path.sep}head.ejs`),
      `${path.relative(root, file)} tự dựng <head> riêng — phải include partials/head để có khoá zoom`,
    );
  }
});

/**
 * CA THẬT: ô `type="date"` trên Safari iOS render theo cỡ nội tại, to hơn ô chứa và ĐÈ
 * lên ô bên cạnh. Đã phải vá riêng cho ba form khác nhau, lần nào cũng phát hiện lại từ đầu,
 * vì bản vá nằm ở từng form thay vì quy tắc chung.
 * Test này khoá bản vá ở quy tắc chung để form tiếp theo không phải dẫm lại vết đó.
 */
test('ô ngày được chuẩn hoá ở quy tắc CHUNG, không vá lẻ theo từng form', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');

  const globalRule = css.match(/input\[type="date"\][^{]*\{[^}]*\}/);
  assert.ok(globalRule, 'phải có quy tắc chung cho input[type="date"]');
  assert.match(globalRule[0], /appearance:\s*none/, 'phải bỏ giao diện native, nếu không iOS tự phình ô');
  assert.match(globalRule[0], /max-width:\s*100%/, 'phải chặn tràn khỏi ô chứa');

  // Không còn bản vá riêng lẻ nào cho ô ngày.
  const perFormPatches = css.match(/^\s*\.[\w-]+\s+input\[type="date"\]/gm) || [];
  assert.deepEqual(
    perFormPatches.map((s) => s.trim()),
    [],
    'ô ngày phải được vá ở quy tắc chung, không thêm bản vá riêng cho từng form',
  );
});

test('score rules clamp and finish status are reusable outside scoreboard UI', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/score-rules.js'), 'utf8'), context);
  const rules = context.window.VodichScoreRules;

  const clamped = rules.clampScores(50, 14, { touchScore: 11, maxScore: 15 });
  assert.equal(clamped[0], 15);
  assert.equal(clamped[1], 14);
  assert.equal(rules.statusFor(15, 14, { touchScore: 11, maxScore: 15 }), 'FINISHED');
  assert.equal(rules.statusFor(11, 10, { touchScore: 11, maxScore: 15 }), 'PLAYING');
});

test('floating menu opens and stays in a static position', async () => {
  const { button, menu } = loadMenuScriptWithDomMock();

  dispatchClick(button);
  assert.equal(menu.classList.contains('open'), true);

  dispatchClick(button);
  assert.equal(menu.classList.contains('open'), false);

  dispatchPointer(button, 'pointerdown', { pointerId: 1, clientX: 320, clientY: 320 });
  dispatchPointer(button, 'pointermove', { pointerId: 1, clientX: 360, clientY: 340 });
  dispatchPointer(button, 'pointerup', { pointerId: 1, clientX: 360, clientY: 340 });
  assert.equal(menu.classList.contains('open'), false);
  assert.equal(menu.style.left || '', '');
  assert.equal(menu.style.top || '', '');
});

function loadMenuScriptWithDomMock() {
  const menu = new FakeElement('nav');
  menu.rect = { left: 300, top: 300, width: 58, height: 58 };
  const button = new FakeElement('button');
  button.parent = menu;
  const document = {
    querySelectorAll: (selector) => (selector === '[data-menu-toggle]' ? [button] : []),
    addEventListener: () => undefined,
  };
  const storage = new Map();
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: () => undefined,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/menu.js'), 'utf8'), {
    document,
    window,
    console,
    setTimeout,
    clearTimeout,
  });

  return { button, menu };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dispatchPointer(element, type, options) {
  element.dispatch(type, {
    pointerType: 'touch',
    button: 0,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...options,
  });
}

function dispatchClick(element) {
  element.dispatch('click', {
    stopPropagation() {
      this.propagationStopped = true;
    },
  });
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, ...event });
    }
  }

  closest(selector) {
    return selector === '.bottom-menu' ? this.parent : null;
  }

  contains(target) {
    return target === this || target === this.parent;
  }

  getBoundingClientRect() {
    return {
      left: Number.parseFloat(this.style.left) || this.rect.left,
      top: Number.parseFloat(this.style.top) || this.rect.top,
      width: this.rect.width,
      height: this.rect.height,
    };
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  toggle(value) {
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }

  contains(value) {
    return this.values.has(value);
  }
}
