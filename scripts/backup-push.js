// Backup DB rồi đẩy lên repo private (mặc định hoangahh98/private_backupdb).
//
// Chạy tay:  npm run backup:push       (dùng git credential manager của máy)
// Chạy tự động: GitHub Actions .github/workflows/backup.yml gọi script này mỗi ngày,
//               xác thực bằng secret BACKUP_REPO_TOKEN thay vì credential manager.
//
// Biến môi trường:
//   PRIVATE_BACKUP_REPO  URL repo backup (mặc định như trên)
//   BACKUP_REPO_TOKEN    GitHub PAT có quyền ghi repo đó — BẮT BUỘC khi chạy trên CI
//   BACKUP_KEEP          giữ lại bao nhiêu bản có mốc thời gian (mặc định 30)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = process.env.PRIVATE_BACKUP_REPO || 'https://github.com/hoangahh98/private_backupdb.git';
const TOKEN = process.env.BACKUP_REPO_TOKEN || '';
const KEEP = Number.parseInt(process.env.BACKUP_KEEP || '30', 10);

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

/**
 * Nhét token vào URL để clone/push trên CI. KHÔNG bao giờ in URL này ra log —
 * nó chứa token; mọi thông báo đều dùng biến REPO gốc.
 */
function authenticatedRepoUrl() {
  if (!TOKEN) return REPO;
  const url = new URL(REPO);
  url.username = 'x-access-token';
  url.password = TOKEN;
  return url.toString();
}

function main() {
  // 1) Tạo backup mới
  execFileSync(process.execPath, [path.join(__dirname, 'backup-db.js')], { stdio: 'inherit' });
  const latest = path.join(process.cwd(), 'backups', 'latest.json');
  if (!fs.existsSync(latest)) throw new Error('Không thấy backups/latest.json');

  // 2) Clone repo private vào thư mục tạm
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vodich-backup-'));
  const repoDir = path.join(tmp, 'repo');
  git(['clone', '--depth', '1', authenticatedRepoUrl(), repoDir]);

  if (process.env.CI === 'true') {
    git(['config', 'user.email', 'actions@github.com'], repoDir);
    git(['config', 'user.name', 'GitHub Actions'], repoDir);
  }

  // 3) Copy backup
  const dest = path.join(repoDir, 'backups');
  fs.mkdirSync(dest, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(latest, path.join(dest, 'latest.json'));
  fs.copyFileSync(latest, path.join(dest, `backup-${stamp}.json`));

  // 4) Dọn bản cũ: chạy hằng ngày mà giữ hết thì repo phình vô hạn.
  //    latest.json luôn là bản mới nhất nên vẫn khôi phục được ngay cả sau khi dọn.
  pruneOldBackups(dest);

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

function pruneOldBackups(dir) {
  if (!Number.isFinite(KEEP) || KEEP <= 0) return;
  const dated = fs
    .readdirSync(dir)
    .filter((name) => /^backup-.*\.json$/.test(name))
    .sort(); // tên chứa mốc ISO nên sắp theo chữ cái = sắp theo thời gian
  const stale = dated.slice(0, Math.max(0, dated.length - KEEP));
  for (const name of stale) {
    fs.unlinkSync(path.join(dir, name));
    console.log(`  dọn bản cũ: ${name}`);
  }
}

main();
