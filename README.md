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
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`: bot của module Chi tiêu (xem mục "Chi tiêu gia đình: bot Telegram"). Không đặt = webhook đóng, module vẫn dùng được bằng nhập tay.

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

- `GEMINI_API_KEY`: bắt buộc để dùng AI (game nói chuyện). Lấy tại https://aistudio.google.com/apikey.
- `GEMINI_MODEL`: model dùng, mặc định `gemini-2.0-flash`. Nếu hay bị lỗi 429 (hết hạn mức/ngày của bản free), thử đổi sang model có hạn mức free cao hơn, ví dụ `gemini-1.5-flash`, hoặc bật billing trong Google Cloud để tăng giới hạn.
- App tự thử lại vài lần khi gặp 429/503 tạm thời và báo lỗi thân thiện khi hết lượt.

## Chi tiêu gia đình: bot Telegram

Luồng: mail ngân hàng → (Apps Script trên Gmail) → nhóm Telegram có bot → (webhook) → app ghi giao dịch
→ bot trả lời kèm nút chọn mục đích. Mẫu đọc tin có sẵn cho **Timo** (mail "Thông báo thay đổi số dư tài
khoản", cả tăng lẫn giảm, kèm số dư hiện tại) và **MSB thẻ tín dụng** — MSB có HAI tiêu đề: *Biến động chi
tiêu thẻ tín dụng* (quẹt tiêu) và *Biến động thanh toán thẻ tín dụng* (hoàn tiền hoặc mình trả nợ thẻ), cả hai
đều kèm hạn mức khả dụng còn lại. Ngân hàng khác đọc theo mẫu chung "±số tiền VND". VPBank đã bỏ (10/9/2026):
tiền về nhà đi hết qua Timo.

1. Tạo bot với @BotFather, lấy token → `TELEGRAM_BOT_TOKEN`. Tắt privacy mode của bot
   (`/setprivacy` → Disable) để bot đọc được tin trong nhóm.
2. Sinh chuỗi ngẫu nhiên → `TELEGRAM_WEBHOOK_SECRET`. Deploy xong, đặt webhook một lần (mở URL này trên trình duyệt):

   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/telegram/webhook/<SECRET>&secret_token=<SECRET>
   ```

3. Tạo một nhóm Telegram riêng, thêm bot vào. Trên web: Chi tiêu → hộ → Cài đặt → lấy mã, rồi gõ trong nhóm
   `/link <mã>`.
