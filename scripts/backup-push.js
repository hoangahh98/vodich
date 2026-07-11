// Backup DB rồi đẩy lên repo private (mặc định hoangahh98/private_backupdb).
// Chạy: npm run backup:push
// Yêu cầu: đã đăng nhập git (credential manager) tới GitHub; đặt PRIVATE_BACKUP_REPO nếu muốn repo khác.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = process.env.PRIVATE_BACKUP_REPO || 'https://github.com/hoangahh98/private_backupdb.git';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function main() {
  // 1) Tạo backup mới
  execFileSync(process.execPath, [path.join(__dirname, 'backup-db.js')], { stdio: 'inherit' });
  const latest = path.join(process.cwd(), 'backups', 'latest.json');
  if (!fs.existsSync(latest)) throw new Error('Không thấy backups/latest.json');

  // 2) Clone repo private vào thư mục tạm
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vodich-backup-'));
  const repoDir = path.join(tmp, 'repo');
  git(['clone', '--depth', '1', REPO, repoDir]);

  // 3) Copy backup + commit + push
  const dest = path.join(repoDir, 'backups');
  fs.mkdirSync(dest, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(latest, path.join(dest, 'latest.json'));
  fs.copyFileSync(latest, path.join(dest, `backup-${stamp}.json`));
  git(['add', '-A'], repoDir);
  try {
    git(['commit', '-m', `DB backup ${stamp}`], repoDir);
  } catch {
    console.log('Không có thay đổi để commit.');
    return;
  }
  git(['push', 'origin', 'HEAD'], repoDir);
  console.log(`\nĐã đẩy backup lên ${REPO}`);
}

main();
