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

### Chi tiêu gia đình (module `src/household/`, dựng lại 9/2026)

Module Chi tiêu từng được dựng 4 lần trong hai tuần (7–8/2026) rồi gỡ hẳn vì mô hình đổi theo từng tính
năng. Lần này lõi cố ý NHỎ và mọi con số suy từ giao dịch — đừng thêm cột "số dư", "đã trả", "còn lại":

| Bảng | Vai trò |
|---|---|
| `household_source` | Nguồn tiền: BANK/CASH/SAVING/INVEST giữ số dư, CARD/LOAN giữ DƯ NỢ, LENT là cho vay. `match_key` = số TK / 4 số cuối thẻ để khớp tin. |
| `household_purpose` | Mục đích tự đặt; `kind` (LIVING/SAVING/DEBT/RESERVE/LENDING/INCOME) quyết định luật báo cáo. |
| `household_transaction` | EXPENSE / INCOME / TRANSFER. TRANSFER sang LOAN = trả nợ (`interest` là lãi), sang CARD = trả thẻ. `external_id` chống ghi trùng. |
| `household_recurring` | Khoản định kỳ khai một lần; `interest_mode = FROM_RATE` → lãi = dư nợ đầu tháng × lãi suất / 12. |
| `household_inbox` | Tin Telegram thô; UNPARSED để xử lý tay. |

- Số dư: `opening_balance` là số ĐẦU KỲ nhưng người dùng không nhập nó — form nguồn nhận số HIỆN TẠI và
  `HouseholdConfigService.openingFor` suy ngược. Đừng thêm lại ô "số dư đầu".
- **Đối chiếu với ngân hàng (chủ app chốt 10/9/2026), `reconcileSources` trong `household-month.ts`**: mail
  Timo báo SỐ DƯ tài khoản, mail MSB báo HẠN MỨC KHẢ DỤNG của thẻ (lưu ở `reported_balance` /
  `reported_available` của từng giao dịch). Tài khoản thì NGÂN HÀNG THẮNG: số dư = số trong mail gần nhất +
  giao dịch ghi sau mail đó. Sổ ra số khác thì `diff` khác 0 và app **báo lệch** (thẻ nguồn + Tổng quan + tin
  Telegram) để chủ app thêm giao dịch còn thiếu bằng tay — **không** tự căn lại `opening_balance` như bản cũ
  (`syncBalance` đã bỏ: tự bù là mất dấu khoản thiếu, số tiền thật còn lại thành sai). Ngoại lệ duy nhất: mail
  ĐẦU TIÊN của một tài khoản được lấy làm mốc (suy ngược số đầu kỳ) vì tài khoản Timo không khai số dư tay.
