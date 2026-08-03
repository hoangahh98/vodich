# Module Quản Lý Chi Tiêu (household)

Sổ chi tiêu gia đình **nhập tay** — không quét email, không kết nối ngân hàng. Chỉ admin dùng được.

Rule chỉ có **bốn ý**, cố ý giữ ít:

1. Chủ sổ tự khai **loại thu nhập** và **loại chi phí**; mỗi khoản thu/chi thuộc một loại.
2. Loại nào đánh dấu **tiết kiệm** thì tiền vào đó **dồn qua các tháng**.
3. Loại nào đánh dấu **trả nợ / thu nợ** thì khoản đó gắn vào một dòng trong **sổ nợ**, phần
   **gốc** tự trừ vào khoản nợ được chọn.
4. **Trợ lý AI** đọc số liệu của sổ để trả lời, và đọc câu nói thường thành khoản chi điền sẵn.

## Kiểu của một loại (`kind`)

Chính `kind` quyết định tiền chảy vào ô nào ở Tổng quan.

Loại **chi phí** có bốn kiểu:

| `kind` | Nghĩa |
|---|---|
| `fixed` | 📌 Chi phí **cố định** — tháng nào cũng phải trả (học phí, gửi xe, tiền nhà). **Chỉ kiểu này** mới được nút "chép tháng trước" nhân bản, và cũng chỉ kiểu này có ô *đã chi thực tế* (xem dưới). |
| `variable` | 🎁 Chi phí **phát sinh** — không lặp lại (ăn ngoài, cưới hỏi, sửa xe). |
| `saving` | 🐷 **Gửi** tiết kiệm — không tính là chi phí |
| `debt` | 🏦 Trả nợ — gốc trừ vào khoản **mình nợ** |

Loại **thu nhập** có ba kiểu:

| `kind` | Nghĩa |
|---|---|
| `normal` | 💵 Thu nhập |
| `saving` | 🐷 **Rút** tiết kiệm ra tiêu — không tính là thu nhập |
| `debt` | 🤝 Người ta trả nợ mình — gốc trừ vào khoản **mình cho vay** |

Vì sao tách `saving` ra khỏi chi phí: tiền cất vào két **không mất đi**, nó chỉ đổi chỗ. Gộp chung
thì ô "Chi phí" phồng lên vô nghĩa và tháng nào gửi tiết kiệm nhiều lại trông như tháng tiêu hoang.

## Ba ô ở Tổng quan

```
🐷 Tiết kiệm đang có = Σ (gửi − rút) của MỌI tháng từ đầu sổ tới tháng đang xem   ← dồn qua các tháng
💸 Chi phí tháng     = Σ khoản chi kiểu fixed + variable + debt   (gốc lẫn lãi đều là tiền ra)
                       (tách sẵn expenseFixed / expenseVariable để bày cố định vs phát sinh)
💵 Thu nhập tháng    = Σ khoản thu kiểu normal + debt
```

## Đã chi · Ngân sách còn · Còn tự do

Khoản cố định khai **mức dự kiến** trước rồi mới chi thật, nên "còn lại" chưa phải tiền rảnh:

```
Đã chi          = Σ tiền THẬT đã ra khỏi ví
Ngân sách còn   = Σ (dự kiến − đã chi) của khoản cố định trong tháng   ← còn trong ví, đã có chỗ
Còn lại         = Σ mọi khoản thu − Σ mọi khoản chi                     (tiền mặt)
Còn tự do       = Còn lại − Ngân sách còn        = thu − tổng dự kiến   ← chưa hứa với ai
Còn tự do luỹ kế = tiền mặt luỹ kế − quỹ du lịch − ngân sách tháng này chưa tiêu
```

Ví dụ thật (8/2026): thu 44tr, khai dự kiến 8,65tr, mới chi thật 3tr → *còn lại* 41tr nhưng
*còn tự do* chỉ **35,35tr**; 5,65tr kia là bỉm sữa và sinh hoạt chưa mua chứ không phải tiền rảnh.