4. Gửi mail vào APP bằng Google Apps Script (script.google.com, chạy trên chính Gmail nhận mail ngân hàng),
   đặt trigger "time-driven, mỗi 5 phút". Script gửi thẳng vào `/telegram/ingest/<SECRET>`, KHÔNG gửi vào
   nhóm bằng token bot — Telegram không đưa tin do chính bot gửi về webhook nên bot sẽ im lặng; app tự đăng
   bản tóm tắt gọn kèm nút lên nhóm:

   ```javascript
   // Đổi APP_URL (tên miền app), SECRET (TELEGRAM_WEBHOOK_SECRET) và CHAT_ID (id nhóm bot trả khi gõ
   // /start hoặc /link, số âm).
   const APP_URL = 'https://<tên miền app>';
   const SECRET = '<TELEGRAM_WEBHOOK_SECRET>';
   const CHAT_ID = '-1001234567890';
   // Đánh dấu "đã gửi" bằng NHÃN, không dùng is:unread + markRead (10/9/2026): lỡ tay mở mail là bot
   // bỏ sót tin. Gửi lại cùng một mail không sinh giao dịch trùng — app chống trùng bằng nội dung tin
   // và mã giao dịch của ngân hàng.
   const LABEL_NAME = 'vodich-da-gui';
   // Lọc theo NGƯỜI GỬI + TIÊU ĐỀ thật, kẻo mail OTP/quảng cáo cùng địa chỉ cũng bị gửi. Thẻ MSB có HAI
   // tiêu đề, phải lấy CẢ HAI:
   //   Timo:    support@timo.vn        — "Thông báo thay đổi số dư tài khoản"
   //   Thẻ MSB: banking_notify@msb.com.vn — "Biến động chi tiêu thẻ tín dụng" (quẹt tiêu)
   //                                     — "Biến động thanh toán thẻ tín dụng" (hoàn tiền / trả nợ thẻ)
   const QUERY = 'newer_than:3d -label:"' + LABEL_NAME + '" ('
     + '(from:support@timo.vn subject:"Thông báo thay đổi số dư tài khoản")'
     + ' OR (from:banking_notify@msb.com.vn (subject:"Biến động chi tiêu thẻ tín dụng"'
     + ' OR subject:"Biến động thanh toán thẻ tín dụng"))'
     + ')';

   function pushBankMails() {
     const label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
     for (const thread of GmailApp.search(QUERY, 0, 20)) {
       let ok = true;
       for (const mail of thread.getMessages()) {
         // Gửi kèm TIÊU ĐỀ: app đọc tiêu đề mới biết mail thẻ là quẹt tiêu hay thanh toán.
         const text = (mail.getSubject() + '\n' + mail.getPlainBody())
           .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 3500);
         const res = UrlFetchApp.fetch(APP_URL + '/telegram/ingest/' + SECRET, {
           method: 'post',
           contentType: 'application/json',
           payload: JSON.stringify({ chat_id: CHAT_ID, text: text }),
           muteHttpExceptions: true,
         });
         Logger.log(res.getResponseCode() + ' ' + res.getContentText());
         if (res.getResponseCode() >= 300) ok = false; // gửi lỗi thì chưa gắn nhãn, lần chạy sau gửi lại
       }
       if (ok) thread.addLabel(label);
     }
   }
   ```

   Lấy `CHAT_ID`: sau khi đặt webhook, gõ `/start` (hoặc `/link <mã>`) trong nhóm — bot trả lời kèm id nhóm (số âm).
   Dùng HAI Gmail (mỗi người nhận mail ngân hàng của mình)? Cài cùng đoạn script này trên CẢ HAI tài khoản Google,
   cùng `TOKEN` và `CHAT_ID`; mỗi script chỉ đọc hộp thư của tài khoản đang chạy nó.

Trong app: nguồn Timo để trống số tài khoản (mail Timo không ghi số), thẻ MSB khai **4 số cuối thẻ** để tin khớp đúng nguồn.

- **Tài khoản (Timo)**: mail có "Số dư hiện tại" → app lưu `reported_balance` và lấy số ngân hàng làm chuẩn
  (số dư = số trong mail gần nhất + giao dịch ghi sau mail đó). Sổ ra số khác thì app **báo lệch** ở thẻ nguồn,
  Tổng quan và tin Telegram để bạn thêm giao dịch còn thiếu bằng tay — app **không** tự bù. Chỉ mail đầu tiên
  của một tài khoản được lấy làm mốc. Ô "Số dư" ở Nguồn tiền nhập số HIỆN TẠI, app tự suy số đầu kỳ.
- **Thẻ tín dụng**: không khai hạn mức lẫn dư nợ. Thẻ hiện "Hạn mức còn" theo mail gần nhất (mail báo hạn mức
  khả dụng SAU khi đã cộng/trừ khoản của chính giao dịch ấy) và "Đã quẹt chưa trả" cộng từ giao dịch. Hai thẻ
  dùng chung hạn mức thì khai ô **Thẻ thông** (chọn thẻ kia) để app cộng tiền quẹt cả nhóm, khỏi báo lệch oan.
