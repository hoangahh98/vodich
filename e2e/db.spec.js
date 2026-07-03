const fs = require('node:fs');
const path = require('node:path');
const { expect, test } = require('@playwright/test');

const statePath = path.join(__dirname, '..', '.e2e-state.json');
const hasDatabaseState = Boolean(process.env.E2E_DATABASE_URL) && fs.existsSync(statePath);

test.describe('database-backed workflows', () => {
  test.skip(!hasDatabaseState, 'E2E_DATABASE_URL is not configured');

  let state;

  test.beforeAll(() => {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  });

  test('admin can login with seeded account', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"]').fill(state.adminUsername);
    await page.locator('input[name="password"]').fill(state.adminPassword);
    await page.locator('select[name="role"]').selectOption('ADMIN');
    await page.locator('form button').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('external tournament registration writes through the app', async ({ page }, testInfo) => {
    const email = `e2e-${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@test.local`;
    await page.goto(`/external-register/${state.tournamentId}`);
    await page.locator('input[name="displayName"]').fill('E2E External Player');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('select[name="skillLevel"]').selectOption('B');
    await page.locator('form button').click();

    await expect(page.locator('.login-card')).toContainText(email);
    await expect(page.locator('a[href*="/login?role=CLIENT"]')).toBeVisible();
  });
});