Gửi tiết kiệm nằm ở vế trừ, rút tiết kiệm nằm ở vế cộng — nên tiền **không bị đếm hai lần**: cất
vào két thì rời khỏi ví, lấy ra tiêu thì quay lại ví. Tổng tài sản = ô 🐷 + ô 💰.

Đứng ở tháng nào thì **không thấy tiền của tháng sau**: mọi số luỹ kế đều cắt tại tháng đang xem.

## Sổ nợ

Hai chiều, khai ở mục **🏦 Sổ nợ**:

| `direction` | Nghĩa | Tiền trả ghi ở đâu |
|---|---|---|
| `owe` | Mình đi vay | mục **💸 Chi phí**, loại kiểu 🏦 Trả nợ |
| `lend` | Mình cho vay, người khác nợ mình | mục **💵 Thu nhập**, loại kiểu 🤝 |

```
Còn lại của một khoản = số ban đầu − Σ tiền GỐC đã trả cho ĐÚNG khoản đó
```

Lãi là tiền ra khỏi nhà (nên vẫn nằm trong ô Chi phí) nhưng **không làm giảm nợ**.

Khi chọn loại kiểu trả nợ, form khai chi hiện thêm ba ô: **trả gốc**, **trả lãi**, **trả cho khoản
nào**. Số tiền của khoản đó = gốc + lãi (không gõ tay). Chọn nhầm chiều — lấy khoản cho vay để
"trả nợ", hoặc gửi lên id khoản nợ của sổ khác — thì **bị từ chối ghi**, chứ không âm thầm bỏ liên
kết: nếu bỏ im lặng, người dùng tưởng đã trừ nợ xong mà thực ra không trừ gì cả.

### Nút ✅ ghi nhanh ngay trên dòng sổ nợ

Mỗi khoản chưa xong có một khối gập **✅ Ghi một lần trả / thu** — lối tắt của đúng dòng mà chủ sổ
vẫn phải tự gõ ở mục Thu nhập / Chi phí, điền sẵn **toàn bộ phần còn lại** (ca hay gặp nhất là trả
nốt cho xong; trả một phần thì sửa lại con số). Nó đi qua **đúng bộ kiểm** của đường khai tay —
`debtRemaining` là trần dùng chung, nên hai đường không thể lệch nhau.

Điểm khác duy nhất: nó hỏi thêm một câu mà khai tay không hỏi — **rồi tiền đó đi đâu**.

| Chiều | Ô hỏi | Chọn gì | Sinh thêm dòng gì |
|---|---|---|---|
| `lend` | Tiền **vào** | 💰 để ở ví | không gì cả |
| | | 🐷 mục tiết kiệm | khoản **chi** kiểu `saving` vào mục đó |
| | | 🏦 khoản mình đang nợ | khoản **chi** kiểu `debt` trả vào khoản đó |
| `owe` | Tiền **lấy từ** | 💰 tiền mặt | không gì cả |
| | | 🐷 mục tiết kiệm | khoản **thu** kiểu `saving`, `sourceCategoryId` = mục đó |

**Là dòng thật, không phải cái nhãn.** Tiền đổi túi thì cả hai túi phải nhúc nhích cùng lúc: cất
5tr vào quỹ thì ví +0 chứ không phải +5tr. Ghi thành dòng thì công thức tiền mặt sẵn có tự lo cả
hai vế, và mọi dòng đều sửa/xoá/tra lại được y như dòng khai tay — đúng cách "rút tiết kiệm bù chi
vượt" đang làm. Hai dòng ghi trong **một transaction**: ghi nửa vời thì nợ đã giảm mà tiền không
tới nơi nào.

Ba chỗ chặn: không rút quá số dư của mục tiết kiệm; id mục/khoản nợ không thuộc sổ hay sai chiều
thì **từ chối** chứ không lặng lẽ rơi về "để ở ví"; trả sang một khoản nợ nhỏ hơn số vừa thu về
thì **kẹp ở đúng phần còn nợ** và nói thẳng phần thừa còn lại bao nhiêu ở ví (từ chối hẳn thì chủ
sổ phải tự bấm máy tính rồi khai tay — đúng việc cái nút này sinh ra để khỏi phải làm).

