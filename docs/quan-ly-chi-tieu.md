# Module Quản Lý Chi Tiêu (household)

Sổ chi tiêu gia đình **nhập tay** — không quét email, không kết nối ngân hàng. Chỉ admin dùng được.

Rule chỉ có **bốn ý**, cố ý giữ ít:

1. Chủ sổ tự khai **loại thu nhập** và **loại chi phí**; mỗi khoản thu/chi thuộc một loại.
2. Loại nào đánh dấu **tiết kiệm** thì tiền vào đó **dồn qua các tháng**.
3. Loại nào đánh dấu **trả nợ / thu nợ** thì khoản đó gắn vào một dòng trong **sổ nợ**, phần
   **gốc** tự trừ vào khoản nợ được chọn.
4. **Trợ lý AI** đọc số liệu của sổ để trả lời, và đọc câu nói thường thành khoản chi điền sẵn.

## Kiểu của một loại (`kind`)

Cả loại thu lẫn loại chi đều có đúng ba kiểu, và chính `kind` quyết định tiền chảy vào ô nào:

| `kind` | Loại **chi phí** | Loại **thu nhập** |
|---|---|---|
| `normal` | 💸 Chi phí | 💵 Thu nhập |
| `saving` | 🐷 **Gửi** tiết kiệm — không tính là chi phí | 🐷 **Rút** tiết kiệm ra tiêu — không tính là thu nhập |
| `debt` | 🏦 Trả nợ — gốc trừ vào khoản **mình nợ** | 🤝 Người ta trả nợ mình — gốc trừ vào khoản **mình cho vay** |

Vì sao tách `saving` ra khỏi chi phí: tiền cất vào két **không mất đi**, nó chỉ đổi chỗ. Gộp chung
thì ô "Chi phí" phồng lên vô nghĩa và tháng nào gửi tiết kiệm nhiều lại trông như tháng tiêu hoang.

## Ba ô ở Tổng quan

```
🐷 Tiết kiệm đang có = Σ (gửi − rút) của MỌI tháng từ đầu sổ tới tháng đang xem   ← dồn qua các tháng
💸 Chi phí tháng     = Σ khoản chi kiểu normal + debt   (gốc lẫn lãi đều là tiền ra)
💵 Thu nhập tháng    = Σ khoản thu kiểu normal + debt
```

Thêm một ô thứ tư cho tiền mặt chưa cất đi đâu:

```
Còn lại tháng này = Σ MỌI khoản thu − Σ MỌI khoản chi        (gồm cả gửi/rút tiết kiệm)
Còn lại luỹ kế    = còn lại của MỌI tháng trước + tháng này
```

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

## Trợ lý AI (mục 🤖 Trợ lý)

Hai việc, đều chạy qua Groq (cần `GROQ_API_KEY`, xem `src/common/ai.service.ts`):

- **Hỏi đáp** — gửi kèm một bản tóm tắt đã tính sẵn của đúng sổ đang mở (số theo tháng, theo loại,
  6 tháng gần nhất, sổ nợ, các khoản của tháng này) rồi trả lời. Hội thoại lưu trong
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
| 📊 Tổng quan | `/household` | Ba ô Tiết kiệm / Chi phí / Thu nhập, còn lại luỹ kế, tóm tắt sổ nợ, chi–thu theo loại, dải 6 tháng |
| 💵 Thu nhập | `/household/thu` | Khai khoản thu; chép các khoản thu của tháng trước |
| 💸 Chi phí | `/household/chi` | Khai khoản chi; loại kiểu trả nợ thì có ô gốc/lãi/khoản nợ |
| 🏦 Sổ nợ | `/household/so-no` | Khai khoản mình nợ và khoản người khác nợ mình, tiến độ trả từng khoản |
| 🤖 Trợ lý | `/household/tro-ly` | Hỏi đáp về sổ, ghi nhanh bằng câu nói |
| 🏷️ Loại thu nhập | `/household/loai-thu` | Khai/sửa/ẩn loại thu nhập |
| 🏷️ Loại chi phí | `/household/loai-chi` | Khai/sửa/ẩn loại chi phí |
| ⚙️ Cài đặt | `/household/cai-dat` | Tên sổ, mốc bắt đầu ghi sổ, **nạp danh mục mẫu**, **phân quyền admin** |

Mọi mục xoay quanh một tháng đều có ô chọn tháng ở đầu trang (tự chuyển ngay khi đổi) và một dải
**Thu nhập / Chi phí / Còn lại** để lúc nào cũng thấy ba con số chính.

**Tháng của một khoản luôn suy ra từ NGÀY xảy ra**, không theo tháng đang xem — ghi lùi ngày thì
dòng đó tự về đúng tháng của nó.

**Xoá một loại** thì các khoản đã khai theo loại đó **vẫn còn** (khoá ngoại `SetNull`), chỉ thành
"(loại đã xoá)" và được tính như chi phí/thu nhập thường. Xoá một khoản nợ cũng vậy: các lần trả
vẫn nằm trong sổ. Tiền đã ra khỏi nhà thì phải còn trong công thức, kể cả khi mất cái nhãn.

**Nạp danh mục mẫu** dựng sẵn vài loại thu/chi thường gặp, **không nạp sẵn số tiền nào**. Chỉ nạp
phần đang trống nên bấm nhiều lần cũng không sinh dòng trùng.

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
