const { spawn } = require('node:child_process');

const port = process.env.E2E_PORT || '3100';
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

const server = process.env.E2E_BASE_URL
  ? null
  : spawn(process.execPath, ['dist/main.js'], {
      env: {
        ...process.env,
        DISABLE_APP_LOGS: 'true',
        DISABLE_HTTP_LOGS: 'true',
        PORT: port,
        REDIS_URL: '',
        REQUIRE_REDIS: 'false',
        SKIP_ADMIN_BOOTSTRAP: 'true',
        SKIP_PRISMA_CONNECT: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

if (server) {
  server.stdout.on('data', (chunk) => process.stdout.write(`[e2e-server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[e2e-server] ${chunk}`));
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});

async function main() {
  if (server) await waitForHealth();
  const result = await runPlaywright();
  cleanup();
  process.exit(result);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
      env: { ...process.env, E2E_BASE_URL: baseURL },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`E2E server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${baseURL}/healthz`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for E2E server');
}

function cleanup() {
  if (server && server.exitCode === null) server.kill();
}