Sổ chưa khai loại "Thu nợ" / "Trả nợ" / "Rút tiết kiệm" thì tạo hộ một loại dùng chung, không bắt
chủ sổ bỏ dở việc để đi khai loại rồi quay lại.

## Trợ lý AI (mục 🤖 Trợ lý)

Hai việc, đều chạy qua Groq (cần `GROQ_API_KEY`, xem `src/common/ai.service.ts`):

- **Hỏi đáp** — gửi kèm một bản tóm tắt đã tính sẵn của đúng sổ đang mở (số theo tháng, theo loại,
  6 tháng gần nhất, sổ nợ, các khoản của tháng này) rồi trả lời. Dải 6 tháng đã bỏ khỏi màn hình
  nhưng `report.trend` vẫn giữ — nó là ngữ cảnh cho trợ lý, không phải code chết. Hội thoại lưu trong
  `household_chat_message` nên hỏi nối tiếp được ("thế còn tháng trước?").
- **Ghi nhanh bằng câu nói** — "trưa nay ăn cơm hết 65k" → bản nháp một khoản chi.

> **AI không bao giờ tự ghi vào sổ.** Nó chỉ trả về bản nháp; người dùng xem, sửa nếu cần, rồi bấm
> **Ghi vào sổ** — và lúc đó đi qua đúng đường ghi thường (`/household/income`,
> `/household/expenses`) với đầy đủ kiểm quyền và kiểm sổ. Model đoán sai số tiền là chuyện thường;
> đoán sai mà tự ghi vào sổ tiền của người ta thì không chấp nhận được. Bản nháp đi theo query
> string nên không cần bảng tạm nào.

Loại mà AI chọn phải là **loại có thật của sổ này** (khớp theo id, hoặc theo tên) — không nhận
loại model tự nghĩ ra. Mỗi IP giới hạn 12 lượt gọi AI mỗi phút.

## Các phần trong màn hình

Điều hướng giữa các phần **chỉ qua menu ba gạch** ở dưới (không có thanh tab riêng),
giống module giải đấu và đội bóng.

| Phần | Đường dẫn | Việc làm ở đó |
|------|-----------|----------------|
| 📊 Tổng quan | `/household` | Ba ô Tiết kiệm / Chi phí / Thu nhập, còn lại luỹ kế, tóm tắt sổ nợ, chi–thu theo loại |
| 💵 Thu nhập | `/household/thu` | Khai khoản thu; chép các khoản thu của tháng trước |
| 💸 Chi phí | `/household/chi` | Khai khoản chi (loại kiểu trả nợ thì có ô gốc/lãi/khoản nợ); chép khoản **cố định** của tháng trước |
| 🏦 Sổ nợ | `/household/so-no` | Khai khoản nợ mới (phần riêng, mở sẵn) · tiến độ + nút ✅ ghi nhanh từng khoản · sửa khoản cũ (gập) · ✅ Đã xong (gập) |
| 🤖 Trợ lý | `/household/tro-ly` | Hỏi đáp về sổ, ghi nhanh bằng câu nói |
| 🏷️ Loại thu nhập | `/household/loai-thu` | Khai/sửa/ẩn loại thu nhập |
| 🏷️ Loại chi phí | `/household/loai-chi` | Khai/sửa/ẩn loại chi phí |
| ⚙️ Cài đặt | `/household/cai-dat` | **Chỉ còn phân quyền admin** (+ ô chọn sổ nếu vào được nhiều sổ) |

Mọi mục xoay quanh một tháng đều có ô chọn tháng ở đầu trang (tự chuyển ngay khi đổi) và một dải
**Thu nhập / Chi phí / Còn lại** để lúc nào cũng thấy ba con số chính.