- Thẻ tín dụng **không khai hạn mức lẫn dư nợ** (chủ app 10/9/2026: thẻ thông dùng chung hạn mức, khai kiểu
  gì cũng sai): dư nợ cộng từ giao dịch quẹt/trả, thẻ chỉ hiện "hạn mức khả dụng" theo mail gần nhất, và
  `diff` đo từ mail đầu tới mail gần nhất (khả dụng phải giảm đúng bằng phần dư nợ sổ ghi tăng). Mail KHÔNG có
  hạn mức TỔNG nên đừng suy dư nợ từ hạn mức. Hai chuyện phải nhớ khi đối chiếu hạn mức (soi dữ liệu thật
  10/9/2026):
  1. **Thẻ thông là quan hệ CÓ HƯỚNG** (`household_source.limit_shares_with`, chủ app chốt 10/9/2026):
     khai "thẻ thông của thẻ A là B" nghĩa là giao dịch của A cũng làm đổi hạn mức khả dụng của B. Thực tế
     nhà chủ app: 4768 → 3065 và 8867 → 3065 (mỗi thẻ hạn mức riêng, trả vào thẻ nào chỉ thẻ đó tăng, nhưng
     3065 ăn theo cả hai), **3065 để trống**; hai thẻ của vợ thông nhau nên khai TRỎ LẪN NHAU. App không tự
     khai hộ chiều ngược lại — chiều nào có thật chỉ chủ app biết. Đối chiếu: hạn mức của thẻ X đổi theo
     giao dịch của chính X và của mọi thẻ trỏ về X (`affectsLimitOf`); test "thẻ thông có hướng" khoá lại.
     **Hạn mức mỗi thẻ một khác vẫn đúng** vì chỉ so CHÊNH giữa hai lần ngân hàng báo của CÙNG một thẻ,
     không bao giờ so số tuyệt đối giữa các thẻ. Cộng nhầm cả cụm cho thẻ hạn mức riêng là báo lệch oan cả
     trăm nghìn (8867 từng lệch 748.922đ).
  2. **KHÔNG có ngưỡng bỏ qua** — lệch bao nhiêu báo bấy nhiêu (chủ app chốt 10/9/2026: phải khớp từng đồng,
     lệch thẻ nào thì tự tra soát thẻ đó). Từng có `cardDiffTolerance` bỏ qua lệch nhỏ, đã gỡ. Biết trước hai
     nguồn lệch để khỏi hoảng: **hoàn tiền vào lại hạn mức chậm cả ngày** (mail hoàn tiền báo hạn mức y
     nguyên, hôm sau mới cộng — nhìn hai mail liên tiếp là thấy bù nhau), và **mail ngân hàng không gửi**
     (thực tế 10/9/2026 có khoản trả thẻ không có mail). Ngoài ra vài bước một-giao-dịch vẫn lệch trăm đồng
     (quẹt 180.000 mà hạn mức tụt 180.148) — chưa giải thích được, cứ để nó báo. "Đã quẹt chưa trả" trả hết là **về 0** — KHÔNG có "trả dư"
  (trả thẻ chỉ là trả nợ thẻ); xuống dưới 0 nghĩa là sổ thiếu khoản quẹt, kẹp hiển thị về 0 và báo phần
  thiếu, tổng "Nợ thẻ" cũng kẹp từng thẻ về 0 để thẻ thiếu không ăn bớt nợ thẻ khác.
- **Thẻ thông** (`household_source.limit_group`, chủ app 10/9/2026): hai thẻ dùng chung một hạn mức thì quẹt
  thẻ A xong, mail của thẻ B báo hạn mức khả dụng đã trừ luôn khoản của A — tính riêng từng thẻ là báo lệch
  oan. Khai bằng ô "Thẻ thông (chung hạn mức)" ở form nguồn (chọn thẻ kia, **không** khai số hạn mức);
  `HouseholdConfigService.limitGroupFor` cho cả hai thẻ cùng mã `g<id>`, `limitGroupKey` gom nhóm và phần
  quẹt trong `reconcileSources` cộng cả nhóm. Chỉ so phần CHÊNH giữa hai lần ngân hàng báo nên **hai thẻ
  khác hạn mức nhau vẫn đúng**. Chưa khai mà lệch đúng bằng tiền quẹt của một thẻ khác thì bot Telegram mách
  "hai thẻ này có vẻ thẻ thông" thay vì bắt đi tìm giao dịch thiếu.
- Toán ở `household-month.ts` (thuần, có test `test/household.test.js`): `sourceBalances`, `monthReport`,
  `recurringExpectations`, `matchRecurring`. **Luật chủ app chốt 9/9/2026**: quẹt thẻ là chi tiêu lúc quẹt,
  trả thẻ chỉ là chuyển nguồn; trả nợ vay tính vào "dùng" cả gốc lẫn lãi, gốc trừ dư nợ; giao dịch chưa có
  mục đích tính vào chi tiêu và đếm ở "chưa phân loại"; chuyển tiền sang nguồn Tiết kiệm / Đầu tư là "cất đi"
  (vào `saving`) kể cả khi không gắn mục đích, rút về thì trừ lại.
- Mọi giao dịch đi qua `HouseholdLedgerService.create()` (form tay, nút Ghi nhận định kỳ, Telegram) để cùng
  một luật khớp định kỳ (cùng nguồn, lệch ≤ 2%) và đoán mục đích theo lần trước cùng nội dung
  (`normalizeDescription`). Tin tự động (status NEW) không đoán được thì mặc định vào mục chi tiêu "Khác"
  (`defaultLivingPurpose`) — chủ app: không bấm gì thì cứ là chi tiêu. "Cần xem lại" = chưa có mục đích HOẶC
  còn NEW; bấm ✓ / đổi mục đích là CONFIRMED.
