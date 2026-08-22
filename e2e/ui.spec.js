const { expect, test } = require('@playwright/test');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('login page disables mobile zoom', async ({ page }) => {
  await page.goto('/login');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('maximum-scale=1');
  expect(viewport).toContain('user-scalable=no');
});

test('floating menu opens and stays static in a real browser', async ({ page }) => {
  await page.setContent(`
    <nav class="bottom-menu">
      <button class="mobile-menu-toggle" type="button" data-menu-toggle>☰</button>
      <div class="bottom-menu-inner"><a href="#">Menu</a></div>
    </nav>
  `);
  await page.addStyleTag({ path: path.join(root, 'public/css/app.css') });
  await page.addScriptTag({ path: path.join(root, 'public/js/menu.js') });

  const button = page.locator('[data-menu-toggle]');
  await button.click();
  await expect(page.locator('.bottom-menu')).toHaveClass(/open/);
  await page.mouse.click(10, 10);
  await expect(page.locator('.bottom-menu')).not.toHaveClass(/open/);

  const beforeBox = await button.boundingBox();
  expect(beforeBox).not.toBeNull();
  await page.locator('[data-menu-toggle]').evaluate((element, point) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: point.x, clientY: point.y, pointerId: 7, pointerType: 'touch' }));
    element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: point.x - 80, clientY: point.y - 60, pointerId: 7, pointerType: 'touch' }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: point.x - 80, clientY: point.y - 60, pointerId: 7, pointerType: 'touch' }));
  }, { x: beforeBox.x + beforeBox.width / 2, y: beforeBox.y + beforeBox.height / 2 });

  await expect(page.locator('.bottom-menu')).not.toHaveClass(/open/);
  await expect(page.locator('.bottom-menu')).not.toHaveAttribute('style', /left|top/);
  const afterBox = await button.boundingBox();
  expect(afterBox.x).toBe(beforeBox.x);
  expect(afterBox.y).toBe(beforeBox.y);
});