**Bấm vào một dòng khoản thu/chi** để mở ô sửa và nút xoá — không có nút Xoá lộ thiên trên danh
sách, vì trên điện thoại bấm nhầm quá dễ. Sửa dùng lại **đúng bộ kiểm của lúc ghi mới** (loại phải
thuộc sổ này, khoản nợ phải đúng chiều), nên hai đường không thể lệch quy tắc nhau.

**Tháng của một khoản luôn suy ra từ NGÀY xảy ra**, không theo tháng đang xem — ghi lùi ngày thì
dòng đó tự về đúng tháng của nó.

**Xoá một loại** thì các khoản đã khai theo loại đó **vẫn còn** (khoá ngoại `SetNull`), chỉ thành
"(loại đã xoá)" và được tính như chi phí/thu nhập thường. Xoá một khoản nợ cũng vậy: các lần trả
vẫn nằm trong sổ. Tiền đã ra khỏi nhà thì phải còn trong công thức, kể cả khi mất cái nhãn.

**Chép tháng trước** có ở cả hai mục: bên Thu chép loại `normal` (lương), bên Chi chép loại
`fixed` (khoản cố định). Loại nào tháng này đã có khoản rồi thì bỏ qua, nên bấm hai lần không
sinh trùng. Cố ý **không** chép `variable` / `saving` / `debt`: chép phát sinh là bịa ra khoản
chưa hề tiêu, chép trả nợ là tự trừ gốc một lần không có thật, chép tiết kiệm là tự đụng vào két.

## Khoản cố định: dự kiến vs đã chi thật

Khoản cố định thường được "sizing" một mức rồi thực tế chi khác đi. Form khai chi vì thế có hai ô:

| Ô | Cột DB | Nghĩa |
|---|---|---|
| Số tiền **dự kiến** | `planned_amount` | mức đặt ra đầu tháng |
| **Đã chi thực tế** | `amount` | tiền thật đã ra khỏi ví — **mọi công thức tính từ đây** |

Bỏ trống ô "đã chi" = **đã chi 0đ** (chưa tiêu đồng nào tháng này), *không phải* "chi đúng dự
kiến". Loại cố định chỉ cần **mức dự kiến > 0** là ghi được.

### Hai phần trăm ở bảng "Chi phí theo loại" — đừng lẫn

| Cột | Nghĩa | Công thức |
|---|---|---|
| **Đã dùng** | tiêu hết bao nhiêu phần **mức dự kiến** của chính loại đó | `đã chi / dự kiến` |
| **% tổng chi** | loại đó chiếm bao nhiêu phần **tổng chi của tháng** | `đã chi / Σ chi tháng` |

Khoản chi **duy nhất** của tháng luôn có *% tổng chi* = 100% dù mới tiêu một phần nhỏ mức dự kiến
— ví dụ Dự phòng dự kiến 3tr, đã chi 2tr, không có khoản nào khác: *đã dùng* 67%, *% tổng chi* 100%.
Bản trước gộp làm một cột tên "Tỷ trọng" nên chủ sổ đọc 100% và tưởng đã tiêu hết quỹ 3tr.

### Ô "🏖️ Còn du lịch năm ..." — số TỰ TÍNH, không phải dòng ghi

```
Còn du lịch = Σ (dự kiến − đã chi) của khoản cố định thuộc THÁNG ĐÃ ĐÓNG
            − Σ các khoản chi khai vào loại tên "Tiết kiệm du lịch"
```

**Chỉ tính tháng đã qua.** Tháng đang sống mà tính ngay là sai hẳn ý nghĩa: bỉm sữa khai 2tr chưa
mua ngày nào thì đó là *ngân sách chưa tiêu*, không phải *tiết kiệm được* — giữa tháng con số sẽ bị
phóng đại rồi tụt dần, nhìn không tin được gì. Phần chưa chốt nằm ở ô **Ngân sách còn**.

