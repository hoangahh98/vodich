# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo và toàn bộ tài liệu/comment dùng tiếng Việt — giữ nguyên quy ước đó khi thêm code mới.

## Lệnh thường dùng

```bash
npm install
npx prisma generate      # bắt buộc sau khi đổi prisma/schema.prisma
npm run start:dev        # nest start --watch, cổng 3000 (hoặc PORT)

npm test                 # = npm run build && node scripts/check-views.js && node --test test/*.test.js
npm run build            # nest build → dist/
npm run check:views      # chỉ quét cấu trúc HTML của các file .ejs
```

**Chạy một file test:** test đọc từ `dist/`, nên phải build trước:

```bash
npm run build
node --test test/domain.test.js
```

**Cập nhật snapshot giao diện theo vai** (chỉ khi đổi view có chủ ý, và phải soi kỹ diff):

```powershell
$env:UPDATE_SNAPSHOTS=1; npm test     # PowerShell
UPDATE_SNAPSHOTS=1 npm test           # bash
```

**Browser tests (Playwright):**

```bash
npm run test:e2e                      # smoke, không cần DB (tự bật SKIP_PRISMA_CONNECT)
E2E_DATABASE_URL=postgresql://... npm run test:e2e   # chạy cả bộ phân quyền
```

`e2e/permissions.spec.js` và `e2e/db.spec.js` **tự skip** nếu thiếu `E2E_DATABASE_URL`.
`scripts/assert-e2e-permissions-ran.js` (chạy trong CI) là chốt bắt trường hợp skip âm thầm.

**Backup / khôi phục / kiểm tra Render:** `npm run backup`, `npm run backup:push`, `npm run restore`, `npm run check:render -- <url> <url>`.

Repo **không có** ESLint/Prettier — không thêm bước lint vào quy trình.

## Kiến trúc

NestJS + TypeScript, render phía server bằng EJS (không phải SPA), Prisma/PostgreSQL (Supabase),
Socket.IO cho tỉ số trực tiếp, deploy trên Render.

- **Controller chỉ routing/render/redirect**; nghiệp vụ nằm trong service theo domain.
- `TournamentService` và `TeamService` là **facade mỏng** ủy quyền sang các service con
  (`tournament-crud`, `tournament-detail`, `tournament-schedule`, `tournament-knockout`,
  `tournament-payment`, `tournament-registration`; `team-crud`, `team-detail`, `team-member`,
  `team-fund`, `team-expense`). Thêm luồng mới thì thêm service con rồi expose qua facade,
  đừng phình facade.
- Render view qua helper `render(res, view, data)` trong `src/common/view.ts` — nó bơm sẵn
  `currentUser`, `featureSet`, `flash`, `formatMoney`, `path`. Gọi `res.render()` trực tiếp là
  mất các locals đó.
- View lớn được tách thành `detail-parts/`, `form-parts/`, `schedule-parts/`.
- Id trong DB là **BigInt**; parse id từ request bằng `parseBigId()` (`src/common/controller-utils.ts`)
  để tránh 500. Tiền tệ đi qua `parseMoney`/`formatMoney` trong `src/common/money.ts`.
- Giá trị enum-like (`PLAY_TYPES`, `TOURNAMENT_FORMATS`, `PAIRING_RULES`, …) khai trong
  `src/common/enums.ts`, chuẩn hóa bằng `oneOf()` trước khi ghi DB.

### Thể thức giải & lịch thi đấu

`TOURNAMENT_FORMATS` có ba giá trị, mỗi giá trị đi một nhánh khác nhau trong
`TournamentScheduleBuilder.fromRegistrations()`:

| Format | Lịch | Xếp hạng |
|---|---|---|
| `ROUND_ROBIN` | Đội cố định, vòng tròn một lượt | Theo đội |
| `GROUP_KNOCKOUT` | Chia bảng + vòng loại trực tiếp | Theo đội, mỗi bảng một bảng xếp hạng |
| `AMERICANO` | Đôi xoay vòng: mỗi người đánh chung đội với từng người còn lại đúng một lần | **Theo cá nhân** (`playerRankings`) |

- Americano dùng lại đúng `roundRobinRounds()` nhưng đọc kết quả `[x, y]` là "x **đánh chung
  đội** với y" thay vì "x đấu với y". Đừng thay bằng cách bốc tham lam từ rổ mọi cặp — cách đó
  không phủ hết người mỗi vòng (8 người từng ra 13 trận thay vì 14).
- Americano **không** cho mọi người ghép với tất cả: `americanoPartnerLimit()` chặn ở `(n-2)/2`
  người, và tổng số trận cắt về `roundRobinDoublesMatchCount()` — cùng độ dài với một giải vòng
  tròn thường. Bỏ giới hạn là 10 người ra 22 trận, đánh cả ngày không hết.
- `pairingRule` (`BY_SKILL` | `RANDOM`) quyết định ghép đôi theo trình hay xáo thuần. Mặc định
  `BY_SKILL` vì đó là hành vi của mọi giải tạo trước khi cột này ra đời.
- Tên đội đôi lưu thành một chuỗi `"An / Bình"`. Nối và tách **chỉ** qua
  `src/tournaments/team-name.ts` (`formatTeamName` / `splitTeamName`).
- Trận thuộc vòng nào là "vòng trong" thì hỏi `isKnockoutStage()`, đừng tự viết
  `stage !== 'Vòng bảng' && ...` — thêm một thể thức mới là những chỗ tự viết ấy lặng lẽ chấm
  điểm sai luật (đã xảy ra với gateway ghi điểm và hai view lịch).

### Vòng quay chia trận

