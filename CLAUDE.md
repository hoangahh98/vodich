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
| `AMERICANO` | Đôi xoay vòng: chia hai bên, mỗi người đánh chung đội với từng người bên kia đúng một lần | **Theo cá nhân** (`playerRankings`) |

- Americano (luật chủ app chốt 9/2026, `buildAmericanoMatches`): chia người làm **hai bên**
  (`americanoSides`), vòng r ghép người bên A thứ i với người bên B thứ (i+r) mod n/2 → n/2 vòng,
  mỗi người đi với đủ người bên kia đúng một lần và **không bao giờ** ghép cùng bên. `BY_SKILL` =
  bên mạnh / bên yếu (sắp theo trình rồi cắt đôi), `RANDOM` = xáo rồi cắt đôi. Lẻ cặp trong vòng
  thì một cặp nghỉ, chọn cặp nghỉ ít nhất để ai cũng nghỉ đều. 10 người → 10 trận, 8 → 8, 12 → 18.
  **Một vòng = mọi người đều ra sân** (chủ app chốt). Số cặp mỗi vòng lẻ (10, 14 người) thì vòng
  quay cuối làm "kho cho mượn": mỗi vòng còn lại mượn một cặp (`roundMatches`), hai người của cặp
  mượn đánh hai trận trong vòng ấy (trận xếp cuối vòng). 14 người → 6 vòng × 4 trận = 24 trận,
  10 → 4 × 3 = 12. Đừng quay lại kiểu "vòng quay n-1 vòng + giới hạn (n-2)/2", đừng để cặp lẻ ngồi
  chờ, đừng dồn cặp chờ sang vòng phụ — chủ app từng hỏi "sao 14 người mỗi người có 6 trận" rồi
  "1 vòng là 14 người đều đã được đánh".
- Luôn xáo trước khi sắp theo trình để bấm "Chia trận" lần sau ra kèo khác (người cùng trình đổi
  chỗ) — trước đây xếp thẳng theo thứ tự đăng ký nên bấm mười lần ra một kiểu, người dùng tưởng
  nút hỏng.
- Vòng trong (`normalizeQualifierCount`, `KNOCKOUT_MIN_TEAMS`): bán kết từ **6 đội** (2 bảng 3
  hoặc 3 + 4), tứ kết từ **12 đội**. `data-min-teams` ở form-parts/format.ejs phải khớp.
- Ở thể thức đôi thường, người dư ra khi hai mức trình lệch số lượng phải **gấp lại từ đầu**
  theo cùng quy tắc (`foldByLevel` gọi lặp), không đổ chung một rổ bốc bừa — rổ chung khiến mấy
  người mạnh dư ra tự ghép với nhau thành một đội vượt trội.
- Tên đội đôi lưu thành một chuỗi `"An / Bình"`. Nối và tách **chỉ** qua
  `src/tournaments/team-name.ts` (`formatTeamName` / `splitTeamName`).
- Trận thuộc vòng nào là "vòng trong" thì hỏi `isKnockoutStage()`, đừng tự viết
  `stage !== 'Vòng bảng' && ...` — thêm một thể thức mới là những chỗ tự viết ấy lặng lẽ chấm
  điểm sai luật (đã xảy ra với gateway ghi điểm và hai view lịch).

### Vòng quay chia trận

Ba lớp tách rời, đừng gộp:

| File | Việc |
|---|---|
| `public/js/spin-pairing.js` | **Bản sao quy tắc ghép trình của server** chạy ở trình duyệt |
| `public/js/wheel.js` | Bánh xe: vẽ múi + tính góc dừng. Dùng chung với trang `/vong-quay` |
| `public/js/spin-draw.js` | Nối hai thứ trên vào khung modal của trang lịch thi đấu |

- Sửa `buildBalancedDoublesTeams` mà quên sửa `spin-pairing.js` là vòng quay bốc một đằng, nút
  "Chia trận" chia một nẻo — `test/spin-pairing.test.js` so thẳng kết quả hai bên trên 12 cấu
  hình mức trình nên sẽ đỏ ngay.
- Người trúng do `spin-pairing` quyết định TRƯỚC, `wheel.spinTo(i)` chỉ tính góc sao cho múi `i`
  dừng dưới kim (kim ở 12 giờ = 0°, góc dương là chiều kim đồng hồ). Đừng đảo thành "quay bừa
  rồi đọc xem trúng ai": sai dấu góc thì bánh xe vẫn quay đẹp, vẫn dừng gọn trong một múi, chỉ
  là múi của người khác — `test/wheel.test.js` kiểm bằng số học nên bắt được.
- Chữ trên múi ở nửa TRÁI bánh xe phải lật 180° và neo từ đầu kia, nếu không tên hiện ngược đầu.
- Tên dài thì **co chữ**, không cắt bớt: `labelFontSize` ước lượng theo số ký tự, rồi `fitLabels`
  đo `getComputedTextLength()` thật trong trình duyệt và chỉnh lại. Cắt thành "Nguyễn Văn A…" là
  bốc trúng mà không biết ai.