**Không có dòng nào trong danh sách khoản chi cho quỹ này, và không sửa được nó.** Đó là chủ ý:
quỹ kế thừa từ *rất nhiều* khoản cố định, nên nếu ghi thành một dòng riêng thì dòng đó vừa lẫn vào
danh sách vừa sửa được — sửa xong là lệch khỏi các khoản đã sinh ra nó và không còn cách nào biết
số nào đúng. Suy ra thì luôn khớp dữ liệu gốc: sửa khoản cố định là ô này tự đúng theo.

**Tiền của quỹ vẫn nằm trong "còn lại"** — nó chỉ là phần đã *đánh dấu* để dành đi chơi, chưa rời
khỏi ví. Vì thế quỹ này **không** xuất hiện trong đẳng thức tiền mặt, và **không** cộng vào ô 🐷
(ô đó chỉ đếm tiền đã cất đi thật).

Muốn **tiêu** quỹ: khai một khoản chi bình thường vào loại **Tiết kiệm du lịch** — tiền ra khỏi ví
(giảm "còn lại") và ô này trừ đi tương ứng.

> Bản trước (đã bỏ, migration `20260731210000`) ghi phần dư thành một khoản chi thật trong loại đó.
> Chủ sổ chốt bỏ vì đúng lý do ở trên. Migration xoá các dòng máy tự sinh — điều kiện bám rất chặt
> (đúng ghi chú máy đặt + đúng loại + không có mức dự kiến) nên không đụng dòng người dùng tự gõ,
> đã diễn tập trên schema nháp với chính dữ liệu thật để xác nhận.

**Khoản nợ trả/thu xong** (`initialAmount > 0` và còn lại ≤ 0) tự gập xuống mục **✅ Đã xong** và
biến khỏi ô chọn khi khai chi/thu — vẫn tra lại được đã trả bao nhiêu gốc, bao nhiêu lãi. Bắt buộc
`initialAmount > 0` vì khoản vừa khai chưa điền tiền cũng có còn lại = 0, nhận nhầm là xong thì nó
biến mất ngay lúc người dùng đang định điền tiếp.

## Sổ riêng của từng admin

Mỗi admin có **sổ chi tiêu riêng**, tự tạo lần đầu vào module. Cấu trúc phân quyền giống hệt
giải đấu và đội bóng:

- Admin khác **không đọc được** sổ của bạn, kể cả khi họ cũng có quyền `HOUSEHOLD`.
- Chủ sổ vào **⚙️ Cài đặt → 🔐 Phân quyền admin** để mời admin khác cùng xem/ghi.
- Người được mời sửa được sổ nhưng **không mời tiếp** người khác — chỉ chủ sổ cấp/gỡ quyền được.
- Vào được nhiều sổ thì có ô chọn sổ ở đầu trang Cài đặt.

## Kỹ thuật

- Công thức tiền (thuần, không đụng DB): `src/household/household-calc.ts` (`buildMonthReport`) —
  test thẳng bằng dữ liệu dựng tay, không cần DB. Bộ test `test/household.test.js` khoá lại cả bốn
  rule ở trên, nên đổi công thức là gãy ngay.
- Truy cập dữ liệu: `src/household/household.service.ts`. **Mọi phương thức nhận `householdId`
  làm tham số đầu tiên và đưa vào `where`**, kể cả khi đã có id của dòng con — gửi lên id khoản
  chi của sổ người khác thì tác động 0 dòng.
- Trợ lý: `src/household/household-ai.service.ts`. Ai vào được sổ nào: `household-access.service.ts`.
- Route/màn hình: `src/household/household.controller.ts`, `src/views/household/index.ejs`.
  Phần ẩn/hiện ô gốc–lãi nằm ở `initHouseholdEntryForm()` trong `public/js/form-controls.js`; đó
  **chỉ là tiện nghi** — không có JS thì mọi ô đều hiện và service vẫn đọc đúng ô theo `kind`.
