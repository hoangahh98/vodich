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

test('vòng quay chia trận có mặt và mang theo danh sách vận động viên', async () => {
  const html = await renderView('tournaments/detail.ejs', tournamentLocals('schedule'));

  assert.match(html, /data-spin-open/, 'thiếu nút mở vòng quay cạnh nút Chia trận');
  assert.match(html, /data-spin-modal/, 'thiếu khung vòng quay');
  assert.match(html, /\/js\/spin-pairing\.js/, 'phải nạp phần rule trước phần giao diện');
  assert.match(html, /\/js\/spin-draw\.js/);

  // Bánh xe thật (múi + kim), không còn là cột tên chạy dọc như bản đầu.
  assert.match(html, /data-spin-wheel/, 'thiếu chỗ cắm bánh xe');
  assert.match(html, /wheel-pointer/, 'bánh xe không có kim thì không biết dừng ở đâu');
  assert.match(html, /data-spin-pool/, 'thiếu nhãn cho biết đang bốc trong nhóm nào');
  assert.match(html, /data-spin-picked/, 'thiếu chỗ hiện cặp đang ghép');
  assert.doesNotMatch(html, /spin-reel/, 'ô quay kiểu cột tên cũ phải gỡ hẳn');
  assert.doesNotMatch(html, /wheel-hub"/, 'nút quay trong lòng bánh xe đã bỏ, chỉ còn nút ngoài');
  assert.match(html, /data-tournament-id/, 'thiếu id giải để lưu bản nháp riêng cho từng giải');
  // wheel.js phải nạp TRƯỚC spin-draw.js, nếu không spin-draw thoát sớm và nút quay im lìm.
  assert.ok(html.indexOf('/js/wheel.js') < html.indexOf('/js/spin-draw.js'), 'sai thứ tự nạp script');

  // Dữ liệu đi qua data-* chứ không phải <script> nhúng, vì CSP chặn script inline.
  const players = html.match(/data-players="([^"]*)"/);
  assert.ok(players, 'vòng quay phải nhận danh sách VĐV qua data-players');
  const parsed = JSON.parse(players[1].replace(/&#34;/g, '"').replace(/&amp;/g, '&'));
  assert.deepEqual(parsed, [{ name: 'An', skill: 'A' }]);
  assert.doesNotMatch(html, /<script>[^<]*data-players/, 'không được nhúng dữ liệu bằng script inline');
});

test('thi đơn vẫn có chọn đội thủ công và vòng quay; đánh bảng có ô chọn bảng', async () => {
  const locals = tournamentLocals('schedule');
  const registration = (id, name) => ({ ...locals.registrations[0], id: BigInt(id), playerId: BigInt(id), player: { id: BigInt(id), displayName: name, email: `${id}@test` } });
  locals.registrations = ['An', 'Bình', 'Cường', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hà'].map((name, index) => registration(index + 1, name));
  locals.tournament = { ...locals.tournament, playType: 'SINGLES', knockoutQualifierCount: 4 };
  // Các phần con nhận locals qua `detailContext` (xem detail.ejs) nên phải ghi vào đó.
  locals.detailContext = { ...locals.detailContext, manualGroupCount: 2 };
  const html = await renderView('tournaments/detail.ejs', locals);

  assert.match(html, /Chọn đội thủ công/, 'thi đơn cũng phải chọn được đội thủ công');
  assert.match(html, /name="teamA_8"/, 'thi đơn: mỗi người một ô');
  assert.doesNotMatch(html, /name="teamB_1"/, 'thi đơn không có ô thành viên 2');
  assert.match(html, /name="group_1"/, 'đánh bảng phải có ô chọn bảng cho từng đội');
  assert.match(html, /<option value="B">B<\/option>/, 'ô bảng phải liệt kê đủ số bảng');
  assert.match(html, /data-spin-open/, 'thi đơn cũng phải có vòng quay');
  assert.match(html, /data-play-type="SINGLES"/);
  assert.match(html, /data-group-count="2"/);

  // Vòng tròn thi đôi: có ghép tay, không có ô bảng.
  const roundRobin = tournamentLocals('schedule');
  roundRobin.registrations = locals.registrations;
  roundRobin.tournament = { ...roundRobin.tournament, format: 'ROUND_ROBIN' };
  roundRobin.detailContext = { ...roundRobin.detailContext, manualGroupCount: 1 };
  const rrHtml = await renderView('tournaments/detail.ejs', roundRobin);
  assert.match(rrHtml, /Ghép đội thủ công/);
  assert.match(rrHtml, /name="teamB_4"/);
  assert.doesNotMatch(rrHtml, /name="group_1"/, 'vòng tròn không có bảng');
  assert.match(rrHtml, /data-spin-open/);
});

test('vòng quay không hiện ở thể thức đôi xoay vòng (đội tự đổi mỗi vòng)', async () => {
  const locals = tournamentLocals('schedule');
  locals.tournament = { ...locals.tournament, format: 'AMERICANO' };
  const html = await renderView('tournaments/detail.ejs', locals);

  assert.doesNotMatch(html, /data-spin-open/);
  assert.doesNotMatch(html, /data-spin-modal/);
  assert.doesNotMatch(html, /thủ công/, 'đôi xoay vòng không có ghép đội thủ công');
});

test('tournament create form only asks for info; prize settings live in Cài đặt', async () => {
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

  assert.doesNotMatch(createHtml, /data-prize-fund/);
  assert.doesNotMatch(createHtml, /name="courtCost"/);
  assert.match(createHtml, /name="name"/);
  assert.match(createHtml, /Tạo giải|Táº¡o giáº£i/);
  assert.doesNotMatch(editHtml, /name="prizeRate1"/);
  assert.match(editHtml, /\/tournaments\/1\/edit/);

  // Cấu hình (thể thức, lệ phí + chi phí, giải thưởng) nằm ở mục Cài đặt, gửi về /config.
  const settingsHtml = await renderView('tournaments/detail.ejs', tournamentLocals('settings'));
  assert.match(settingsHtml, /\/tournaments\/1\/config/);
  assert.match(settingsHtml, /name="feePerPlayer"[^>]*required/);
  assert.match(settingsHtml, /data-prize-fund/);
  assert.match(settingsHtml, /data-manual-prize-suggestion/);
  assert.match(settingsHtml, /data-min-teams="6"/);
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

/**
 * CA THẬT: con lăn chuột không cuộn được trang NÀO, chỉ kéo tay thanh cuộn bên phải mới ăn.
 *
 * Thủ phạm là hai thuộc tính vô hại khi đứng riêng nhưng chết người khi đứng chung trên
 * `body`: `overflow-x: hidden` khiến `overflow-y` của body bị spec tính lại thành `auto`, tức
 * body trở thành vùng cuộn — nhưng nó cao đúng bằng nội dung nên không có gì để cuộn. Con lăn
 * đi vào body trước, phải chain lên `html` mới cuộn được trang, và `overscroll-behavior: none`
 * ở body chặn đúng cái chain đó.
 *
 * Đo được bằng Playwright: giữ nguyên -> scrollY = 0 sau khi lăn 500px; bỏ overscroll-behavior
 * ở body -> scrollY = 500. Vì thế `overscroll-behavior` CHỈ được đặt ở `html`.
 */
test('lăn chuột cuộn được trang: body không được chặn scroll chaining', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

  for (const rule of base.match(/(^|\n)body\s*\{[^}]*\}/g) || []) {
    assert.doesNotMatch(
      rule,
      /overscroll-behavior/,
      'body có overflow-x:hidden nên là vùng cuộn; thêm overscroll-behavior ở đây là khoá luôn con lăn chuột của cả trang',
    );
  }

  const htmlRule = base.match(/(^|\n)html\s*\{[^}]*\}/);
  assert.match(htmlRule[0], /overscroll-behavior:\s*none/, 'chặn kéo quá đà vẫn phải còn, nhưng đặt ở html');
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

/**
 * Vòng quay đứng riêng ở /vong-quay — công cụ vui cạnh "Đọc điểm", KHÔNG thuộc module nào.
 * Nó không được đòi tournament/team hay featureSet nào cả, chỉ cần locals chung.
 */
test('trang vòng quay đứng riêng dựng được và không dính module nào', async () => {
  const html = await renderView('wheel.ejs', commonLocals('/vong-quay'));

  assert.match(html, /data-wheel-rotor/, 'thiếu chỗ cắm bánh xe');
  assert.match(html, /wheel-pointer/, 'thiếu kim chỉ');
  assert.match(html, /data-wheel-input/, 'thiếu ô nhập danh sách tên');
  assert.match(html, /data-wheel-spin/, 'thiếu nút quay');
  assert.ok(html.indexOf('/js/wheel.js') < html.indexOf('/js/wheel-of-names.js'), 'sai thứ tự nạp script');
  assert.doesNotMatch(html, /\/tournaments|\/teams|\/permissions/, 'trang vòng quay không được kéo module khác vào');
});

/** Vòng quay chỉ nằm trong menu ☰ giống "Đọc điểm", KHÔNG chiếm một ô ngoài trang chủ. */
test('vòng quay chỉ có lối vào từ menu ba gạch, không có ô ngoài trang chủ', async () => {
  const home = await renderView('home.ejs', commonLocals('/'));
  assert.doesNotMatch(home, /module-card[^"]*ht-wheel/, 'không được bày ô Vòng quay ở lưới module');
  // Vẫn phải với tới được: link nằm trong menu dưới mà trang chủ có include.
  assert.match(home, /href="\/vong-quay"/, 'menu trang chủ phải có mục Vòng quay');

  const menu = await renderView('partials/bottom-menu.ejs', commonLocals('/vong-quay'));
  assert.match(menu, /class="active" href="\/vong-quay"/, 'đang ở trang vòng quay thì menu phải sáng mục đó');
  assert.match(menu, /href="\/"/, 'menu trang con luôn phải có lối về trang chủ');
});

// ─────────────────────────── Chi tiêu gia đình ───────────────────────────

function householdLocals(section, over = {}) {
  const common = commonLocals(`/household/1/${section}`);
  const labels = {
    source: { BANK: 'Tài khoản ngân hàng', CARD: 'Thẻ tín dụng', CASH: 'Tiền mặt', LOAN: 'Khoản vay' },
    purpose: { LIVING: 'Chi tiêu', SAVING: 'Tiết kiệm', DEBT: 'Trả nợ', RESERVE: 'Dự phòng', LENDING: 'Cho vay', INCOME: 'Thu nhập' },
    tx: { EXPENSE: 'Chi', INCOME: 'Thu', TRANSFER: 'Chuyển' },
    bank: { VPBANK: 'VPBank', MSB: 'MSB', OTHER: 'Khác' },
  };
  const sources = [
    { id: 1n, name: 'VPBank Diện', kind: 'BANK', bank: 'VPBANK', matchKey: '0382079196', ownerName: 'Vợ', openingBalance: 10000000, creditLimit: 0, interestRate: 0, statementDay: 0, dueDay: 0, active: true },
    { id: 2n, name: 'Thẻ MSB', kind: 'CARD', bank: 'MSB', matchKey: '3065', ownerName: '', openingBalance: 0, creditLimit: 20000000, interestRate: 0, statementDay: 20, dueDay: 5, active: true },
  ];
  const purposes = [
    { id: 11n, name: 'Lương vợ', kind: 'INCOME', monthlyPlan: 0, active: true },
    { id: 12n, name: 'Ăn uống', kind: 'LIVING', monthlyPlan: 5000000, active: true },
  ];
  const recurrings = [{ id: 21n, name: 'Tiền học', kind: 'EXPENSE', sourceId: 1n, targetSourceId: null, purposeId: 12n, amount: 2000000, interestMode: 'NONE', dayOfMonth: 10, startMonth: '2026-09', endMonth: null, active: true, note: '', source: sources[0], targetSource: null }];
  const balances = [
    { source: { ...sources[0], id: '1' }, balance: 9850000, available: 0 },
    { source: { ...sources[1], id: '2' }, balance: 86093, available: 19913907 },
  ];
  const transactions = [
    { id: '31', kind: 'EXPENSE', sourceId: '2', targetSourceId: null, purposeId: null, recurringId: null, amount: 86093, interest: 0, month: '2026-09', status: 'NEW', occurredAt: new Date('2026-09-07T11:22:00Z'), description: 'Shopee', sourceName: 'Thẻ MSB', targetName: '', purposeName: '', purposeKind: '', recurringName: '' },
    { id: '32', kind: 'INCOME', sourceId: '1', targetSourceId: null, purposeId: '11', recurringId: null, amount: 30000000, interest: 0, month: '2026-09', status: 'CONFIRMED', occurredAt: new Date('2026-09-05T03:00:00Z'), description: 'Lương', sourceName: 'VPBank Diện', targetName: '', purposeName: 'Lương vợ', purposeKind: 'INCOME', recurringName: '' },
  ];
  return {
    ...common,
    featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'HOUSEHOLD', 'PERMISSIONS']),
    labels,
    section,
    household: { id: 1n, name: 'Nhà mình', description: 'Sổ chung', ownerAdmin: { displayName: 'Admin', username: 'admin' }, permissions: [], playerAccess: [], telegramChatId: null },
    selectedMonth: '2026-09',
    sources,
    purposes,
    recurrings,
    admins: [],
    players: [{ id: 5n, displayName: 'Vợ', email: 'vo@test' }],
    members: [],
    inbox: [{ id: 1n, text: 'Tin lạ\nkhông đọc được', receivedAt: new Date() }],
    balances,
    balanceById: Object.fromEntries(balances.map((item) => [item.source.id, item])),
    totals: { cash: 9850000, debt: 86093 },
    report: { month: '2026-09', income: 30000000, living: 86093, saving: 0, reserve: 0, lending: 0, debt: { total: 0, principal: 0, interest: 0 }, cardPayment: 0, used: 86093, free: 29913907, unclassified: { count: 1, total: 86093 }, byPurpose: [{ purpose: { id: '12', name: 'Ăn uống', kind: 'LIVING', monthlyPlan: 5000000, active: true }, actual: 0, plan: 5000000, count: 0 }], cardSpending: 86093 },
    expectations: [{ recurring: { ...recurrings[0], id: '21', sourceId: '1' }, expected: 2000000, principal: 2000000, interest: 0, dueDate: new Date('2026-09-10T05:00:00Z'), transaction: null, paid: false, overdue: false }],
    transactions,
    unclassified: transactions.filter((tx) => tx.kind === 'EXPENSE' && !tx.purposeId),
    unclassifiedAll: 1,
    months: ['2026-09'],
    linked: false,
    linkCode: 'AB12CD34',
    ...over,
  };
}

test('chi tiêu: trang danh sách hộ có form tạo cho admin và thẻ hộ', async () => {
  const html = await renderView('household/index.ejs', { ...commonLocals('/household'), featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'HOUSEHOLD', 'PERMISSIONS']), households: [{ id: 1n, name: 'Nhà mình', description: '', _count: { sources: 2, playerAccess: 1 }, unclassifiedCount: 3, telegramChatId: '-100' }] });
  assert.match(html, /action="\/household"/, 'admin phải tạo được hộ');
  assert.match(html, /Nhà mình/);
  assert.match(html, /3 chưa phân loại/);
  assert.match(html, /class="active" href="\/household"/, 'thanh dưới phải đánh dấu mục Chi tiêu');
});

test('chi tiêu: từng mục của trang hộ render đủ nút cho admin', async () => {
  const overview = await renderView('household/detail.ejs', householdLocals('overview'));
  assert.match(overview, /Còn tự do/);
  assert.match(overview, /Khoản định kỳ chưa ghi nhận/);
  assert.match(overview, /transactions\/31\/purpose/, 'khoản chưa phân loại phải chọn được mục đích ngay ở Tổng quan');
  assert.match(overview, /\/js\/household\.js/);

  const transactions = await renderView('household/detail.ejs', householdLocals('transactions'));
  assert.match(transactions, /data-tx-kind/, 'form ghi giao dịch có ô loại điều khiển ô nguồn đích');
  assert.match(transactions, /name="targetSourceId"/);
  assert.match(transactions, /Tin Telegram chưa đọc được/);
  assert.match(transactions, /transactions\/31\/delete/);

  const sources = await renderView('household/detail.ejs', householdLocals('sources'));
  assert.match(sources, /name="matchKey"/, 'nguồn phải khai được số tài khoản / 4 số cuối thẻ');
  assert.match(sources, /còn hạn mức/);

  const recurring = await renderView('household/detail.ejs', householdLocals('recurring'));
  assert.match(recurring, /recurring\/21\/record/, 'khoản chưa trả phải có nút Ghi nhận');
  assert.match(recurring, /FROM_RATE/);

  const settings = await renderView('household/detail.ejs', householdLocals('settings'));
  assert.match(settings, /\/link AB12CD34/, 'mã liên kết Telegram phải hiện khi chưa nối');
  assert.match(settings, /name="playerIds"/, 'chọn được thành viên trong nhà');
  assert.match(settings, /purposes\/12\/delete/);
  assert.doesNotMatch(settings, /<tr[^>]*>\s*<form/, 'form không được nằm trong <tr>');
});

test('chi tiêu: thành viên (CLIENT) chỉ xem, không có form ghi và không có tab Cài đặt', async () => {
  const client = { id: '77', role: 'CLIENT', displayName: 'Vợ', email: 'vo@test' };
  const html = await renderView('household/detail.ejs', householdLocals('transactions', { currentUser: client, isRoot: false, featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'HOUSEHOLD']) }));
  // Form lọc tháng ở hero là GET cùng đường dẫn, nên chỉ soi form POST.
  assert.doesNotMatch(html, /method="post" action="\/household\/1\/transactions"/, 'CLIENT không ghi được giao dịch');
  assert.doesNotMatch(html, /data-tx-kind/, 'CLIENT không có form ghi');
  assert.doesNotMatch(html, /\/household\/1\/settings/, 'CLIENT không thấy tab Cài đặt');
  assert.match(html, /Shopee/, 'nhưng vẫn xem được giao dịch');
});