- Vòng quay **lưu tạm bản nháp** vào `localStorage` (`vodich.spin.<id giải>`) để lỡ đóng khung
  hay rớt mạng không phải quay lại từ đầu. Lưu HẠT GIỐNG ngẫu nhiên + số đội đã bốc rồi quay
  lại đúng chừng ấy lượt, **không** lưu danh sách đội: lưu danh sách thì phần chưa bốc phải bốc
  mới và luật "gấp phần dư" tính lại trên rổ còn lại — đóng ra mở vào là đổi kèo.

Kết quả quay gửi về `POST /tournaments/:id/manual-schedule` (luồng ghép cặp thủ công có sẵn),
không có route riêng. Dữ liệu VĐV truyền qua `data-*` vì CSP chặn `<script>` inline.

### Tạo giải, Cài đặt và lệ phí (9/2026)

Form tạo giải (`tournaments/form.ejs`) chỉ có **Thông tin giải** (`buildTournamentInfo`); thể
thức, điểm, lệ phí + chi phí, giải thưởng nằm ở mục Cài đặt của giải và gửi về
`POST /tournaments/:id/config` (`buildTournamentConfig`). Lệ phí mỗi người là cột
`tournament.fee_per_player` nhập tay (`minimumFeeForTournament` ưu tiên nó; 0 = giải cũ, suy từ
tổng chi phí như trước). Ở form: nhập lệ phí trước rồi mới nhập được chi phí; đủ Sân bãi + Ăn
uống + Giải thưởng (Khác không bắt buộc) mới mở Cài đặt giải thưởng — khoá bằng `readonly` +
`.is-locked` trong form-controls.js, **không** `disabled` (input disabled không gửi lên, lưu là
mất số cũ). `req.session.flash` được LocalsMiddleware đưa ra `flash` và topbar.ejs hiện một lần.

Đóng phí giải làm giống Khoản thu đội: `tournament_registration.paid_amount` là tiền THẬT đã thu
(đăng ký mới = 0; migration 20260909100000 đưa các dòng chưa đóng về 0), `payment_status` suy ra
từ tiền so với lệ phí trong `TournamentPaymentService` — không còn ô tích ✓/✕, có nút "Tất cả đã
đóng" (`markAllPaid`). Đừng đọc `paid_amount` như "mức phải đóng" nữa.

### Ghép đội thủ công

`completeManualTeams` (`tournament-schedule.ts`): chỉ đội chọn **đủ hai người** mới là đội cố
định, ai chưa được xếp thì máy ghép nốt theo `pairingRule` của giải. Ô mới chọn một người coi
như chưa ghép — trước đây nó thành "đội" một người đi đánh đôi, còn người không được chọn thì
biến mất hẳn khỏi lịch.

Ngoài ra có **vòng quay bốc tên đứng riêng** ở `/vong-quay` (`src/views/wheel.ejs` +
`public/js/wheel-of-names.js`), đặt cạnh `/score-reader`: chỉ cần đăng nhập, không thuộc module
nào, không gọi API và không lưu DB — danh sách tên nằm trong `localStorage` của máy người dùng.

### Phân quyền — đọc `docs/bao-mat.md` trước khi đụng vào

Từ 9/2026 có thêm quyền xem của thành viên, chi tiết ở `docs/bao-mat.md` mục 3b:

- **Quyền xem của thành viên**: vai CLIENT chỉ thấy giải/đội đã được cấp (`PlayerAccessService`,
  bộ lọc CLIENT ở `src/common/player-scope.ts`). Từ 9/2026 trang Thành viên KHÔNG còn cột/link
  "Quyền xem" (chủ app bỏ vì đã có nhóm) — quyền chỉ còn tự cấp khi thêm vào giải/đội; trang
  `/players/:id/access` vẫn tồn tại nhưng không có link tới. Admin phụ chỉ cấp được
  trong phạm vi `ownedOrSharedWhere` của mình — phạm vi áp ngay trong truy vấn cả đọc lẫn ghi.
  Thêm người vào giải/đội thì tự cấp (`grantTournamentAccess`/`grantTeamAccess`), xoá thì tự thu.

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

### Giao diện — design system "Sân đấu" (9/2026)

Không còn Bootstrap. Toàn bộ style nằm ở `public/css/app.css` (app) và `public/css/games.css`
(màn hình game cho bé). Quy ước, và là thứ chủ app đã nói rõ là **ghét**:

- **Không** viền màu ở mép trái thẻ (`border-left: 4px solid ...`), **không** emoji nhốt trong ô
  vuông màu, **không** nền gradient bảy sắc cho thẻ dữ liệu. Trạng thái nói bằng huy hiệu, "của
  tôi" nói bằng vòng chanh (`.mine-row`, `.mine-card`).