- **Mail "Biến động thanh toán thẻ tín dụng"** (hoàn tiền hoặc mình trả nợ thẻ): trùng với một lần trả thẻ đã
  ghi (cùng số, ±3 ngày) thì bỏ qua; còn lại ghi là hoàn tiền vào thẻ — bot chỉ báo một dòng "Hoàn tiền vào thẻ
  … của …", không hỏi mục đích, và số ấy tự trừ vào "đã quẹt chưa trả". Sau đó nếu bạn bấm "Trả thẻ …" trên
  khoản chi bên tài khoản thì app tự bỏ dòng hoàn tiền trùng ấy đi.
- Khoản chi không bấm nút mục đích nào thì mặc định vào mục chi tiêu "Khác" và nằm ở danh sách "Cần xem lại"
  cho tới khi bấm ✓ hoặc đổi mục đích. Tin không đọc được nằm ở mục Giao dịch → "Tin Telegram chưa đọc được".

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

**Diễn tập lại ngày 3/8/2026** trên một schema nháp của Supabase: dựng DB trắng bằng `db push`
→ nạp backup → đối chiếu **38/38 bảng khớp số dòng** (11.251 bản ghi), so từng trường của các
bảng tiền nong, kiểm 52 khoá ngoại có thật, mọi bộ đếm id >= id lớn nhất, và ghi thử một bản
ghi mới không đụng id cũ. Lần đầu diễn tập là 28/7/2026.

```bash
# 1. Trỏ DATABASE_URL sang DB mới, rồi:
npx prisma db push   # dựng schema thẳng từ prisma/schema.prisma
npm run restore      # nạp dữ liệu từ backups/latest.json
```

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
  đôi. Mỗi người chỉ ghép cặp với tối đa `(n-2)/2` người để giải dài đúng bằng một giải vòng
  tròn thường — 10 người thì mỗi người ghép 4 người, ra 10 trận, y như 5 đội cố định đấu vòng
  tròn. Ghép hết mọi cặp sẽ ra 22 trận, đánh cả ngày không hết.

Kèm theo là **quy tắc ghép cặp** cho đánh đôi:

- **Phân trình** (mặc định) — gom theo trình rồi ghép mức mạnh nhất với mức yếu nhất, tiến dần
  vào giữa. Không phải "A ghép D": giải chỉ có B, C, D thì B ghép D còn C ghép C.
- **Không phân trình** — bỏ qua trình độ, xáo ngẫu nhiên.

### Vòng quay chia trận

Ở tab **Thi đấu** của giải đánh đôi (vòng tròn hoặc đánh bảng), cạnh nút *Chia trận* có nút
**🎡 Vòng quay**: bốc từng cặp một cách trực quan trước mặt cả nhóm thay vì để máy chia lặng lẽ.

- Giải **phân trình** quay hai ô cùng lúc, mỗi ô một mức trình đang được ghép với nhau.
- Giải **không phân trình** quay hai ô từ cùng một rổ chung.
- Bốc xong bấm *Chốt danh sách này & chia trận* — nó dùng lại đúng luồng ghép cặp thủ công.

Quy tắc bốc nằm ở `public/js/spin-pairing.js` và **phải khớp với server**; `test/spin-pairing.test.js`
so thẳng kết quả hai bên trên 9 cấu hình mức trình khác nhau.

## Ghi chú kiến trúc

- Controller giữ vai trò routing/render/redirect, nghiệp vụ chính nằm trong service theo domain.
- `TournamentService` và `TeamService` là facade mỏng, các luồng lớn được tách thành service nhỏ để dễ maintain.
- Schema thay đổi đi qua Prisma migration. `prisma migrate deploy` chạy ở HAI chỗ: trong `render:build` và một lần nữa ngay trước khi app khởi động (`start:prod`). Lần thứ hai là lần bảo đảm — xem mục Render.
- Event realtime được chuẩn hóa trong client/server modules để sau này nâng cấp Redis/socket adapter ít chạm code UI.
- Rate limit form login và đăng ký ngoài đang dùng in-memory service để không tăng Redis commands; có thể thay implementation bằng Redis khi lưu lượng lớn hơn.
