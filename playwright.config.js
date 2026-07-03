const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node dist/main.js',
        env: { ...process.env, DISABLE_APP_LOGS: 'true', DISABLE_HTTP_LOGS: 'true', PORT: '3100', REQUIRE_REDIS: 'false', REDIS_URL: '', SKIP_ADMIN_BOOTSTRAP: 'true', SKIP_PRISMA_CONNECT: 'true' },
        reuseExistingServer: false,
        timeout: 30000,
        url: 'http://127.0.0.1:3100/healthz',
      },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
});
