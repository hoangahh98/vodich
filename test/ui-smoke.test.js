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
    featureSet: new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS']),
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
    features: ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS'],
  });

  assert.match(html, /permission-create-form/);
  assert.match(html, /permission-create-action/);
  assert.match(html, /name="username_2"/);
  assert.match(html, /name="features_2"/);
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

test('travel views render dashboard and finance detail without overflow-prone placeholders', async () => {
  const member = {
    id: 1n,
    name: 'An',
    email: 'an@test',
    collections: [{ amount: 100, note: 'ok' }],
    player: { email: 'an@test' },
  };
  const summary = {
    totalSpent: 200,
    totalCollectedDisplay: 100,
    totalAdvanced: 50,
    balance: -100,
    memberSpent: new Map([['1', 200]]),
    memberPaidTotal: new Map([['1', 50]]),
    memberAdvanced: new Map([['1', 50]]),
    memberDebt: new Map([['1', 100]]),
    actualCollected: new Map([['1', 100]]),
    balances: new Map([['1', -100]]),
    paymentSuggestions: [],
  };
  const dashboard = await renderView('travel/index.ejs', {
    ...commonLocals('/travel'),
    trips: [{ id: 1n, name: 'Trip', description: 'Note', destination: { name: 'Đà Nẵng' }, members: [member], expenses: [{ amount: 200 }] }],
    destinations: [{ id: 1n, name: 'Đà Nẵng' }],
  });
  const home = await renderView('home.ejs', commonLocals('/'));
  const detail = await renderView('travel/detail.ejs', {
    ...commonLocals('/travel/trips/1'),
    trip: { id: 1n, name: 'Trip', description: 'Note', destinationId: 1n, destination: { name: 'Đà Nẵng' }, treasurerMemberId: 1n, permissions: [] },
    members: [member],
    expenses: [{ id: 1n, title: 'Ẩm thực', amount: 200, note: 'Bữa tối', spentDate: new Date(), paidByMemberId: 1n, paidByMember: member, splits: [{ memberId: 1n, amount: 200 }] }],
    availablePeople: [],
    admins: [],
    destinations: [{ id: 1n, name: 'Đà Nẵng' }],
    destinationSuggestions: [{ id: 1n, category: 'Quán ăn ngon', name: 'Mì Quảng', address: 'Đà Nẵng', description: '', mapUrl: '' }],
    summary,
    viewerMemberId: null,
    expenseCategories: ['Ẩm thực', 'Khác'],
    suggestionCategories: ['Quán ăn ngon'],
    isTravelAdmin: true,
    today: '2026-07-03',
  });

  const clientDetail = await renderView('travel/detail.ejs', {
    ...commonLocals('/travel/trips/1'),
    trip: { id: 1n, name: 'Trip', description: 'Note', destinationId: 1n, destination: { name: 'Đà Nẵng' }, treasurerMemberId: 1n, permissions: [] },
    members: [member],
    expenses: [{ id: 1n, title: 'Ẩm thực', amount: 200, note: 'Bữa tối', spentDate: new Date(), paidByMemberId: 1n, paidByMember: member, splits: [{ memberId: 1n, amount: 200 }] }],
    availablePeople: [],
    admins: [],
    destinations: [],
    destinationSuggestions: [],
    summary,
    viewerMemberId: 1n,
    expenseCategories: ['Ẩm thực', 'Khác'],
    suggestionCategories: ['Quán ăn ngon'],
    isTravelAdmin: false,
    today: '2026-07-03',
  });

  assert.match(dashboard, /data-travel-index/);
  assert.match(dashboard, /🌴/);
  assert.match(detail, /data-travel-trip-id="1"/);
  assert.match(detail, /data-travel-tabs/);
  assert.match(detail, /data-travel-panel="overview"/);
  assert.match(detail, /travel-expense-form/);
  assert.match(detail, /Tổng ứng trước/);
  assert.match(detail, /Đã trả/);
  assert.match(detail, /🌴/);
  // Client không thấy form thêm khoản chi / thu tiền, nhưng vẫn thấy bảng thành viên.
  assert.doesNotMatch(clientDetail, /travel-expense-form/);
  assert.doesNotMatch(clientDetail, /\/collections/);
  assert.match(clientDetail, /data-travel-tabs/);
  assert.match(home, /pickleball-icon/);
  assert.doesNotMatch(home, /module-card" href="\/score-reader/);
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
