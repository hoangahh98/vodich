const { expect, test } = require('@playwright/test');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('login page disables mobile zoom', async ({ page }) => {
  await page.goto('/login');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('maximum-scale=1');
  expect(viewport).toContain('user-scalable=no');
});

test('floating menu opens and drags in a real browser', async ({ page }) => {
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

  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  await page.locator('[data-menu-toggle]').evaluate((element, point) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: point.x, clientY: point.y, pointerId: 7, pointerType: 'touch' }));
    element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: point.x - 80, clientY: point.y - 60, pointerId: 7, pointerType: 'touch' }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: point.x - 80, clientY: point.y - 60, pointerId: 7, pointerType: 'touch' }));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

  await expect(page.locator('.bottom-menu')).not.toHaveClass(/open/);
  const left = await page.locator('.bottom-menu').evaluate((element) => Number.parseFloat(element.style.left));
  expect(left).toBeLessThan(box.x);
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
  await page.addScriptTag({ path: path.join(root, 'public/js/scoreboard.js') });

  await page.locator('[data-match-id="1"]').click();
  await expect(page.locator('#scoreModal')).not.toHaveClass(/hidden/);
  await page.locator('[data-score-target="B"]').click();
  await expect(page.locator('#scoreSaveStatus')).toContainText('Chỉ đội đang giao');
  await page.locator('[data-score-target="A"]').click();
  await expect(page.locator('#scoreInputA')).toHaveText('1');
});
