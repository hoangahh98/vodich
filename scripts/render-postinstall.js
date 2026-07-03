const { spawnSync } = require('node:child_process');

const isRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_NAME) || Boolean(process.env.RENDER_EXTERNAL_URL);
const force = process.env.FORCE_RENDER_POSTINSTALL_BUILD === 'true';

if (!isRender && !force) {
  process.exit(0);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', 'build'], {
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status || 0);
