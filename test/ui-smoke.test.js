const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ejs = require('ejs');

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
  return {
    ...commonLocals(`/tournaments/1/${section}`),
    section,
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
    minimumFee: 100,
    externalLink: 'https://render.example/external-register/1',
    tournamentLink: 'https://render.example/tournaments/1/players',
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

test('floating menu can tap open, tap close, and drag directly', async () => {
  const { button, menu } = loadMenuScriptWithDomMock();

  dispatchPointer(button, 'pointerdown', { pointerId: 1, clientX: 320, clientY: 320 });
  dispatchPointer(button, 'pointermove', { pointerId: 1, clientX: 360, clientY: 340 });
  dispatchPointer(button, 'pointerup', { pointerId: 1, clientX: 360, clientY: 340 });
  dispatchClick(button);

  assert.equal(menu.classList.contains('open'), false);
  assert.equal(menu.style.left, '340px');
  assert.equal(menu.style.top, '320px');

  dispatchPointer(button, 'pointerdown', { pointerId: 2, clientX: 360, clientY: 340 });
  dispatchPointer(button, 'pointerup', { pointerId: 2, clientX: 360, clientY: 340 });
  dispatchClick(button);
  assert.equal(menu.classList.contains('open'), true);

  dispatchPointer(button, 'pointerdown', { pointerId: 3, clientX: 360, clientY: 340 });
  dispatchPointer(button, 'pointerup', { pointerId: 3, clientX: 360, clientY: 340 });
  dispatchClick(button);
  assert.equal(menu.classList.contains('open'), false);
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
