# Vô Địch Tool

Ứng dụng quản lý giải đấu pickleball, thành viên, nhóm, đội bóng (quỹ + khoản thu), phân quyền, log hệ thống
và tỉ số trực tiếp.

## Công nghệ

- Node.js 20, NestJS, TypeScript
- Prisma + PostgreSQL
- EJS server-rendered UI (không phải SPA, CSP `script-src 'self'` nên không có inline script)
- Socket.IO cho realtime scoring
- Redis cho session/realtime khi chạy nhiều Render service

## Chạy local

```bash
npm install
npx prisma generate
npm run start:dev
```

Biến môi trường tối thiểu:

```env
DATABASE_URL=postgresql://...
SESSION_SECRET=replace-with-a-long-random-secret
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=123456789
REDIS_URL=redis://...
REQUIRE_REDIS=false
```

## Biến môi trường production

- `DATABASE_URL`: PostgreSQL connection string.
- `DATABASE_CONNECTION_LIMIT`: số connection Prisma runtime dùng cho mỗi service. Production mặc định là `3` để chạy được nhiều Render service trên Supabase pool nhỏ.
- `DATABASE_POOL_TIMEOUT`: timeout chờ connection của Prisma pool, mặc định `20` giây.
- `SESSION_SECRET`: chuỗi bí mật dài (>=32 ký tự ngẫu nhiên) để ký session cookie. Hai Render service dùng chung app phải dùng cùng giá trị này. **Ở production (`NODE_ENV=production`) app sẽ fail-fast nếu biến này bị thiếu hoặc còn để giá trị mặc định (`change-me`)** — phải đặt giá trị mạnh trong Render env trước khi deploy. Sinh nhanh: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Đổi giá trị này sẽ đăng xuất toàn bộ session hiện tại.
- `REDIS_URL`: Redis URL dùng cho session/socket adapter khi chạy nhiều service.
- `REQUIRE_REDIS`: đặt `true` trên production nhiều service để app fail-fast nếu Redis thiếu hoặc lỗi. Đặt `false` chỉ phù hợp khi chạy một service hoặc môi trường test.
- `APP_ADMIN_USERNAME`: tài khoản admin gốc, mặc định `admin`.
- `APP_ADMIN_PASSWORD`: mật khẩu admin gốc khi bootstrap lần đầu. **Ở production app fail-fast nếu để mật khẩu yếu** (`123456789`, `admin`, `password`, `change-me`, rỗng) — cùng cách xử lý với `SESSION_SECRET`.
- `ALLOW_WEAK_ADMIN_PASSWORD=true`: cửa thoát tạm cho `APP_ADMIN_PASSWORD` yếu (chỉ cảnh báo thay vì chặn khởi động). Dùng khi cần deploy gấp, đổi mật khẩu xong thì gỡ ra.
- `CSRF_ALLOWED_ORIGINS`: danh sách origin được phép gửi request ghi ngoài chính host của app, ngăn cách bằng dấu phẩy. Hiếm khi cần — chỉ dùng khi app đứng sau nhiều tên miền.
- `LOG_ALL_HTTP=true`: ghi cả health check/static asset vào log. Mặc định app bỏ qua các request này để giảm DB writes.

Biến chỉ nên dùng cho test/CI:

- `E2E_DATABASE_URL`: DB test riêng cho Playwright workflow thật. Không dùng production DB.
- `E2E_ADMIN_PASSWORD`: mật khẩu seed admin e2e, mặc định `123456789`.
- `SKIP_PRISMA_CONNECT=true`: chỉ dùng smoke test không DB.
- `SKIP_ADMIN_BOOTSTRAP=true`: bỏ bootstrap admin trong test.
- `DISABLE_APP_LOGS=true`, `DISABLE_HTTP_LOGS=true`: giảm log khi test.

## Render

Build command:

```bash
npm run render:build
```

Start command:

```bash
npm run start:prod
```

Không để Build Command là `yarn`; command đó chỉ install dependency và không sinh `dist/main.js`.

### Migration chạy lúc khởi động, không chỉ lúc build

`start:prod` chạy `prisma migrate deploy` rồi mới bật app, và fail thì app KHÔNG khởi động.

