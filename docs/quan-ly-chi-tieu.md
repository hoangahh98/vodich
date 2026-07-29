# Module Quản Lý Chi Tiêu (household)

Sổ chi tiêu gia đình **nhập tay** — không quét email, không kết nối ngân hàng. Chỉ admin dùng được.

Dựng theo đúng bảng tính `chiphi.xlsx` của chủ nhà: mỗi tháng là một sổ gồm **5 phần**, tiền chảy
một chiều từ Thu xuống Còn thừa.

## Năm phần và cách tính

### 1. 💵 Thu

Lương vợ, lương chồng, OT, thưởng, thu khác — nhập theo từng tháng. Có nút **chép các khoản thu
của tháng trước** cho nhanh (bỏ qua khoản đã trùng tên).

### 2. 🐷 Tiết kiệm

Mỗi quỹ **tự nạp mức của mình mỗi tháng**, không phải nhập lại. `kind` quyết định phần chưa tiêu đi đâu:

| `kind` | Ví dụ | Phần chưa tiêu |
|---|---|---|
| `accumulate` | Tiết kiệm 2 vợ chồng, Tiết kiệm con | **cộng dồn** mãi qua các tháng |
| `reserve` | Dự phòng, Y tế | **không** cộng dồn — hết tháng còn thừa bao nhiêu **dồn hết sang quỹ `fun`** |
| `fun` | Đi chơi | cộng dồn, và **nhận thêm** phần thừa của mọi quỹ `reserve` |

Phần thừa của `reserve` chỉ chảy sang `fun` khi **tháng đó đã đóng**. Tháng đang xem thì màn hình
chỉ báo trước số sắp dồn (`reserveCarryThisMonth`) chứ chưa cộng vào số dư — nếu không, con số nhảy
lung tung mỗi lần tiêu thêm giữa tháng.

Ngoài mức nạp mặc định còn ghi được từng lần **nạp thêm** (`in`) hoặc **rút ra dùng** (`out`).

### 3. 🏦 Trả nợ

Nợ ban đầu điền một lần. Mỗi tháng điền **gốc** và **lãi**:

```
Nợ còn lại = nợ ban đầu − Σ tiền GỐC đã trả (tới hết tháng đang xem)
```

Lãi **không** làm giảm nợ, nhưng vẫn là tiền ra khỏi nhà nên vẫn trừ vào phần còn thừa.
Mỗi khoản nợ chỉ có **một dòng mỗi tháng** (khoá duy nhất ở DB) — bấm Lưu nhiều lần cũng ghi đè,
không bao giờ cộng trùng.

### 4. 📌 Chi phí cố định

Mỗi khoản có **trần/tháng** và một cách tính "đã chi" riêng:

| `mode` | Ví dụ | Đã chi được tính thế nào |
|---|---|---|
| `once` | Gửi xe ô tô, học phí, đưa ông bà | Chưa ghi khoản nào ⇒ **mặc định coi như đã chi đủ trần**. Ghi số thật rồi thì dùng số thật. |
| `gradual` | Xăng xe, bỉm sữa, sinh hoạt con | Cộng theo **từng lần ghi**. Trần chưa dùng hết đẩy vào phần còn thừa. |
| `weekly` | Sinh hoạt vợ, sinh hoạt chồng | Xem dưới. |

**Kiểu `weekly`** — đúng cách chủ nhà đếm tuần:

```
số tuần của tháng = số ngày THỨ HAI nằm trong tháng đó   (4 hoặc 5)
trần               = số tuần × mức tuần                   (4 tuần ⇒ 2tr · 5 tuần ⇒ 2tr5)
mỗi tuần: hết tuần rồi   ⇒ mặc định đã chi hết mức tuần (500k)
          đang trong tuần ⇒ 0 cho tới khi hết tuần
          có ghi số thật  ⇒ dùng số đã ghi, không tự điền đè lên
```

Tuần cuối có thể tràn sang đầu tháng sau (ví dụ 29/6–5/7) — đó là chủ ý, vì tuần thuộc về tháng
chứa **ngày đầu tuần** của nó, nên cộng 12 tháng lại vẫn đúng 52/53 tuần, không đếm trùng.

### 5. 🎁 Chi phí phát sinh

Khoản chi ngoài kế hoạch. Điểm mấu chốt là **lấy tiền từ đâu** — chính chỗ này quyết định nó có bị
trừ hai lần hay không:

| `source` | Nghĩa | Ảnh hưởng |
|---|---|---|
| `new` | Khoản chi mới | Trừ thẳng vào tiền còn thừa của tháng |
| `fixed` | Lấy từ một khoản chi phí cố định | Tính là một lần chi của khoản đó — **không trừ thêm lần nữa** |
| `fund` | Lấy từ một quỹ tiết kiệm | Tính là một lần rút quỹ đó — **không trừ thêm lần nữa** |

Xoá quỹ / khoản cố định thì các khoản phát sinh trỏ vào đó **rơi về `new`** chứ không biến mất —
tiền đã ra khỏi nhà thì phải còn trong công thức.

## Còn thừa

```
Còn thừa tháng này = Σ thu
                   − (gốc + lãi) trả nợ
                   − Σ mức nạp tiết kiệm
                   − Σ ĐÃ CHI của chi phí cố định     ← không phải trần
                   − Σ chi phí phát sinh nguồn "mới"

Tổng còn thừa      = còn thừa của MỌI tháng trước + còn thừa tháng này
```

Trần chi phí cố định chưa dùng hết **không bị mất** — nó nằm luôn trong phần còn thừa.