- Telegram: Apps Script gửi mail vào `POST /telegram/ingest/:secret` (KHÔNG gửi vào nhóm bằng token bot —
  Telegram không đưa tin của chính bot về webhook, bot im lặng, đã dính 10/9/2026); webhook
  `POST /telegram/webhook/:secret` chỉ nhận tin của người và callback nút (`telegram.controller.ts`, @Public
  có trong danh sách duyệt của `test/security.test.js`). Không quét định kỳ. Apps Script quét mail **từ ngày đầu tháng hiện tại tới giờ** (`after:`, chủ app chốt 10/9/2026) và nhớ TỪNG
  MAIL đã gửi bằng id tin trong Script Properties. **Đừng dùng nhãn Gmail** (Gmail gom mail cùng tiêu đề vào
  MỘT luồng, nhãn là nhãn của cả luồng → gắn xong là mọi mail ngân hàng sau đó bị bỏ qua sạch, đã dính
  10/9/2026: mail thẻ từ 7/9 không vào app) và đừng dùng `is:unread` + `markRead` (lỡ tay mở mail là mất tin).
  Luồng Gmail còn chứa cả mail cũ hơn đầu tháng nên phải lọc lại theo ngày của từng mail. Script gửi kèm
  TIÊU ĐỀ mail vì thẻ MSB có hai tiêu đề: "Biến động chi tiêu thẻ tín dụng" = quẹt tiêu, "Biến động thanh toán
  thẻ tín dụng" = hoàn tiền / mình trả nợ thẻ (mail này có thể không mang dấu +/− nên PHẢI đọc theo tiêu đề;
  bot chỉ báo một dòng "Hoàn tiền vào thẻ … của …", không hỏi mục đích). Mẫu đọc tin ở `bank-parsers.ts` (Timo tài khoản — kèm số dư hiện tại, MSB thẻ — kèm hạn mức khả dụng
  SAU giao dịch,
  mẫu chung; VPBank đã gỡ 10/9/2026 vì tiền về nhà đi hết qua Timo) — thêm ngân hàng thì thêm parser + test với mail thật. Nút inline `hp:<tx>:<purpose>` gán mục
  đích, `ht:<tx>:<source>` đổi khoản chi thành trả thẻ/trả nợ. Liên kết nhóm bằng `/link <mã>`.
- **Telegram chặn gửi dồn ~20 tin/phút vào một nhóm.** Gửi cả loạt mail một lần (lần đầu cài Apps Script,
  hay dồn mail mấy ngày) là tin thứ 21 trở đi ăn 429 — đã dính 9/9/2026: 20 tin lên nhóm, 3 khoản sau vào sổ
  mà không có tin nào để bấm. `api()` gặp 429 thì đợi `retry_after` rồi gửi lại (tối đa 2 lần, mỗi lần ≤ 30s),
  hết lượt thì để cơ chế đăng bù bên dưới lo. Đừng gỡ.
- **Ghi sổ được mà đăng tin lên nhóm hỏng** (mất token, bot bị đá khỏi nhóm) từng để lại khoản "cần xem lại"
  mà trên Telegram không có gì bấm (chủ app 10/9/2026). Nay `ingestBankText` trả `'unsent'`, `ingestFromScript`
  trả `ok: false` → Apps Script chưa gắn nhãn nên gửi lại, và lần gửi lại tuy TRÙNG giao dịch vẫn đăng bù tin
  tóm tắt (`isTelegramMessageId`: `telegram_msg_id` còn là hash nội dung = chưa từng đăng). Web cũng ghi rõ
  dưới dòng giao dịch vì sao nó còn "cần xem lại": chưa xác nhận / chưa lên được Telegram / chưa chọn mục đích.
- Quyền: `@FeatureAccess('HOUSEHOLD')`; admin theo `ownedOrSharedWhere`, thành viên trong nhà là CLIENT qua
  `player_household_access` (`clientHouseholdWhere`). Mỗi admin tạo được nhiều hộ.
- View `src/views/household/` cùng khuôn trang đội; form trong bảng dùng thuộc tính `form=` trỏ tới form rỗng
  đứng ngoài `<table>` (form trong `<tr>` là HTML sai). JS riêng: `public/js/household.js` (ẩn/hiện ô nguồn đích).

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