test('score rules and scoreboard modal enforce serving-side scoring', async ({ page }) => {
  await page.setContent(`
    <div id="matchList" data-tournament-id="1" data-touch-score="11" data-max-score="15" data-knockout-touch-score="15" data-knockout-max-score="19">
      <div data-round-block>
        <span data-done-count>0</span>
        <div class="tran-card" data-match-id="1" data-team-a="A / B" data-team-b="C / D" data-score-a="0" data-score-b="0" data-score-order="2" data-serving-team="A" data-knockout="false" tabindex="0">
          <span class="score-a">0</span><span class="score-b">0</span><span class="score-order">2</span>
          <span class="score-pill bg-primary"></span><span class="match-status bg-secondary"></span>
        </div>
      </div>
    </div>
    <div id="scoreModal" class="hidden" aria-hidden="true">
      <strong id="scoreTeamA"></strong><strong id="scoreTeamB"></strong>
      <div id="scoreSideA" data-serving-side="A"><button data-score-target="A" data-score-delta="1">+</button></div>
      <div id="scoreSideB" data-serving-side="B"><button data-score-target="B" data-score-delta="1">+</button></div>
      <div id="scoreInputA">0</div><div id="scoreInputB">0</div>
      <button data-serving-select="A"></button><button data-serving-select="B"></button>
      <button data-score-order-select="1"></button><button data-score-order-select="2"></button>
      <button data-score-close></button><div id="scoreSaveStatus"></div>
    </div>
  `);
  await page.addScriptTag({
    content: `
      window.__emits = [];
      window.Vodich = {
        getTournamentSocket: () => ({ on() {}, emit: (...args) => window.__emits.push(args) }),
        socketEvents: { SCORE: 'score', SCORE_UPDATED: 'scoreUpdated', SCORE_REJECTED: 'scoreRejected' },
      };
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-rules.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-speech.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard-dom.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard.js') });

  await page.locator('[data-match-id="1"]').click();
  await expect(page.locator('#scoreModal')).not.toHaveClass(/hidden/);
  await page.locator('[data-score-target="B"]').click();
  await expect(page.locator('#scoreSaveStatus')).toContainText('Chỉ đội đang giao');
  await page.locator('[data-score-target="A"]').click();
  await expect(page.locator('#scoreInputA')).toHaveText('1');
});

test('scoreboard can choose team B as first server at 0-0-2', async ({ page }) => {
  await page.setContent(`
    <div id="matchList" data-tournament-id="1" data-touch-score="11" data-max-score="15" data-knockout-touch-score="15" data-knockout-max-score="19">
      <div data-round-block>
        <span data-done-count>0</span>
        <div class="tran-card" data-match-id="1" data-team-a="A / B" data-team-b="C / D" data-score-a="0" data-score-b="0" data-score-order="2" data-serving-team="A" data-knockout="false" tabindex="0">
          <span class="score-a">0</span><span class="score-b">0</span><span class="score-order">2</span>
          <span class="score-pill bg-primary"></span><span class="match-status bg-secondary"></span>
        </div>
      </div>
    </div>
    <div id="scoreModal" class="hidden" aria-hidden="true">
      <strong id="scoreTeamA"></strong><strong id="scoreTeamB"></strong>
      <div id="scoreSetupStep">
        <button data-serving-select="A"></button><button data-serving-select="B"></button>
        <button id="scoreSetupContinue"></button>
      </div>
      <div id="scorePlayStep" class="hidden">
        <button data-serving-select="A"></button><button data-serving-select="B"></button>
      </div>
      <div id="scoreSideA" data-serving-side="A"><button data-score-target="A" data-score-delta="1">+</button></div>
      <div id="scoreSideB" data-serving-side="B"><button data-score-target="B" data-score-delta="1">+</button></div>
      <div id="scoreInputA">0</div><div id="scoreInputB">0</div>
      <button data-score-order-select="1"></button><button data-score-order-select="2"></button>
      <button data-score-close></button><div id="scoreSaveStatus"></div>
    </div>
  `);
  await page.addScriptTag({
    content: `
      window.__emits = [];
      window.Vodich = {
        getTournamentSocket: () => ({ on() {}, emit: (...args) => window.__emits.push(args) }),
        socketEvents: { SCORE: 'score', SCORE_UPDATED: 'scoreUpdated', SCORE_REJECTED: 'scoreRejected' },
      };
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-rules.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-speech.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard-dom.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard.js') });

  await page.locator('[data-match-id="1"]').click();
  await page.locator('#scoreSetupStep [data-serving-select="B"]').click();
  await expect(page.locator('.tran-card')).toHaveAttribute('data-serving-team', 'B');
  await expect(page.locator('.tran-card')).toHaveAttribute('data-score-order', '2');
  await page.locator('#scoreSetupContinue').click();
  await page.locator('#scorePlayStep [data-serving-select="A"]').click();
  await expect(page.locator('.tran-card')).toHaveAttribute('data-serving-team', 'A');
  await expect(page.locator('.tran-card')).toHaveAttribute('data-score-order', '1');
  await page.locator('[data-score-target="A"]').click();
  await expect(page.locator('#scoreInputA')).toHaveText('1');
});

test('scoreboard setup keeps hand one and hand two as different players', async ({ page }) => {
  await page.setContent(`
    <div id="matchList" data-tournament-id="1" data-touch-score="11" data-max-score="15" data-knockout-touch-score="15" data-knockout-max-score="19">
      <div data-round-block>
        <span data-done-count>0</span>
        <div class="tran-card" data-match-id="1" data-team-a="A1 / A2" data-team-b="B1 / B2" data-score-a="0" data-score-b="0" data-score-order="2" data-serving-team="A" data-knockout="false" tabindex="0">
          <span class="score-a">0</span><span class="score-b">0</span><span class="score-order">2</span>
          <span class="score-pill bg-primary"></span><span class="match-status bg-secondary"></span>
        </div>
      </div>
    </div>
    <div id="scoreModal" class="hidden" aria-hidden="true">
      <strong id="scoreTeamA"></strong><strong id="scoreTeamB"></strong>
      <div id="scoreSetupStep">
        <select id="matchAPlayer1"></select><select id="matchAPlayer2"></select>
        <select id="matchBPlayer1"></select><select id="matchBPlayer2"></select>
        <button data-serving-select="A"></button><button data-serving-select="B"></button>
      </div>
      <div id="scorePlayStep" class="hidden"></div>
      <div id="scoreSideA" data-serving-side="A"></div><div id="scoreSideB" data-serving-side="B"></div>
      <div id="scoreInputA">0</div><div id="scoreInputB">0</div>
      <button data-score-order-select="1"></button><button data-score-order-select="2"></button>
      <button data-score-close></button><div id="scoreSaveStatus"></div>
      <div data-match-court-slot="A1"></div><div data-match-court-slot="A2"></div>
      <div data-match-court-slot="B1"></div><div data-match-court-slot="B2"></div>
    </div>
  `);
  await page.addScriptTag({
    content: `
      window.Vodich = {
        getTournamentSocket: () => ({ on() {}, emit() {} }),
        socketEvents: { SCORE: 'score', SCORE_UPDATED: 'scoreUpdated', SCORE_REJECTED: 'scoreRejected' },
      };
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-rules.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-speech.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard-dom.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard.js') });

  await page.locator('[data-match-id="1"]').click();
  await page.locator('#matchAPlayer2').selectOption('1');
  await expect(page.locator('#matchAPlayer1')).toHaveValue('2');
  await expect(page.locator('#matchAPlayer2')).toHaveValue('1');
});

test('scoreboard moves serving highlight from hand one to hand two after team B starts and loses serve', async ({ page }) => {
  await page.setContent(`
    <div id="matchList" data-tournament-id="1" data-touch-score="11" data-max-score="15" data-knockout-touch-score="15" data-knockout-max-score="19">
      <div data-round-block>
        <span data-done-count>0</span>
        <div class="tran-card" data-match-id="1" data-team-a="A1 / A2" data-team-b="B1 / B2" data-score-a="0" data-score-b="0" data-score-order="2" data-serving-team="A" data-knockout="false" tabindex="0">
          <span class="score-a">0</span><span class="score-b">0</span><span class="score-order">2</span>
          <span class="score-pill bg-primary"></span><span class="match-status bg-secondary"></span>
        </div>
      </div>
    </div>
    <div id="scoreModal" class="hidden" aria-hidden="true">
      <strong id="scoreTeamA"></strong><strong id="scoreTeamB"></strong>
      <div id="scoreSetupStep">
        <select id="matchAPlayer1"></select><select id="matchAPlayer2"></select>
        <select id="matchBPlayer1"></select><select id="matchBPlayer2"></select>
        <button data-serving-select="A"></button><button data-serving-select="B"></button>
        <button id="scoreSetupContinue"></button>
      </div>
      <div id="scorePlayStep" class="hidden">
        <button data-serving-select="A"></button><button data-serving-select="B"></button>
      </div>
      <div id="scoreSideA" data-serving-side="A"><button data-score-target="A" data-score-delta="1">+</button></div>
      <div id="scoreSideB" data-serving-side="B"><button data-score-target="B" data-score-delta="1">+</button></div>
      <div id="scoreInputA">0</div><div id="scoreInputB">0</div>
      <button data-score-order-select="1"></button><button data-score-order-select="2"></button>
      <button data-score-close></button><div id="scoreSaveStatus"></div>
      <div data-match-court-slot="A1"></div><div data-match-court-slot="A2"></div>
      <div data-match-court-slot="B1"></div><div data-match-court-slot="B2"></div>
    </div>
  `);
  await page.addScriptTag({
    content: `
      window.Vodich = {
        getTournamentSocket: () => ({ on() {}, emit() {} }),
        socketEvents: { SCORE: 'score', SCORE_UPDATED: 'scoreUpdated', SCORE_REJECTED: 'scoreRejected' },
      };
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-rules.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/score-speech.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard-dom.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard.js') });

  await page.locator('[data-match-id="1"]').click();
  await page.locator('#scoreSetupStep [data-serving-select="B"]').click();
  await page.locator('#scoreSetupContinue').click();
  await page.locator('#scorePlayStep [data-serving-select="A"]').click();
  await expect(page.locator('[data-match-court-slot="A1"]')).toHaveClass(/serving/);

  await page.locator('[data-score-target="A"]').click();
  await expect(page.locator('[data-match-court-slot="A2"]')).toHaveClass(/serving/);

  await page.locator('[data-score-order-select="2"]').click();
  await expect(page.locator('[data-match-court-slot="A1"]')).toHaveClass(/serving/);
});

/**
 * Vòng quay chia trận chạy thật trong trình duyệt.
 *
 * Bộ test node ở test/ chỉ kiểm được LUẬT bốc và HÌNH HỌC bánh xe; chỗ này kiểm phần còn lại:
 * ba file JS có nạp đúng thứ tự không, bấm nút có ăn không, bánh xe có thật sự xoay không, và
 * kết quả có đổ ra form gửi về /manual-schedule không.
 */
test('vòng quay chia trận quay thật rồi chốt được danh sách đội', async ({ page }) => {
  const players = [
    { name: 'An', skill: 'A' },
    { name: 'Bao', skill: 'A' },
    { name: 'Dung', skill: 'D' },
    { name: 'Duy', skill: 'D' },
  ];
  await page.setContent(`
    <button type="button" data-spin-open>Vòng quay</button>
    <div class="score-modal hidden" data-spin-modal data-players='${JSON.stringify(players)}' data-rule="BY_SKILL">
      <div class="score-modal-panel"><div class="score-modal-body">
        <small data-spin-hint></small>
        <div class="wheel-stage">
          <div class="wheel-pool" data-spin-pool></div>
          <div class="wheel-box">
            <div class="wheel-pointer"></div>
            <div class="wheel-rotor" data-spin-wheel></div>
            <button type="button" class="wheel-hub" data-spin-once>QUAY</button>
          </div>
          <div class="spin-picked" data-spin-picked></div>
        </div>
        <div class="spin-actions">
          <button type="button" data-spin-once>Quay</button>
          <button type="button" data-spin-all>Bốc nhanh</button>
          <button type="button" data-spin-reset>Làm lại</button>
        </div>
        <ol data-spin-results></ol><span data-spin-total>0</span>
        <form method="post" action="/tournaments/1/manual-schedule" class="spin-apply hidden" data-spin-form>
          <input type="hidden" name="pairCount" value="0" data-spin-count>
          <div data-spin-inputs></div>
        </form>
      </div></div>
    </div>
  `);
  await page.addStyleTag({ path: path.join(root, 'public/css/app.css') });
  await page.addScriptTag({ path: path.join(root, 'public/js/spin-pairing.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/wheel.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/spin-draw.js') });

  await page.locator('[data-spin-open]').click();
  const modal = page.locator('[data-spin-modal]');
  await expect(modal).not.toHaveClass(/hidden/);

  // Mở ra là đã thấy sẵn bánh xe của lượt tới: 2 người trình A, không phải hình tròn trống.
  await expect(page.locator('[data-spin-pool]')).toHaveText('Trình A');
  await expect(page.locator('.wheel-svg path')).toHaveCount(2);

  const rotor = page.locator('[data-spin-wheel]');
  await page.locator('.wheel-hub').click();
  // Đội đầu tiên bốc xong sau hai lượt quay (một cho mỗi mức trình).
  await expect(page.locator('[data-spin-results] li')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('[data-spin-total]')).toHaveText('1');

  const rotated = Number(/rotate\((-?[\d.]+)deg\)/.exec(await rotor.getAttribute('style'))[1]);
  expect(rotated).toBeGreaterThan(360);

  // Phân trình: mỗi đội đúng một người trình A và một người trình D.
  const first = await page.locator('[data-spin-results] li').first().innerText();
  expect(['An', 'Bao'].filter((name) => first.includes(name))).toHaveLength(1);
  expect(['Dung', 'Duy'].filter((name) => first.includes(name))).toHaveLength(1);

  await page.locator('[data-spin-all]').click();
  await expect(page.locator('[data-spin-results] li')).toHaveCount(2);
  await expect(page.locator('[data-spin-form]')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-spin-count]')).toHaveValue('2');
  await expect(page.locator('[data-spin-inputs] input')).toHaveCount(4);
  // Không ai bị bốc hai lần, không ai bị rơi.
  const names = await page.locator('[data-spin-inputs] input').evaluateAll((inputs) => inputs.map((input) => input.value));
  expect([...names].sort()).toEqual(['An', 'Bao', 'Dung', 'Duy']);

  await page.locator('[data-spin-reset]').click();
  await expect(page.locator('[data-spin-results] li')).toHaveCount(0);
  await expect(page.locator('[data-spin-form]')).toHaveClass(/hidden/);
});

/** Vòng quay đứng riêng ở /vong-quay — bốc tên thuần, có tuỳ chọn bốc xong thì bỏ tên đó ra. */
test('vòng quay tên đứng riêng bốc được và bỏ được tên đã trúng', async ({ page }) => {
  await page.setContent(`
    <main data-wheel-page>
      <div class="wheel-pool" data-wheel-count></div>
      <div class="wheel-box">
        <div class="wheel-pointer"></div>
        <div class="wheel-rotor" data-wheel-rotor></div>
        <button type="button" class="wheel-hub" data-wheel-spin>QUAY</button>
      </div>
      <div class="wheel-winner" data-wheel-winner></div>
      <button type="button" data-wheel-reset>Làm lại</button>
      <textarea data-wheel-input></textarea>
      <label><input type="checkbox" data-wheel-remove> Bỏ tên đã trúng</label>
      <span data-wheel-total>0</span>
      <ol data-wheel-history></ol>
    </main>
  `);
  await page.addStyleTag({ path: path.join(root, 'public/css/app.css') });
  await page.addScriptTag({ path: path.join(root, 'public/js/wheel.js') });
  await page.addScriptTag({ path: path.join(root, 'public/js/wheel-of-names.js') });

  await page.locator('[data-wheel-input]').fill('An\nBình\nCường');
  await expect(page.locator('.wheel-svg path')).toHaveCount(3);
  await expect(page.locator('[data-wheel-count]')).toContainText('3');

  await page.locator('[data-wheel-remove]').check();
  await page.locator('.wheel-hub').click();
  await expect(page.locator('[data-wheel-winner]')).not.toBeEmpty({ timeout: 20000 });
  const winner = (await page.locator('[data-wheel-winner]').innerText()).replace('🎉', '').trim();
  expect(['An', 'Bình', 'Cường']).toContain(winner);

  // Đã bật "bỏ tên đã trúng": người vừa trúng phải rời khỏi cả ô nhập lẫn bánh xe.
  await expect(page.locator('.wheel-svg path')).toHaveCount(2);
  const remaining = await page.locator('[data-wheel-input]').inputValue();
  expect(remaining.split('\n').filter(Boolean)).toHaveLength(2);
  expect(remaining).not.toContain(winner);
  await expect(page.locator('[data-wheel-history] li')).toHaveCount(1);
  await expect(page.locator('[data-wheel-total]')).toHaveText('1');

  await page.locator('[data-wheel-reset]').click();
  await expect(page.locator('[data-wheel-history] li')).toHaveCount(0);
  await expect(page.locator('[data-wheel-winner]')).toBeEmpty();
});