Vì "còn thừa" và số dư quỹ đều là số lũy kế, mọi thứ được **tính lại từ tháng đầu tiên có dữ liệu**
tới tháng đang xem mỗi lần mở trang. Sổ một gia đình chỉ vài trăm dòng nên rẻ, đổi lại là sửa một
con số ở tháng cũ thì mọi tháng sau tự đúng theo, không cần "chốt sổ".

Danh mục đang **Tạm dừng** thì ngừng chạy **từ tháng hiện tại trở đi**; các tháng đã qua giữ nguyên
số cũ — nếu không, bấm tạm dừng một khoản là lịch sử vài tháng trước tự đổi theo.

## Các phần trong màn hình

Điều hướng giữa các phần **chỉ qua menu ba gạch** ở dưới (không có thanh tab riêng),
giống module giải đấu và đội bóng.

| Phần | Đường dẫn | Việc làm ở đó |
|------|-----------|----------------|
| 📊 Tổng quan | `/household` | Tổng còn thừa, thu, tiết kiệm đang có, nợ còn lại, bảng 5 phần của tháng |
| 💵 Thu | `/household/thu` | Nhập lương/OT/thu khác; chép từ tháng trước |
| 🐷 Tiết kiệm | `/household/tiet-kiem` | Số dư từng quỹ, nạp thêm / rút ra, quản lý danh mục quỹ |
| 🏦 Trả nợ | `/household/tra-no` | Nợ còn lại, nhập gốc & lãi của tháng, quản lý danh mục nợ |
| 📌 Chi phí cố định | `/household/chi-phi-co-dinh` | Trần / đã chi / còn lại từng khoản, chi tiết từng tuần, ghi lần chi |
| 🎁 Phát sinh | `/household/phat-sinh` | Ghi khoản phát sinh và chọn lấy tiền từ đâu |
| ⚙️ Cài đặt | `/household/cai-dat` | Mức sinh hoạt tuần, thứ bắt đầu tuần, mốc theo dõi, **nạp danh mục mẫu**, **phân quyền admin** |

Mọi mục xoay quanh một tháng đều có ô chọn tháng ở đầu trang (tự chuyển ngay khi đổi) và một dải
**Còn thừa tháng trước / tháng này / tổng** để lúc nào cũng thấy con số cuối cùng.

**Nạp danh mục mẫu** dựng sẵn đúng các dòng trong bảng tính (5 quỹ, khoản nợ ngân hàng, 9 khoản chi
phí cố định, 2 khoản lương). Chỉ nạp phần nào đang trống nên bấm nhiều lần cũng không sinh dòng trùng.

## Sổ riêng của từng admin

Mỗi admin có **sổ chi tiêu riêng**, tự tạo lần đầu vào module. Cấu trúc phân quyền giống hệt
giải đấu và đội bóng:

- Admin khác **không đọc được** sổ của bạn, kể cả khi họ cũng có quyền `HOUSEHOLD`.
- Chủ sổ vào **⚙️ Cài đặt → 🔐 Phân quyền admin** để mời admin khác cùng xem/ghi.
- Người được mời sửa được sổ nhưng **không mời tiếp** người khác — chỉ chủ sổ cấp/gỡ quyền được.
- Vào được nhiều sổ thì có ô chọn sổ ở đầu trang Cài đặt.

## Kỹ thuật

- Công thức tiền (thuần, không đụng DB): `src/household/household-calc.ts` (`buildMonthReport`) —
  test thẳng bằng dữ liệu dựng tay, không cần DB. Bộ test `test/household.test.js` khoá lại đúng
  con số cuối cùng của bảng tính (**còn thừa = 2.350.000 đ**), nên đổi công thức là gãy ngay.
- Truy cập dữ liệu: `src/household/household.service.ts`. **Mọi phương thức nhận `householdId`
  làm tham số đầu tiên và đưa vào `where`**, kể cả khi đã có id của dòng con — gửi lên id khoản
  chi của sổ người khác thì tác động 0 dòng.
- Ai vào được sổ nào: `src/household/household-access.service.ts`.
- Route/màn hình: `src/household/household.controller.ts`, `src/views/household/index.ejs`.
- Bảng dữ liệu (xem `prisma/schema.prisma`): `household_config` (= một sổ, có `owner_admin_id`),
  `household_permission`, `household_income`, `household_fund` + `household_fund_entry`,
  `household_debt` + `household_debt_payment`, `household_fixed_cost` + `household_fixed_spend`,
  `household_extra_cost`. Mọi bảng con đều có `household_id`.
- Thêm bảng mới thì phải khai vào `ORDER` trong `scripts/restore-db.js`, nếu không
  `test/backup-restore.test.js` gãy — cái bẫy dựng sau vụ khôi phục sót 13/36 bảng.
- Phân quyền: xem [bao-mat.md](bao-mat.md).

## Lịch sử

- **Bản đầu (7/2026)** quét email VPBank từ một hòm Gmail chung qua IMAP. Đã gỡ bỏ hoàn toàn
  (migration `20260727190000_household_manual_ledger`).
- **Bản thứ hai** dùng mô hình "ví tiền tuần/tháng cho từng thành viên" + một bảng "khoản trích tay"
  gộp chung (`household_member`, `household_txn`, `household_allocation`).
- **Bản hiện tại** (migration `20260729220000_household_excel_model`) dựng lại theo bảng tính
  `chiphi.xlsx`: 5 phần tách bạch như trên. Ba bảng của mô hình ví tiền đã bị **xoá hẳn** — chủ sổ
  chốt bỏ dữ liệu cũ trước khi làm. `household_income` giữ nguyên vì phần "Thu" không đổi, và cột
  `household_config.weekly_allowance` đổi tên thành `weekly_rate` (giờ là **mức sinh hoạt tuần**
  của khoản chi phí cố định kiểu `weekly`, không còn là tiền tiêu của từng người).