`public/js/spin-pairing.js` là **bản sao quy tắc ghép trình của server** chạy ở trình duyệt, và
`public/js/spin-draw.js` chỉ lo giao diện. Sửa `buildBalancedDoublesTeams` mà quên sửa
`spin-pairing.js` là vòng quay bốc một đằng, nút "Chia trận" chia một nẻo —
`test/spin-pairing.test.js` so thẳng kết quả hai bên trên 9 cấu hình mức trình nên sẽ đỏ ngay.

Kết quả quay gửi về `POST /tournaments/:id/manual-schedule` (luồng ghép cặp thủ công có sẵn),
không có route riêng. Dữ liệu VĐV truyền qua `data-*` vì CSP chặn `<script>` inline.

### Phân quyền — đọc `docs/bao-mat.md` trước khi đụng vào

Bốn lớp chặn, theo thứ tự: `LocalsMiddleware` → `CsrfMiddleware` → `FeatureGuard` (global) →
bộ lọc chủ sở hữu trong service.

- `FeatureGuard` đăng ký qua `APP_GUARD` và **mặc-định-chặn**: route mới tự động đòi đăng nhập.
  Decorator: `@Public()`, `@FeatureAccess('TOURNAMENTS'|'TEAMS'|'PERMISSIONS')`, `@AdminOnly()`,
  `@RootAdminOnly()` (đặt trên class hoặc method, method thắng class).
- Chỉ **3 controller** được `@Public()`: `AuthController`, `HealthController`,
  `ExternalRegistrationController`. Danh sách này bị khóa bởi `test/security.test.js` — thêm
  `@Public()` chỗ khác là test đỏ.
- Guard chặn ≠ lọc chủ sở hữu. Mọi truy vấn tài nguyên có chủ phải dùng
  `ownedOrSharedWhere(user)` (`src/common/admin-scope.ts`), **lọc ngay trong câu truy vấn**
  (`findFirst({ where: { id, ...scope } })`, không phải `findUnique` rồi `if`), và sửa/xóa bằng
  `updateMany`/`deleteMany` kèm điều kiện chủ sở hữu.
- Guard chạy trước interceptor nên `HttpLogInterceptor` không thấy request bị chặn — guard tự gọi
  `LogService.recordDenied()`. Đừng gỡ.
- Vai `CLIENT` dùng mật khẩu chung `123456789` là **cố ý** (chỉ đọc); đừng "sửa" thành mật khẩu mạnh.

### CSP: không có inline script

`main.ts` đặt `script-src 'self'`. Mọi JS phải nằm trong `public/js/*.js` và nạp bằng thẻ
`<script src>`; inline handler (`onclick=...`) hay `<script>` inline sẽ bị chặn im lặng ở trình duyệt.

### Realtime

`MatchGateway` (`src/tournaments/match.gateway.ts`) + hằng số dùng chung trong
`src/realtime/socket-events.ts` (`SOCKET_EVENTS`, `tournamentRoom()`, `teamRoom()`). Client tương
ứng ở `public/js/realtime.js`. Thêm event mới thì khai ở `socket-events.ts` trước.

Redis (`REDIS_URL`) dùng cho session store + socket adapter khi chạy nhiều Render service; thiếu
Redis thì fallback in-memory, trừ khi `REQUIRE_REDIS=true` (lúc đó app fail-fast).

## Database & migration — các bẫy đã biết

- **Chuỗi migration KHÔNG dựng được schema từ DB trống.** Migration đầu tiên đã là
  `ALTER TABLE "tournament"` mà không migration nào tạo bảng đó. Dựng DB mới (test/CI/khôi phục)
  phải dùng `npx prisma db push`, **không** dùng `prisma migrate deploy`.
- Với DB production đã có sẵn schema thì `prisma migrate deploy` là đúng, và nó chạy ở **hai chỗ**:
  trong `render:build` và một lần nữa trong `start:prod` ngay trước khi app khởi động. Migrate fail
  = app **không** khởi động, cố ý như vậy (đã có sự cố code mới đứng trên schema cũ 19/07/2026).
- Vì thế `prisma` nằm ở `dependencies` chứ **không phải** `devDependencies` — `render:build` kết
  thúc bằng `npm prune --omit=dev`.
- Ba module Y tế, Chi tiêu, Du lịch đã bị gỡ hẳn ngày 3/8/2026 (migration
  `20260803180000_drop_medical_household_travel`). Backup cũ hơn mốc đó chứa 22 bảng không nạp lại
  được — `restore-db.js` cố ý bỏ qua và in cảnh báo thay vì chặn.
- **Không commit thư mục `backups/`** — repo public, file backup chứa email và hash mật khẩu.

## Biến môi trường (chi tiết đầy đủ trong README.md)

Tối thiểu để chạy local: `DATABASE_URL`, `SESSION_SECRET`, `APP_ADMIN_USERNAME`,
`APP_ADMIN_PASSWORD`. Ở `NODE_ENV=production` app **fail-fast** nếu `SESSION_SECRET` yếu/mặc định,
hoặc `APP_ADMIN_PASSWORD` yếu (trừ khi `ALLOW_WEAK_ADMIN_PASSWORD=true`).

Cờ chỉ dành cho test: `SKIP_PRISMA_CONNECT`, `SKIP_ADMIN_BOOTSTRAP`, `DISABLE_APP_LOGS`,
`DISABLE_HTTP_LOGS`, `E2E_DATABASE_URL`, `E2E_ADMIN_PASSWORD`.

## Health

`/healthz` (process sống) và `/readyz` (PostgreSQL, Redis, `sessionStore`/`socketAdapter`) — cả hai
là `@Public()`.