Lý do: đã có sự cố thật (19/07/2026). Commit thêm hai cột vào `med_prescription_item`, code mới lên Render nhưng migration không chạy, thành ra code mới đứng trên schema cũ. Prisma `SELECT` đủ mọi cột nên **mọi** truy vấn chạm bảng đó đều gãy — sập cả phần y tế chứ không riêng tính năng mới, và lỗi hiện ra chỉ là "Có lỗi xảy ra" nên rất khó lần ra nguyên nhân. Chạy migrate ở build là chưa đủ: nó phụ thuộc Render có thật sự chạy đúng `render:build` hay không (`render.yaml` chỉ có tác dụng với service tạo từ Blueprint; service tạo tay thì lấy command trong dashboard).

Fail thì chặn luôn app là cố ý: DB không kết nối được thì app cũng chẳng phục vụ được trang nào, thà chết hẳn và để Render retry còn hơn phục vụ trang gãy.

Vì thế `prisma` nằm ở `dependencies` chứ KHÔNG phải `devDependencies`: `render:build` kết thúc bằng `npm prune --omit=dev`, để ở devDependencies thì lúc chạy CLI đã bị xoá và `start:prod` chết ngay ở bước migrate.

Khi chạy hai Render service cùng source và cùng DB, đặt cùng `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `APP_ADMIN_USERNAME`, `APP_ADMIN_PASSWORD`, và đặt `REQUIRE_REDIS=true`.

## Test

Unit/domain tests (`npm test` = build → kiểm cấu trúc HTML các view → chạy `test/*.test.js`):

```bash
npm test
```

Chạy một file test — test đọc từ `dist/` nên phải build trước:

```bash
npm run build
node --test test/domain.test.js
```

Browser smoke tests không cần DB:

```bash
npm run test:e2e
```

Browser tests có DB thật qua DB test riêng:

```bash
E2E_DATABASE_URL=postgresql://... npm run test:e2e
```

Runner sẽ seed dữ liệu e2e vào DB test và ghi `.e2e-state.json` cục bộ. File này đã được ignore.

Bộ test phân quyền:

- `test/authorization.test.js` — chặn rò dữ liệu giữa hai admin, FeatureGuard, khoá tính năng.
- `test/security.test.js` — CSRF, che secret trong log, danh sách route công khai.
- `test/permission-snapshot.test.js` — snapshot giao diện theo từng vai. Đổi giao diện có chủ ý thì chạy `UPDATE_SNAPSHOTS=1 npm test` rồi **soi kỹ diff** trước khi commit.
- `e2e/permissions.spec.js` — chạy hết stack trong trình duyệt thật. **Chỉ chạy khi có `E2E_DATABASE_URL`**, nếu không nó tự skip. CI đã bật Postgres và có bước `scripts/assert-e2e-permissions-ran.js` để bắt trường hợp bộ test này im lặng không chạy.

Xem [docs/bao-mat.md](docs/bao-mat.md) cho mô hình phân quyền đầy đủ.

## App KHÔNG còn gọi AI

Module **Học vui** (8 game cho bé ở `/games`, gồm cả "Hiệp Sĩ Toán Học") đã gỡ hẳn ngày 18/9/2026 cùng
`AiService`. Nay không còn dòng code nào gọi ra dịch vụ AI, nên **`GROQ_API_KEY`, `GROQ_MODEL` và
`AI_TIMEOUT_MS` là biến chết** — xoá khỏi Render cho gọn. Muốn lấy lại mấy game thì checkout commit ngay
trước commit gỡ.

## Module Chi tiêu đã gỡ (30/9/2026)

Sổ chi tiêu gia đình (nguồn tiền, giao dịch, bot Telegram đọc mail ngân hàng qua Apps Script) đã gỡ hẳn
lần thứ hai — migration `20260930090000_drop_household_module` xoá 9 bảng `household_*` /
`player_household_access`. Dữ liệu cuối đã xuất ra Excel trong `backups/` và còn trong backup hằng đêm;
muốn nạp lại thì checkout commit ngay trước commit gỡ rồi restore ở đó. **`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET` là biến chết** — xoá khỏi Render; nhớ **tắt trigger Apps Script** trên Gmail vì
đường `/telegram/ingest/…` không còn.

## Backup / khôi phục dữ liệu

Supabase free không có backup tự động, nên repo tự lo phần này.

### Backup tự động (đã bật)

`.github/workflows/backup.yml` chạy **mỗi ngày 02:00 giờ Việt Nam**, xuất DB rồi đẩy sang repo backup **private**. Bấm chạy tay được bằng nút *Run workflow* trong tab Actions (nên làm ngay trước khi chạy migration lớn).

Cần đặt 2 secret trong repo này (**Settings → Secrets and variables → Actions**):

| Secret | Giá trị |
|--------|---------|
| `BACKUP_DATABASE_URL` | Connection string Supabase (chính là `DATABASE_URL` production) |
| `BACKUP_REPO_TOKEN` | GitHub PAT có quyền ghi repo backup private |

Tuỳ chọn: `PRIVATE_BACKUP_REPO` (variable) để đổi repo đích, `BACKUP_ALERT_WEBHOOK` (secret) để nhận cảnh báo khi backup hỏng.

⚠️ Cron của GitHub **tự tắt sau 60 ngày repo không có hoạt động** — thỉnh thoảng vẫn nên liếc tab Actions xem lần chạy gần nhất.

### Backup CŨ hơn ngày 3/8/2026: 22 bảng không nạp lại được

Ba module Y tế, Chi tiêu, Du lịch đã bị gỡ hẳn ngày 3/8/2026 (migration
`20260803180000_drop_medical_household_travel`), kèm 22 bảng của chúng. File backup lấy trước
ngày đó vẫn **chứa** dữ liệu ấy, nhưng schema hiện tại không còn bảng để nạp vào.

`restore-db.js` xử lý ca này bằng cách **bỏ qua và in to** từng bảng cùng số dòng bị bỏ, thay vì
chặn cả lần khôi phục — chặn hẳn thì một backup cũ mất luôn khả năng phục hồi 16 bảng còn lại.
Đừng nhầm với ca bảng **vẫn còn** trong schema mà thiếu khai trong `ORDER`: ca đó script vẫn
dừng ngay, vì đó là lỗi thật.

Muốn lấy lại dữ liệu ba module đó thì phải `git checkout` commit **ngay trước** commit gỡ, rồi
chạy `db push` + `restore` ở đó.

### Dựng lại DB từ số không (khi mất Supabase)

**Diễn tập gần nhất 18/9/2026, trên bản backup THẬT** (`latest.json` do Actions xuất đêm 17/9,
551 dòng): dựng Postgres trắng → `db push` → `restore` → `baseline` → `migrate deploy` chạy được
→ **28/28 bảng khớp số dòng** (527 bản ghi; 24 dòng còn lại là hai bảng game đã gỡ, bị bỏ qua
đúng như thiết kế) → **0 bản ghi mồ côi** trên 5 quan hệ khoá ngoại đã soi → tổng tiền khớp từng
đồng (giao dịch chi tiêu, quỹ đội, lệ phí giải) → bộ đếm id đã nhảy qua id lớn nhất. Đối chứng:
bỏ bước `baseline` thì `migrate deploy` gãy P3005 như mô tả bên dưới.

Các lần trước: 3/8/2026 (38/38 bảng, 11.251 bản ghi, trên schema nháp Supabase) và 28/7/2026.

```bash
# 1. Trỏ DATABASE_URL sang DB mới, rồi:
npx prisma db push   # dựng schema thẳng từ prisma/schema.prisma
npm run restore      # nạp dữ liệu từ backups/latest.json
npm run baseline     # đánh dấu mọi migration là ĐÃ chạy — BỎ BƯỚC NÀY LÀ APP KHÔNG LÊN
```

⚠️ **Đừng bỏ `npm run baseline`.** `db push` dựng đủ bảng nhưng không ghi gì vào
`_prisma_migrations`, nên DB mới có schema đầy đủ mà lịch sử migration trống rỗng. Lần deploy kế
tiếp, `start:prod` chạy `prisma migrate deploy` và nó **từ chối ngay**:

```
Error: P3005
The database schema is not empty.
```

Nó không chạy migration nào cả, chỉ dừng. Mà `start:prod` là `prisma migrate deploy && node
dist/main.js` — vế đầu chết thì **app không bao giờ khởi động**, dù dữ liệu đã khôi phục đúng
từng đồng. `npm run baseline` ghi 48 migration vào `_prisma_migrations` để deploy bỏ qua chúng.

**Đã diễn tập thật 18/9/2026** trên Postgres 18 dựng tạm: seed đủ 28 bảng → `backup-db.js` →
DB mới → `db push` + `restore` + `baseline` → `migrate deploy` chạy được, **28/28 bảng khớp số
dòng**, bộ đếm id đã đặt lại (bản ghi mới không đâm vào id cũ), decimal/bigint không sai một
đồng, khoá ngoại nối đúng. Chạy lại đúng kịch bản ấy nhưng BỎ `baseline` thì gãy P3005 như trên —
đó là đối chứng. `test/backup-restore.test.js` khoá để baseline luôn phủ đủ mọi migration.

⚠️ **Phải dùng `db push`, KHÔNG dùng `prisma migrate deploy`.** Chuỗi migration không dựng
được schema từ DB trống: migration đầu tiên (`20260702000000_add_tournament_end_time`) đã là
`ALTER TABLE "tournament"` trong khi không migration nào tạo bảng đó — schema gốc vốn được
tạo bằng `db push` từ trước khi migration ra đời. Chạy `migrate deploy` lên DB trống sẽ chết
ngay ở bước đầu với `ERROR: relation "tournament" does not exist`.

Muốn sửa tận gốc thì **gộp (squash)** 28 migration thành một `0_init` sinh từ
`prisma migrate diff --from-empty --to-schema-datamodel`, rồi trên DB production đánh dấu đã
áp dụng bằng `prisma migrate resolve --applied`. Việc này đụng `_prisma_migrations` của
production nên chưa làm — cần chủ động quyết định.

**Cái gì KHÔNG khôi phục được:** bảng `app_log` (log vận hành) cố ý không nằm trong backup.
Mọi dữ liệu nghiệp vụ khác đều có.

### Backup / khôi phục thủ công

```bash
npm run backup       # xuất ra backups/backup-<time>.json + backups/latest.json
npm run backup:push  # backup rồi đẩy luôn lên repo private
npm run restore      # phục hồi từ backups/latest.json (hoặc: npm run restore -- đường/dẫn.json)
```

- **`AppLog` bị loại khỏi backup mặc định** — nó là log vận hành, chiếm ~80% dung lượng (5MB → 1MB) và phình thêm mỗi ngày. Cần cả log thì chạy `BACKUP_INCLUDE_LOGS=true npm run backup`.
- Repo backup giữ **30 bản** gần nhất kèm mốc thời gian, cộng `latest.json` luôn là bản mới nhất. Đổi bằng `BACKUP_KEEP`.
- Bảng nào Prisma client đọc không được vì **DB chưa migrate** (thiếu cột mới) sẽ được đọc lại bằng SQL thô thay vì bỏ qua. Đây là tình huống hay gặp nhất khi backup ngay trước lúc migrate — bỏ qua là ra bản backup thiếu mà vẫn báo "xong".
- `restore` chèn theo thứ tự khóa ngoại, bỏ qua bản ghi trùng, KHÔNG xóa dữ liệu hiện có. Chạy `npx prisma migrate deploy` trước để bảng đã tồn tại (vd khi tạo DB Supabase mới).
- ⚠️ **KHÔNG commit thư mục `backups/` vào repo này** — repo đang PUBLIC, mà file backup chứa email và hash mật khẩu. `backups/` đã được `.gitignore`.

## Health checks

- `/healthz`: app process sống.
- `/readyz`: kiểm tra trạng thái sẵn sàng sâu hơn, gồm PostgreSQL, Redis và trạng thái `sessionStore`/`socketAdapter`.

Kiểm tra nhanh hai Render service:

```bash
npm run check:render -- https://service-a.onrender.com https://service-b.onrender.com
```

## Thể thức thi đấu

- **Vòng tròn** — đội cố định, đấu vòng tròn một lượt.
- **Đánh bảng + vòng trong** — chia bảng rồi vào tứ kết/bán kết/chung kết.
- **Đôi xoay vòng (Americano)** — mỗi VĐV lần lượt đánh chung đội với những người khác nhau,
  xếp hạng theo **từng cá nhân** (ưu tiên tổng điểm ghi được) chứ không theo cặp. Luôn là đánh
  đôi. Luật chốt 9/2026: app chia người làm **hai bên** (phân trình thì bên mạnh / bên yếu, không
  phân trình thì xáo rồi cắt đôi), vòng nào cũng ghép mỗi người bên này với một người bên kia —
  **không bao giờ ghép cùng bên**, và sau `n/2` vòng ai cũng đã đi với đủ người bên kia đúng một
  lần. Một vòng là `n/2` cặp, mỗi người đúng một cặp: số cặp chẵn thì vòng nào cũng đủ mặt, số cặp
  lẻ thì mỗi vòng có một **cặp nghỉ** (chọn cặp ít nghỉ nhất nên rốt cuộc ai cũng nghỉ đúng một
  lần) và cặp nghỉ **không đánh bù** ở vòng khác — thà ai cũng thiếu một trận còn hơn vài người
  thiếu. Cụ thể: 8 người → 8 trận / 4 vòng, 10 → 10/5, 12 → 18/6, 14 → 21/7, 16 → 32/8; lẻ người
  thì bên mạnh dư một người, mỗi vòng một người nghỉ (9 → 10 trận / 5 vòng, 11 → 12/6).

Kèm theo là **quy tắc ghép cặp** cho đánh đôi:

- **Phân trình** (mặc định) — gom theo trình rồi ghép mức mạnh nhất với mức yếu nhất, tiến dần
  vào giữa. Không phải "A ghép D": giải chỉ có B, C, D thì B ghép D còn C ghép C.
- **Không phân trình** — bỏ qua trình độ, xáo ngẫu nhiên.

### Vòng quay chia trận

Ở tab **Thi đấu** của giải vòng tròn hoặc đánh bảng (cả thi đôi lẫn thi đơn), cạnh nút *Chia trận* có nút
**🎡 Vòng quay**: bốc từng cặp một cách trực quan trước mặt cả nhóm thay vì để máy chia lặng lẽ.

- Giải **phân trình** quay hai ô cùng lúc, mỗi ô một mức trình đang được ghép với nhau.
- Giải **không phân trình** quay hai ô từ cùng một rổ chung.
- Giải **thi đơn** mỗi lượt quay một ô, bốc đúng một người theo thứ tự.
- Đánh bảng thì bốc tới đâu xếp bảng tới đó (đội 1 → A, đội 2 → B...), nhãn bảng hiện ngay trong danh sách.
- Bốc xong bấm *Chốt danh sách này & chia trận* — nó dùng lại đúng luồng ghép cặp thủ công.
- Đang bốc dở mà đóng khung hay rớt mạng thì mở lại vẫn còn: bản nháp nằm trong `localStorage` của máy.

Quy tắc bốc nằm ở `public/js/spin-pairing.js` và **phải khớp với server**; `test/spin-pairing.test.js`
so thẳng kết quả hai bên trên 12 cấu hình mức trình khác nhau.

Ngoài ra còn một **vòng quay bốc tên đứng riêng** ở `/vong-quay`: chỉ cần đăng nhập, không thuộc giải nào,
danh sách tên nằm trong máy người dùng chứ không vào DB.

## Ghi chú kiến trúc

- Controller giữ vai trò routing/render/redirect, nghiệp vụ chính nằm trong service theo domain.
- `TournamentService` và `TeamService` là facade mỏng, các luồng lớn được tách thành service nhỏ để dễ maintain.
- Schema thay đổi đi qua Prisma migration. `prisma migrate deploy` chạy ở HAI chỗ: trong `render:build` và một lần nữa ngay trước khi app khởi động (`start:prod`). Lần thứ hai là lần bảo đảm — xem mục Render.
- Event realtime được chuẩn hóa trong client/server modules để sau này nâng cấp Redis/socket adapter ít chạm code UI.
- Rate limit form login và đăng ký ngoài đang dùng in-memory service để không tăng Redis commands; có thể thay implementation bằng Redis khi lưu lượng lớn hơn.
