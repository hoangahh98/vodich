const fs = require('node:fs');
const path = require('node:path');
const { expect, test } = require('@playwright/test');

const statePath = path.join(__dirname, '..', '.e2e-state.json');
const hasDatabaseState = Boolean(process.env.E2E_DATABASE_URL) && fs.existsSync(statePath);

/**
 * E2E luồng PHÂN QUYỀN trong trình duyệt thật, chạy hết stack: session cookie → middleware
 * → FeatureGuard → service lọc theo chủ sở hữu.
 *
 * Unit test đã kiểm từng mảnh (authorization.test.js). Ở đây kiểm cái mà unit test không
 * chứng minh được: các mảnh có thật sự được nối vào nhau trên ứng dụng đang chạy hay không.
 */
test.describe('phân quyền giữa hai admin', () => {
  test.skip(!hasDatabaseState, 'E2E_DATABASE_URL chưa được cấu hình');

  let state;
  test.beforeAll(() => {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  });

  async function login(page, username) {
    await page.goto('/login');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(state.adminPassword);
    await page.locator('select[name="role"]').selectOption('ADMIN');
    await page.locator('form button').click();
    await expect(page).toHaveURL(/\/$/);
  }

  test('chưa đăng nhập thì mọi trang trong đều đá về /login', async ({ page }) => {
    for (const url of ['/', '/teams', '/tournaments', '/permissions', '/logs']) {
      await page.goto(url);
      await expect(page, `${url} phải đòi đăng nhập`).toHaveURL(/\/login/);
    }
  });

  test('trang công khai vẫn vào được khi chưa đăng nhập', async ({ page }) => {
    const health = await page.request.get('/healthz');
    expect(health.status()).toBe(200);

    await page.goto(`/external-register/${state.tournamentId}`);
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  test('admin thấy đúng những module được cấp, không thấy phần còn lại', async ({ page }) => {
    await login(page, state.bobUsername);
    // Bob chỉ có TEAMS.
    await expect(page.locator('a[href="/teams"]').first()).toBeVisible();
    await expect(page.locator('a[href="/tournaments"]')).toHaveCount(0);
    await expect(page.locator('a[href="/permissions"]')).toHaveCount(0);
    await expect(page.locator('a[href="/logs"]')).toHaveCount(0);
  });

  test('gõ thẳng URL của module không được cấp vẫn bị chặn 403', async ({ page }) => {
    await login(page, state.bobUsername);
    for (const url of ['/tournaments']) {
      const response = await page.goto(url);
      expect(response.status(), `${url} phải trả 403 chứ không phải mở ra`).toBe(403);
      await expect(page.locator('body')).toContainText('Không có quyền');
    }
  });

  test('admin thường không vào được trang phân quyền và log của admin gốc', async ({ page }) => {
    await login(page, state.aliceUsername);
    for (const url of ['/permissions', '/logs']) {
      const response = await page.goto(url);
      expect(response.status(), `${url} chỉ dành cho admin gốc`).toBe(403);
    }
  });

  test('RÒ DỮ LIỆU: Bob không mở được đội của Alice dù có feature TEAMS', async ({ page }) => {
    await login(page, state.bobUsername);

    // Đội của chính Bob: vào bình thường.
    const own = await page.goto(`/teams/${state.bobTeamId}`);
    expect(own.status()).toBe(200);

    // Đội của Alice: cùng module, khác chủ ⇒ phải bị chặn.
    const other = await page.goto(`/teams/${state.aliceTeamId}`);
    expect(other.status(), 'id đội của người khác không được mở ra').not.toBe(200);
    await expect(page.locator('body')).not.toContainText('Của riêng Alice');
  });

  test('RÒ DỮ LIỆU: danh sách đội của Bob không có đội của Alice', async ({ page }) => {
    await login(page, state.bobUsername);
    await page.goto('/teams');
    await expect(page.locator('body')).toContainText('E2E Bob Team');
    await expect(page.locator('body')).not.toContainText('E2E Alice Team');
  });

  // Đối chứng dương: nếu test này đỏ thì các test "bị chặn" ở trên vô nghĩa,
  // vì có thể chúng xanh chỉ do app chặn nhầm tất cả mọi người.
  test('ĐỐI CHỨNG: chính chủ vẫn mở được giải đấu của mình', async ({ page }) => {
    await login(page, state.aliceUsername);
    await page.goto('/tournaments');
    await expect(page.locator('body')).toContainText('E2E Alice Cup');

    const response = await page.request.get(`/tournaments/${state.aliceTournamentId}/settings`);
    expect(response.status()).toBe(200);
  });

  test('ĐỐI CHỨNG: admin gốc vào được trang phân quyền và log', async ({ page }) => {
    await login(page, state.adminUsername);
    for (const url of ['/permissions', '/logs']) {
      const response = await page.goto(url);
      expect(response.status(), `${url} phải mở với admin gốc`).toBe(200);
    }
  });

  test('GHI: Bob không sửa được đội của Alice bằng POST trực tiếp', async ({ page, baseURL }) => {
    await login(page, state.bobUsername);
    const response = await page.request.post(`/teams/${state.aliceTeamId}/settings`, {
      headers: { origin: baseURL, 'content-type': 'application/x-www-form-urlencoded' },
      form: { name: 'BỊ CHIẾM', description: 'hack' },
      maxRedirects: 0,
    });
    expect(response.status(), 'POST vào tài nguyên của người khác phải bị từ chối').toBe(403);

    // Và tên đội của Alice không đổi.
    await page.goto('/login');
    await login(page, state.aliceUsername);
    await page.goto(`/teams/${state.aliceTeamId}`);
    await expect(page.locator('body')).not.toContainText('BỊ CHIẾM');
  });

  test('CSRF: POST từ Origin lạ bị chặn dù cookie phiên vẫn hợp lệ', async ({ page }) => {
    await login(page, state.bobUsername);
    const response = await page.request.post(`/teams/${state.bobTeamId}/settings`, {
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      form: { name: 'CSRF' },
      maxRedirects: 0,
    });
    expect(response.status(), 'request ghi từ site khác phải bị chặn').toBe(403);
  });

  test('đăng xuất xong thì trang trong đóng lại ngay', async ({ page, baseURL }) => {
    await login(page, state.bobUsername);
    await page.request.post('/logout', { headers: { origin: baseURL }, maxRedirects: 0 });
    await page.goto('/teams');
    await expect(page).toHaveURL(/\/login/);
  });
});