- Bảng dữ liệu (xem `prisma/schema.prisma`): `household_config` (= một sổ, có `owner_admin_id`),
  `household_permission`, `household_income_category`, `household_expense_category`,
  `household_income`, `household_expense`, `household_debt`, `household_chat_message`.
  Mọi bảng con đều có `household_id`.
- Thêm bảng mới thì phải khai vào `ORDER` trong `scripts/restore-db.js`, nếu không
  `test/backup-restore.test.js` gãy — cái bẫy dựng sau vụ khôi phục sót 13/36 bảng.
- Phân quyền: xem [bao-mat.md](bao-mat.md).

## Lịch sử

- **Bản đầu (7/2026)** quét email VPBank từ một hòm Gmail chung qua IMAP. Đã gỡ bỏ hoàn toàn
  (migration `20260727190000_household_manual_ledger`).
- **Bản thứ hai** dùng mô hình "ví tiền tuần/tháng cho từng thành viên" + một bảng "khoản trích tay"
  gộp chung (`household_member`, `household_txn`, `household_allocation`). Đã xoá hẳn.
- **Bản thứ ba** (migration `20260729220000_household_excel_model`) dựng theo bảng tính
  `chiphi.xlsx`: 5 phần Thu · Tiết kiệm · Trả nợ · Chi phí cố định · Chi phí phát sinh, mỗi khoản
  cố định có **trần/tháng** và kiểu chi `once`/`gradual`/`weekly`, quỹ `reserve` không cộng dồn mà
  cuối tháng dồn hết sang quỹ `fun`.
- **Bản hiện tại** (migration `20260731120000_household_savings_model`) bỏ **toàn bộ** rule đó:
  không còn trần, không còn kiểu chi theo tuần, không còn quỹ nào bị reset cuối tháng. Thay bằng
  bốn rule ở đầu tài liệu này.

  Khác với hai lần dựng lại trước, lần này **không xoá dữ liệu cũ**. Migration chuyển hết sang mô
  hình mới:

  | Dữ liệu cũ | Thành gì |
  |---|---|
  | `household_income.source` | mỗi nguồn thu → một **loại thu nhập** (gộp không phân biệt hoa/thường) |
  | `household_fund` | một **loại chi phí** kiểu `saving` |
  | `household_fixed_cost` | một **loại chi phí** kiểu `normal` |
  | `household_fixed_spend`, `household_extra_cost` | khoản chi (tên khoản gộp vào ghi chú) |
  | `household_fund_entry` `in` / `out` | khoản chi kiểu `saving` / khoản thu "Rút tiết kiệm" |
  | phát sinh khai "lấy từ quỹ" | **hai** dòng: một lần rút tiết kiệm + một khoản chi, đúng như mô hình cũ tính |
  | `household_debt_payment` | khoản chi loại "Trả nợ", gắn thẳng vào khoản nợ |
  | `household_debt` | dòng sổ nợ chiều `owe` |

  **Mức nạp hàng tháng của quỹ** trước đây được hệ thống *tự cộng* mà không có dòng nào trong DB.
  Mô hình mới không tự điền gì cả, nên migration **ghi hẳn ra** thành khoản chi thật cho từng tháng
  từ lúc quỹ bắt đầu tới tháng hiện tại — không làm vậy thì số dư tiết kiệm về 0 sau khi nâng cấp.

  Một chỗ số **cố ý lệch** so với bản cũ: quỹ `reserve` (Dự phòng, Y tế) trước đây không cộng dồn,
  hết tháng còn thừa bao nhiêu dồn sang quỹ Đi chơi. Rule đó đã bỏ, nên sau khi nâng cấp mọi đồng
  đã gửi tiết kiệm đều còn nguyên trong ô 🐷.

  Migration đã được **diễn tập thật** trên một schema nháp của Supabase (dựng lại cấu trúc bảng cũ
  bằng `LIKE ... INCLUDING ALL`, nhét dữ liệu mẫu, chạy đúng file migration, đối chiếu từng con số)
  trước khi commit — không dòng nào mất loại, không dòng nào mất tiền.
