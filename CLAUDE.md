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

**Backup / khôi phục / kiểm tra Render:** `npm run backup`, `npm run backup:push`, `npm run restore`,
`npm run baseline`, `npm run check:render -- <url> <url>`.

Dựng lại DB sau thảm hoạ đi đúng ba bước, **không bỏ bước nào**: `npx prisma db push` →
`npm run restore` → `npm run baseline`. Bỏ `baseline` thì `_prisma_migrations` rỗng trong khi schema
đã đầy đủ, `prisma migrate deploy` từ chối ngay bằng **P3005 "The database schema is not empty"** và
không chạy migration nào — mà `start:prod` là `migrate deploy && node dist/main.js`, nên app không lên
dù dữ liệu khôi phục đúng hết. Đã diễn tập thật 18/9/2026 (28/28 bảng khớp, có cả đối chứng bỏ
baseline để xem nó gãy). Chi tiết ở README mục "Dựng lại DB từ số không".

Repo **không có** ESLint/Prettier — không thêm bước lint vào quy trình.

**Xong việc thì mặc định commit và push lên `main`** (chủ app dặn 4/10/2026) sau khi `npm test` xanh —
không cần hỏi lại. Push là Render tự deploy và chạy migration, nên migration có sửa dữ liệu thì chạy thử
trên DB thật trong transaction rồi ROLLBACK trước khi push.

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
  bên mạnh / bên yếu (sắp theo trình rồi cắt đôi), `RANDOM` = xáo rồi cắt đôi.
  **Một vòng = n/2 cặp, mỗi người đúng một cặp, và ai cũng đánh đúng bằng nhau** (chủ app chốt lại
  9/9/2026): số cặp chẵn (12, 16 người) thì vòng nào cũng đủ mặt, mỗi người n/2 trận; số cặp lẻ
  (10, 14 người) thì mỗi vòng một **cặp nghỉ** (chọn cặp có tổng số lần nghỉ ít nhất → ai cũng nghỉ
  đúng một lần), mỗi người n/2 − 1 trận. 14 người → 7 vòng × 3 = 21 trận, mỗi người 6; 12 → 18
  trận, mỗi người 6; 16 → 32 trận, mỗi người 8; 10 → 10 trận, mỗi người 4. Cặp nghỉ **không đánh
  bù** ở vòng khác — kiểu "cặp chờ đánh với cặp chờ vòng sau" từng cho 12 người 7 trận còn 2 người
  6, chủ app đã bác; "vòng quay n-1 vòng" và "cho mượn cặp" cũng đã bác từ trước. Lẻ người thì bên
  mạnh dư một người, mỗi người bên mạnh rơi vào chỗ trống đúng một lần — lần nghỉ ấy được ghi sổ
  ngay từ đầu để việc chọn cặp nghỉ không dồn thêm lên họ (11 người từng ra một người 3 trận).
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

### Ghi điểm: lưu có xác nhận, không tin tiếng vọng (28/9/2026)

Chủ app báo ba lỗi cùng lúc: điểm 11-5 hết trận mà refresh máy nào cũng không thấy; vùng sáng người
giao không chuyển khi đổi đội; đổi người ở bước chọn xong người giao đứng ô 2. Gốc rễ:

- **Lưu điểm chỉ đi qua socket và KHÔNG có ack** — `socket.emit` xong hiện "Đã gửi điểm" ngay. Server
  lỗi DB thì Nest nuốt exception trong handler socket, client không hay; socket đứt lúc Render ngủ thì
  tin nằm trong buffer. Nay: luật lưu tách ra `MatchScoreService.save()` (trả `{ ok, message,
  retryable }`, không bao giờ ném), gateway trả kết quả làm **ack**; client (`scoreboard.js`) giữ
  `pending` + `seq` tăng dần, chờ ack mới hiện "Đã lưu", 4s không ack hoặc `retryable` thì đi
  **đường HTTP dự phòng** `POST /tournaments/:id/matches/:matchId/score` (fetch keepalive; đóng tab thì
  `sendBeacon` dạng form), thất bại thì thử lại lùi dần và gửi lại ngay khi socket `connect` lại.
  Đừng quay về "emit rồi quên".
