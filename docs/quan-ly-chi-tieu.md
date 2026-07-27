# Module Quản Lý Chi Tiêu (household)

Sổ chi tiêu gia đình **nhập tay** — không quét email, không kết nối ngân hàng. Chỉ admin dùng được.

## Nguyên tắc tiền

1. **Gộp quỹ.** Lương chồng + lương vợ (+ thưởng, thu khác) nhập vào **quỹ chung** theo từng tháng.
2. **Trích ra trước.** Ngay khi có lương, trích các khoản cố định khỏi quỹ chung:
   - `savings` — tiết kiệm
   - `debt` — trả nợ
   - `other` — khoản khác (học phí, bảo hiểm, biếu bố mẹ...)
3. **Tiền tiêu tự trích.** Mỗi đầu tuần, nhà dành ra mức tuần chuẩn (mặc định
   **500.000 đ/người/tuần**, đổi ở Cài đặt) cho từng thành viên. Khoản này **tự tính**,
   không phải nhập tay, và tự trừ khỏi quỹ chung.
4. **Hai chu kỳ nhận** (`cycle` của thành viên) — khác nhau ở chỗ có cộng dồn hay không:

   | | `weekly` (vợ chồng) | `monthly` (con) |
   |---|---|---|
   | Cầm tay | mức đó **mỗi tuần** | mức đó cho **cả tháng** |
   | Tiêu không hết | **bị xoá** khi sang tuần mới | **dồn sang tháng sau** |
   | Tiêu quá | **nhà bù** ⇒ trừ quỹ chung | trừ vào **🧸 quỹ tiết kiệm của con** (tiết kiệm ít đi); cạn quỹ mới đến nhà bù |

   Với `monthly`, nhà vẫn dành mức tuần chuẩn cho con — phần con chưa cầm tay
   (`500k × số tuần còn lại của tháng`) chính là **quỹ tiết kiệm riêng của con**.
5. **Chi chung.** Khoản chi không gắn với ai (điện, nước, đi chợ...) trừ thẳng vào quỹ chung.

Công thức:

```
Ngân sách đã trích = mức tuần chuẩn × số tuần đã trôi          (cho MỌI thành viên)

weekly:  ví            = mức tuần − đã tiêu trong TUẦN NÀY
         nhà bù        = Σ các tuần max(0, chi trong tuần − mức tuần)

monthly: đã cầm tay    = mức tháng × số tháng đã trôi
         ví            = đã cầm tay − TỔNG đã tiêu               (cộng dồn, có thể âm)
         quỹ của con   = max(0, ngân sách đã trích − max(đã cầm tay, tổng đã tiêu))
         nhà bù        = max(0, tổng đã tiêu − ngân sách đã trích)

Quỹ chung còn lại = Σ thu − Σ trích tay − Σ ngân sách đã trích − Σ chi chung − Σ nhà bù
```

Số tuần tính từ **tuần chứa** ngày muộn hơn giữa *ngày bắt đầu theo dõi* (Cài đặt)
và *ngày thành viên bắt đầu nhận* — nên thêm người giữa chừng không làm sai lịch sử.
Mỗi tuần thuộc về tháng chứa **ngày đầu tuần** của nó, nên cộng 12 tháng lại vẫn đúng
52/53 tuần, không đếm trùng. Thành viên "Tạm dừng" thì ngừng trích tiền tuần.

## Các phần trong màn hình

Điều hướng giữa các phần **chỉ qua menu ba gạch** ở dưới (không có thanh tab riêng),
giống module giải đấu và đội bóng.

| Phần | Việc làm ở đó |
|------|----------------|
| 📊 Tổng quan | Quỹ chung còn lại, ví từng người, quỹ tiết kiệm của con, dòng tiền tóm tắt |
| 💵 Thu & phân bổ | Nhập lương/thu của tháng, các khoản trích tay, xem khoản tiền tiêu **tự trích**; có nút **chép các khoản của tháng trước** |
| 🧾 Chi tiêu | Ghi khoản chi (chọn của ai hoặc "chi chung"); sửa = xoá rồi nhập lại |
| ⚙️ Cài đặt | Mức tuần mặc định, thứ bắt đầu tuần, ngày bắt đầu theo dõi, thành viên + **chu kỳ nhận** |

## Sử dụng

1. Vào **Chi Tiêu** trên trang chủ (cần quyền `HOUSEHOLD` ở Phân Quyền).
2. **Cài đặt**: đặt mức tuần mặc định (500.000 đ), ngày bắt đầu theo dõi, rồi thêm thành viên.
   Vợ chồng để chu kỳ **Hàng tuần**; con để **Hàng tháng (con)** — con chỉ cầm 500k cho cả
   tháng, tiêu không hết thì dồn sang tháng sau, tiêu quá thì quỹ tiết kiệm của con vơi đi.
   Ai cần mức khác thì điền "Mức riêng".
3. **Thu & phân bổ**: mỗi tháng nhập lương 2 vợ chồng, rồi thêm các khoản trích tay
   (tiết kiệm, trả nợ...). Tiền tiêu cả nhà đã tự trích sẵn, không cần nhập.
   Tháng sau bấm "Chép các khoản của tháng trước" cho nhanh.
4. **Chi tiêu**: ghi từng khoản chi, chọn của ai — trừ vào ví người đó; để "🏠 Chi chung" — trừ quỹ chung.

## Kỹ thuật

- Nghiệp vụ & công thức: `src/household/household.service.ts` (`summary`, `monthBook`).
- Route/màn hình: `src/household/household.controller.ts`, `src/views/household/index.ejs`.
- Bảng dữ liệu: `household_config`, `household_member`, `household_income`,
  `household_allocation`, `household_txn` (xem `prisma/schema.prisma`).
- Xoá thành viên **không** xoá khoản chi của họ: `member_id` chuyển về NULL ⇒ thành chi chung.

## Lịch sử

Bản đầu tiên (7/2026) quét email VPBank từ một hòm Gmail chung qua IMAP. Đã **gỡ bỏ hoàn toàn**
(migration `20260727190000_household_manual_ledger`): xoá parser, service IMAP, các biến môi trường
`HOUSEHOLD_GMAIL_*`, gói `imapflow`/`mailparser` và các bảng `household_account`,
`household_savings_entry`, cùng bảng `household_txn` cũ.
