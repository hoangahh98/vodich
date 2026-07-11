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
- `APP_ADMIN_PASSWORD`: mật khẩu admin gốc khi bootstrap lần đầu.
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

## Backup / khôi phục dữ liệu

Supabase free không có backup tự động, nên có 2 script thủ công:

```bash
npm run backup     # xuất toàn bộ bảng ra backups/backup-<time>.json + backups/latest.json
npm run restore    # phục hồi từ backups/latest.json (hoặc: npm run restore -- đường/dẫn.json)
```

- `restore` chèn theo thứ tự khóa ngoại, bỏ qua bản ghi trùng, KHÔNG xóa dữ liệu hiện có. Chạy `npx prisma migrate deploy` trước để bảng đã tồn tại (vd khi tạo DB Supabase mới).
- ⚠️ **KHÔNG commit thư mục `backups/` vào repo này** — repo đang PUBLIC, mà file backup chứa email, hash mật khẩu và (sau này) dữ liệu y tế. `backups/` đã được `.gitignore`. Muốn lưu backup theo lịch, dùng một trong các cách an toàn: repo **private** riêng, artifact được mã hóa, hoặc Supabase paid có Point-in-Time Recovery. Có thể hẹn giờ chạy `npm run backup` bằng cron trên máy/VPS riêng.

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
- Schema thay đổi đi qua Prisma migration và `npm run render:build`; app không tự chạy DDL lúc startup.
- Event realtime được chuẩn hóa trong client/server modules để sau này nâng cấp Redis/socket adapter ít chạm code UI.
- Rate limit form login và đăng ký ngoài đang dùng in-memory service để không tăng Redis commands; có thể thay implementation bằng Redis khi lưu lượng lớn hơn.
