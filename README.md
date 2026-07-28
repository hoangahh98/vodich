# Vô Địch Tool

Ứng dụng quản lý giải đấu pickleball, thành viên, đội bóng, phân quyền, log hệ thống và tỉ số trực tiếp.

## Công nghệ

- Node.js 20, NestJS, TypeScript
- Prisma + PostgreSQL
- EJS server-rendered UI
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

Unit/domain tests:

```bash
npm test
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

## Tính năng AI (Gemini)

- `GEMINI_API_KEY`: bắt buộc để dùng AI (gợi ý du lịch, phân tích đơn thuốc, game nói chuyện). Lấy tại https://aistudio.google.com/apikey.
- `GEMINI_MODEL`: model dùng, mặc định `gemini-2.0-flash`. Nếu hay bị lỗi 429 (hết hạn mức/ngày của bản free), thử đổi sang model có hạn mức free cao hơn, ví dụ `gemini-1.5-flash`, hoặc bật billing trong Google Cloud để tăng giới hạn.
- App tự thử lại vài lần khi gặp 429/503 tạm thời và báo lỗi thân thiện khi hết lượt.

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
- ⚠️ **KHÔNG commit thư mục `backups/` vào repo này** — repo đang PUBLIC, mà file backup chứa email, hash mật khẩu và dữ liệu y tế. `backups/` đã được `.gitignore`.

## Health checks

- `/healthz`: app process sống.
- `/readyz`: kiểm tra trạng thái sẵn sàng sâu hơn, gồm PostgreSQL, Redis và trạng thái `sessionStore`/`socketAdapter`.

Kiểm tra nhanh hai Render service:

```bash
npm run check:render -- https://service-a.onrender.com https://service-b.onrender.com
```

## Ghi chú kiến trúc

- Controller giữ vai trò routing/render/redirect, nghiệp vụ chính nằm trong service theo domain.
- `TournamentService` và `TeamService` là facade mỏng, các luồng lớn được tách thành service nhỏ để dễ maintain.
- Schema thay đổi đi qua Prisma migration. `prisma migrate deploy` chạy ở HAI chỗ: trong `render:build` và một lần nữa ngay trước khi app khởi động (`start:prod`). Lần thứ hai là lần bảo đảm — xem mục Render.
- Event realtime được chuẩn hóa trong client/server modules để sau này nâng cấp Redis/socket adapter ít chạm code UI.
- Rate limit form login và đăng ký ngoài đang dùng in-memory service để không tăng Redis commands; có thể thay implementation bằng Redis khi lưu lượng lớn hơn.