- **Tiếng vọng ghi đè state**: server phát `scoreUpdated` cho cả phòng kể cả máy vừa gửi, client từng
  ghi đè state cục bộ bằng nó — bấm +1 rồi 300ms sau đổi đội giao là tiếng vọng lần trước về sau kéo
  người giao ngược lại. Nay broadcast kèm `origin` (id socket) + `seq`; máy gửi nhận ra tiếng vọng của
  mình thì chỉ đánh dấu đã lưu, không đụng state; đang có `pending` thì cũng không nhận state từ máy
  khác (lần lưu của mình sẽ đè lên sau). Nhận từ máy khác thì phải tính lại `servingPlayer` /
  `firstServerActive`, không giữ nguyên như trước.
- **Chọn đội giao trước**: bấm đúng đội đang được chọn sẵn từng rơi vào nhánh "đổi đội giữa trận" →
  `firstServerActive` tắt → người giao tính theo tay 2 = ô 2. Nay ở bước chọn trước khi có điểm, bấm
  đội nào cũng là "chọn người giao đầu", và `serverSlot()` luôn là ô 1 khi trận chưa có điểm.

### Ghi điểm: đánh đơn khác đánh đôi

`public/js/scoreboard.js` đọc `data-play-type` của `#matchList`. Đánh ĐƠN (luật
https://irace.vn/luat-choi-pickleball-danh-don/): điểm chỉ hai số giao – nhận, không có "thứ tự
đánh", thua bóng là đối thủ giao ngay (không chặn "phải ở tay 2"), sơ đồ sân một người mỗi bên:
người giao ô phải khi điểm mình chẵn, ô trái khi lẻ, người nhận đứng chéo (ô 1 = ô phải). Các phần
chỉ có ở đánh đôi (chọn Tay 1/2, hàng "Thứ tự đánh") mang `data-doubles-only`; thẻ trận đơn không
in số thứ tự đánh. `scoreOrder` của trận đơn luôn lưu 2 cho DB khỏi đổi.

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

### Chọn đội thủ công và chọn bảng

Có ở vòng tròn và đánh bảng, **cả thi đôi lẫn thi đơn** (chủ app yêu cầu 9/9/2026); đôi xoay vòng
không có vì cặp đổi mỗi vòng. Form (`schedule-parts/manual-pairs.ejs`) và vòng quay đều gửi về
`POST /tournaments/:id/manual-schedule` dạng `teamA_i` / `teamB_i` (đôi) và `group_i` (bảng, tuỳ
chọn); controller đọc thành `ManualTeam { name, group }`.

- Đôi: `completeManualTeams` — chỉ đội chọn **đủ hai người** mới là đội cố định, ai chưa được xếp
  thì máy ghép nốt theo `pairingRule`. Ô mới chọn một người coi như chưa ghép — trước đây nó thành
  "đội" một người đi đánh đôi, còn người không được chọn thì biến mất hẳn khỏi lịch.
- Đơn: `completeManualSingles` — người đã chọn đứng trước theo thứ tự, người còn lại xếp nốt phía
  sau (xáo); trước đây thi đơn gửi tên nào là chỉ có tên đó, người không được chọn mất khỏi lịch.
- Bảng: `splitGroups` xếp đội đã chọn bảng vào đúng bảng, đội "Tự xếp" rơi vào bảng đang ít đội
  nhất (không chọn gì thì ra A, B, A, B như cũ). Số bảng để vẽ form/vòng quay là `manualGroupCount`
  trong view model (`groupCountFor` với số đội ước tính: đôi lấy ceil(n/2) vì người lẻ vẫn thành
  đội "Chờ thành viên"), server tính lại với số đội thật — bảng vượt quá số bảng coi như chưa chọn.
- Vòng quay thi đơn dùng `createSinglesDraw` (mỗi lượt một ô, bốc một người); đánh bảng thì bốc tới
  đâu xếp bảng tới đó (đội 1 → A, đội 2 → B, ...) và hiện nhãn bảng ngay trong danh sách đã bốc.
  Bản nháp `localStorage` có loại đấu + số bảng trong fingerprint nên đổi cấu hình là nháp cũ bỏ.

Ngoài ra có **vòng quay bốc tên đứng riêng** ở `/vong-quay` (`src/views/wheel.ejs` +
`public/js/wheel-of-names.js`), đặt cạnh `/score-reader`: chỉ cần đăng nhập, không thuộc module
nào, không gọi API và không lưu DB — danh sách tên nằm trong `localStorage` của máy người dùng.

### Module Chi tiêu đã gỡ lần hai (30/9/2026)

Sổ chi tiêu gia đình (`src/household/`, 9 bảng `household_*` + `player_household_access`, bot Telegram +
Apps Script đọc mail Timo/MSB) đã gỡ hẳn theo ý chủ app — migration `20260930090000_drop_household_module`
xoá 9 bảng và dòng `HOUSEHOLD` trong `admin_feature_permission`. Đây là lần gỡ THỨ HAI: lần đầu 3/8/2026
(sau 4 lần dựng trong hai tuần), dựng lại 9/9/2026 với lõi nhỏ hơn, dùng ba tuần rồi lại gỡ. Dữ liệu cuối
cùng (78 giao dịch, 15 nguồn, 13 mục đích, 81 tin Telegram) đã xuất ra Excel
`backups/chi-tieu-xuat-2026-09-30.xlsx` (không commit) và còn trong backup hằng đêm. Hệ quả cần nhớ:

- `AppFeature` chỉ còn `TOURNAMENTS | TEAMS | PERMISSIONS`; `TelegramController` không còn nên chỉ **3**
  controller `@Public()`. `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` là biến chết — xoá khỏi Render,
  và tắt trigger Apps Script trên Gmail (nó vẫn gọi `/telegram/ingest/…` và ăn 404).
- Rà lại 4/10/2026: code, trang chủ, trang Phân quyền và DB production (không còn bảng `household_*`,
  `admin_feature_permission` chỉ còn TOURNAMENTS/TEAMS) đều sạch; dòng CSS chết cuối cùng `.ht-house` đã xoá.
- Muốn dựng lại lần nữa thì đọc lịch sử ở commit ngay trước commit gỡ (CLAUDE.md ở đó có ~130 dòng luật
  chủ app đã chốt: hạn mức thẻ, thẻ thông có hướng, 5 loại giao dịch, đối chiếu Timo…) — đừng đoán lại.

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
- Chỉ **3 controller** được `@Public()`: `AuthController`, `HealthController` và
  `ExternalRegistrationController` (`TelegramController` đi cùng module Chi tiêu, gỡ 30/9/2026). Danh sách này bị khóa bởi
  `test/security.test.js` — thêm `@Public()` chỗ khác là test đỏ.
- Guard chặn ≠ lọc chủ sở hữu. Mọi truy vấn tài nguyên có chủ phải dùng
  `ownedOrSharedWhere(user)` (`src/common/admin-scope.ts`), **lọc ngay trong câu truy vấn**
  (`findFirst({ where: { id, ...scope } })`, không phải `findUnique` rồi `if`), và sửa/xóa bằng
  `updateMany`/`deleteMany` kèm điều kiện chủ sở hữu.
- Guard chạy trước interceptor nên `HttpLogInterceptor` không thấy request bị chặn — guard tự gọi
  `LogService.recordDenied()`. Đừng gỡ.
- Vai `CLIENT` dùng mật khẩu chung `123456789` là **cố ý** (chỉ đọc); đừng "sửa" thành mật khẩu mạnh.

### Giao diện — design system "Sân đấu" (9/2026)

Không còn Bootstrap. Toàn bộ style nằm ở `public/css/app.css` — một file duy nhất kể từ khi gỡ module
Học vui (18/9/2026, `games.css` đi cùng). Quy ước, và là thứ chủ app đã nói rõ là **ghét**:

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
và tiền đã đóng. Danh sách của tháng (`TeamDetailService.monthRoster`): tháng **đã chốt** (có dòng quỹ) CHỈ
lấy ai có dòng phí tháng đó (kể cả người đã rời); tháng **chưa chốt** thì cộng thêm người đang hoạt động.
Đừng cộng người đang hoạt động vào tháng đã chốt — họ vào đội sau tháng đó (ca thật 4/10/2026: Vũ Việt Hùng
vào 3/10 hiện ngược về tháng 9 như nợ 377k, "Quỹ còn lại" tháng 9 thành 377k trong khi dư mang sang tháng
10 là 0). Vì thế `addMember` tạo dòng cho cả các tháng SAU đã chốt sẵn. Mọi thao tác ghi lên tháng đều qua `ensureMonth` → `recompute`: tháng ở chế độ
`fee_mode = AUTO` tự chia đều mức phí và lan số dư sang tháng sau (cũng AUTO); MANUAL thì giữ số gõ.
Tháng chưa chốt được xem trước (`fundPreview`) chứ không ghi DB. `previousMonthBalance` đếm cố định theo
ảnh chụp tháng trước — đừng đổi về đếm `active`, đó là lỗi cũ làm hụt quỹ khi có người rời đội.

Thành viên đội **đi theo nhóm** (không còn thêm/rời từng người trên trang đội): `GroupService.removeMember`,
`deleteWithTeams`, `detachTeamFromGroup` đưa người rời đội từ tháng hiện tại trừ khi còn ở nhóm khác
cùng liên kết. Vãng lai không phải thành viên: ghi theo buổi ở mục Khoản thu (`team_guest_receipt`,
`TeamFundService.addGuestReceipt`), cộng vào `guestPaid`.

**Luật rời đội** (chủ app chốt 4/10/2026, `TeamMemberService.removeMember`):

- Tháng rời: ai **đã đóng tiền** (`paid_amount > 0`, kể cả đóng thiếu) giữ dòng và tính bình thường; ai
  **chưa đóng đồng nào** bị bỏ hẳn khỏi tháng, mức phí chia lại cho người còn lại. Các tháng sau không có
  người đó (`ensureMonth` chỉ thêm người đang hoạt động). Các tháng trước giữ nguyên, kể cả nợ cũ.
- Xét theo **tiền thật**, đừng quay về cờ `payment_status = 'PAID'` — cờ ghi DB lỗi thời ngay khi phí chia
  lại (trạng thái hiển thị do `TeamMonthReportBuilder` tính lại từ đã thu so với mức phí).
- Tháng rời lưu ở `team_member.left_month` (quay lại đội thì về null). Người đã rời mà bị sửa về 0đ (hoàn
  tiền) ở tháng ≥ `left_month` thì `updatePayments` bỏ dòng khỏi tháng rồi chốt lại. Ca thật: "diu" 3/10/2026
  được hoàn 430k, dòng 0đ nằm lại khiến tháng 10 chia phí cho 13 người thay vì 12; migration
  `20261004090000_team_member_left_month` điền `left_month` cho người đã rời (tháng có dòng phí muộn nhất)
  và dọn dòng đó. Tháng trước `left_month` thì dòng 0đ là nợ cũ thật, giữ nguyên.
- Trang soi trước khi đưa ra khỏi nhóm (`removalPreview`, `groups/remove-member.ejs`) báo
  `dropFromMonth` — chưa đóng thì "bỏ khỏi tháng", không tính là nợ.

Màn **Tổng quan** của đội: ô đầu là **Tổng dư đầu tháng**, CHỈ hiện số `previousBalance` (còn lại tháng
trước), không chú thích — chủ app 4/10/2026 bỏ ô "Tổng quỹ" (phải đóng + dư + vãng lai, dễ đọc nhầm là tiền
đang có). Danh sách người còn thiếu chuyển sang ô "Tổng đã thu"; "Quỹ còn lại" vẫn = dư đầu tháng + phải
đóng + vãng lai − đã chi (khớp `previousMonthBalance`).

Hai điều hay bị hỏi "sao số lệch" (soi DB thật 4/10/2026, đội "chiều chủ nhật"):

- **"Quỹ còn lại" tính theo tiền PHẢI đóng, không theo tiền ĐÃ thu.** Tháng 9: 14 cố định × 377k + vãng
  lai 900k − sân 3,56tr − chi 2,618tr = **0đ**, nên dư đầu tháng 10 = 0 là đúng. Tiền thật lại là −13k: 13
  người đã đóng 405k trước 28/9, rồi diu vào làm phí chia lại còn 377k (14 người) mà diu không đóng — phần
  đóng dư 13 × 28k không cộng, phần nợ 377k của diu vẫn tính như đã có. Đây là công thức chủ app dùng từ
  đầu; muốn đổi sang tiền thật thì phải đổi đồng thời `TeamMonthReportBuilder.finance` và
  `previousMonthBalance`, và hỏi chủ app trước.
- **Tháng MANUAL không nhận số dư lan sang.** `recompute` chỉ cập nhật `previous_balance` của tháng kế tiếp
  khi tháng đó AUTO. Thêm nữa, form Cài đặt luôn gửi ô "Tiền sân còn lại tháng trước" (điền sẵn số đang lưu),
  nên lưu Cài đặt một lần là số đó dính cứng. Sửa tháng trước xong mà tháng sau đang MANUAL thì phải vào Cài
  đặt tháng sau xoá trống ô đó để app tự lấy `previousMonthBalance`. Tháng 10/2026 của đội chiều chủ nhật
  đang MANUAL (phí 510k, admin chuyển 3/10 sau khi migration chia lại thành 514k).

**Báo cáo tháng gộp nhiều đội** (`GET /teams/report?month=`, nút "Báo cáo tháng" ở banner Đội bóng, chủ app
28/9/2026): admin lo 3 đội, có người chơi 2–3 đội, trước phải mở từng đội cộng tay. `TeamReportService`
lấy đội theo đúng `crud.list(user)` (admin phụ chỉ thấy đội mình), số từng đội lấy từ
`TeamDetailService.monthSnapshot` — cùng roster tháng, cùng quỹ xem trước, cùng `TeamMonthReportBuilder`
với trang chi tiết, nên **khớp từng đồng** với "Khoản thu" của mỗi đội; đừng tính lại ở chỗ khác. Phần gộp
là hàm thuần `aggregateTeamReports` (test `test/team-report.test.js`): theo người thì nhặt đủ mọi đội một
người có mặt, người nhiều đội lên đầu. **CHỈ thành viên cố định** — chủ app chốt 28/9/2026 đây là bảng check
tổng tiền phải đóng của cố định, vãng lai (dòng GUEST lẫn khoản thu theo buổi) không ghi vào; bản đầu có gộp
đã bỏ. **Giao diện cố ý chỉ một bảng ma trận** (sau khi chủ app thấy bản đầu nhiều thẻ số + hai bảng): tên ·
mỗi đội một cột ghi MỨC PHÍ phải đóng ở đội đó, cộng ngang ra cột tổng tiền cần đóng; chân bảng là TỔNG TIỀN phải đóng của
từng đội + tổng chung (chủ app 29/9/2026: bản đầu đếm số người ở đây, đã sửa). Chọn tháng CHỈ bằng ô `<input type="month">` — hai nút lùi / tiến tháng đã bỏ (chủ app 29/9/2026). Từ 29/9/2026 mỗi ô kèm huy hiệu ✓ xanh / ✗ đỏ theo `paymentStatus` của dòng phí đội đó, cột
tổng đỏ khi còn bất kỳ đội nào chưa đóng. Nút **Lưu ảnh** (`public/js/team-report.js`) vẽ lại bảng bằng
canvas từ `data-amount` / `data-paid` trên từng ô — vẽ tay chứ không kéo thư viện chụp DOM vì CSP
`script-src 'self'`; điện thoại có `navigator.share` với file thì mở bảng chia sẻ (iPhone "Lưu vào Ảnh"),
không thì tải PNG về. Số còn thiếu / đã chi / quỹ còn vẫn có
trong `TeamsMonthlyReport` nhưng không hiện — muốn xem thì bấm tên đội sang trang Khoản thu. Route phải khai
TRƯỚC `/teams/:id`, không thì "report" bị đọc thành id đội.

### Nhóm thành viên (9/2026)

`src/groups/` — nhóm là tập VĐV đặt tên sẵn. Đội bóng **liên kết** nhóm (`team_club_group`): thêm
người vào nhóm là `GroupService.addMembers` tự gọi `TeamMemberService.addMember` cho mọi đội đang
liên kết; bỏ khỏi nhóm KHÔNG gỡ khỏi đội (còn lịch sử phí). Giải đấu chỉ **lấy** danh sách lúc thêm
(`mergeDistinct` trong tournament-registration.controller). Admin phụ chỉ thấy nhóm mình tạo; id
nhóm gửi lên luôn đi qua `GroupService.scopedIds`/`playerIdsOfGroups` trước khi dùng.

### Module Học vui đã gỡ (18/9/2026) — app KHÔNG còn gọi AI

Tám game cho bé ở `/games` (`src/games/`, `src/views/games/`, `public/js/games-*.js`,
`public/css/games.css`) đã gỡ hẳn theo ý chủ app, kèm `AiService` và hai bảng `knight_character` /
`knight_progress` (migration `20260918120000_drop_games_module`). Hệ quả cần nhớ:

- **Không còn dòng nào gọi ra dịch vụ AI.** `GROQ_API_KEY` / `GROQ_MODEL` / `AI_TIMEOUT_MS` là biến
  chết. Cần AI trở lại thì dựng client mới, đừng đi tìm `AiService` cũ.
- `RateLimitService` **vẫn dùng** (đăng nhập + đăng ký ngoài) — đừng gỡ theo.
- `docs/hiep-si-toan-hoc.md` đã xoá cùng module; lịch sử game nằm ở commit trước commit gỡ.

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