- Icon là SVG sprite: `src/views/partials/icons.ejs` nhúng một lần sau `<body>` (topbar.ejs),
  gọi bằng `<%- include('partials/icon', { name: 'trophy' }) %>` (đường dẫn tương đối theo file
  gọi). Thêm icon mới thì thêm `<symbol id="i-...">` vào sprite.
- Font tự host trong `public/fonts` (CSP `font-src 'self'`): Be Vietnam Pro cho chữ, Oswald cho
  tiêu đề/điểm số. Thêm file font là phải thêm vào `PRECACHE` của `public/sw.js`.
- Cảnh nền hai người đánh pickleball qua lưới: `src/views/partials/scene.ejs` (SVG + CSS
  animation, nhóm `.scene-*` trong app.css). Nằm `position: fixed; z-index: -1` dưới mọi trang.
- Chuyển động trang trí ở `public/js/motion.js` (nghiêng thẻ theo chuột, lộ dần khi cuộn, đếm
  số, số điểm nảy). Tôn trọng `prefers-reduced-motion`. Có lưới an toàn 6s để nội dung không
  bao giờ bị ẩn vì observer không bắn.
- **Đừng** đặt `z-index` cho `.app-shell` và **đừng** để animation giữ `transform` trên phần tử
  cha của modal: modal dùng `position: fixed`, cha có transform là modal lệch và bị topbar đè
  (đã xảy ra, đã sửa bằng `:not(.score-modal)` + keyframe kết thúc `transform: none`).
- `.wheel-winner` không được `text-transform`: e2e so `innerText` với tên gốc.
- Điều hướng: thanh dưới đáy `.bottom-nav` (partials/bottom-menu.ejs; trang giải/đội có bản riêng ở
  `detail-parts/menu-scripts.ejs`) thay cho nút ba gạch cũ — không còn `menu.js`. Trong trang đội
  và trang giải, thanh dưới chỉ có Trang chủ + module đang mở theo ý chủ app; các mục con nằm ở dải
  `.section-tabs` ngay dưới hero (teams/detail.ejs, tournaments/detail.ejs). Bảng dữ liệu trong thẻ dùng `.table-wrap.member-table` +
  `table.member-list` (đầu bảng màu giấy, không phải đầu bảng xanh mặc định của `th`).
- Đổi view có chủ ý thì chạy `UPDATE_SNAPSHOTS=1 npm test` rồi soi diff snapshot.

### Quỹ đội bóng: mỗi tháng là một ảnh chụp (9/2026)

`src/teams/team-month.service.ts`. Loại thành viên (cố định/vãng lai) ghi vào `team_member_payment.member_type`
của TỪNG THÁNG; đổi loại hay rời đội chỉ áp dụng từ tháng đang thao tác trở đi, tháng cũ giữ nguyên số
và tiền đã đóng. Danh sách của tháng lấy từ dòng phí tháng đó (`TeamDetailService.monthRoster`), không
lấy từ cờ `active`. Mọi thao tác ghi lên tháng đều qua `ensureMonth` → `recompute`: tháng ở chế độ
`fee_mode = AUTO` tự chia đều mức phí và lan số dư sang tháng sau (cũng AUTO); MANUAL thì giữ số gõ.
Tháng chưa chốt được xem trước (`fundPreview`) chứ không ghi DB. `previousMonthBalance` đếm cố định theo
ảnh chụp tháng trước — đừng đổi về đếm `active`, đó là lỗi cũ làm hụt quỹ khi có người rời đội.

Thành viên đội **đi theo nhóm** (không còn thêm/rời từng người trên trang đội): `GroupService.removeMember`,
`deleteWithTeams`, `detachTeamFromGroup` đưa người rời đội từ tháng hiện tại trừ khi còn ở nhóm khác
cùng liên kết. Vãng lai không phải thành viên: ghi theo buổi ở mục Khoản thu (`team_guest_receipt`,
`TeamFundService.addGuestReceipt`), cộng vào `guestPaid`.

### Nhóm thành viên (9/2026)

`src/groups/` — nhóm là tập VĐV đặt tên sẵn. Đội bóng **liên kết** nhóm (`team_club_group`): thêm
người vào nhóm là `GroupService.addMembers` tự gọi `TeamMemberService.addMember` cho mọi đội đang
liên kết; bỏ khỏi nhóm KHÔNG gỡ khỏi đội (còn lịch sử phí). Giải đấu chỉ **lấy** danh sách lúc thêm
(`mergeDistinct` trong tournament-registration.controller). Admin phụ chỉ thấy nhóm mình tạo; id
nhóm gửi lên luôn đi qua `GroupService.scopedIds`/`playerIdsOfGroups` trước khi dùng.

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
