# Module Quản Lý Chi Tiêu (household)

Theo dõi chi tiêu 2 vợ chồng dựa trên email báo giao dịch của **VPBank**. Chỉ admin dùng được.

## Nguyên tắc

- **VPBank là túi chi tiêu duy nhất.** Mỗi email VPBank báo "chuyển tiền đi" = 1 khoản chi.
  **Mọi** giao dịch tiền-ra đều tính là chi tiêu, kể cả chuyển nội bộ giữa 2 vợ chồng
  (không ngoại lệ). Vẫn có thể sửa tay từng khoản sang "Không tính" kèm ghi chú.
- **Ngân sách mỗi tuần** được nạp mặc định và **cộng dồn phần dư** sang tuần sau (rollover).
- **Tiết kiệm mỗi tháng** cộng dồn theo số tháng kể từ ngày bắt đầu theo dõi. Khi số dư
  chi tiêu âm (tiêu lẹm), hệ thống **tự bù từ tiết kiệm** để kéo số dư về 0 và **bắt buộc
  ghi chú lý do**.
- Tiền vào VPBank hàng tuần đến từ 1 ngân hàng khác (không sinh email), nên "ngân sách tuần"
  và "tiết kiệm tháng" là **số cấu hình nhập tay**, không quét từ email.

## Cách lấy email (đã chọn: forward về 1 hòm Gmail chung)

1. Tạo 1 hòm Gmail chuyên dụng, VD `chi.tieu.gia.dinh@gmail.com`.
2. Bật xác minh 2 bước cho hòm đó → tạo **App password** (mật khẩu ứng dụng 16 ký tự).
3. Ở Gmail cá nhân của **cả 2 vợ chồng**: đặt bộ lọc tự động **forward** email từ VPBank
   sang hòm chung (Settings → Filters → Forward; hoặc Forwarding and POP/IMAP).
4. Bật IMAP cho hòm chung (Settings → Forwarding and POP/IMAP → Enable IMAP).

## Biến môi trường (Render)

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|------|----------|----------|---------|
| `HOUSEHOLD_GMAIL_USER` | ✅ | – | Email hòm Gmail chung |
| `HOUSEHOLD_GMAIL_APP_PASSWORD` | ✅ | – | App password 16 ký tự |
| `HOUSEHOLD_GMAIL_HOST` | | `imap.gmail.com` | Máy chủ IMAP |
| `HOUSEHOLD_GMAIL_PORT` | | `993` | Cổng IMAP (SSL) |
| `HOUSEHOLD_IMAP_FOLDER` | | `INBOX` | Thư mục quét |
| `HOUSEHOLD_SCAN_DAYS` | | `90` | Quét email trong bao nhiêu ngày gần nhất |
| `HOUSEHOLD_POLL_MINUTES` | | (tắt) | Nếu đặt >0 thì tự quét định kỳ mỗi ngần đó phút |

Không đặt app password vào code. Chỉ quét đúng hòm chung nên không đụng email riêng tư.

## Sử dụng

1. Vào **Chi Tiêu** trên trang chủ (cần được cấp quyền `HOUSEHOLD` ở Phân Quyền).
2. Nhập **Cấu hình**: ngân sách/tuần, tiết kiệm/tháng, ngày bắt đầu theo dõi.
3. (Tuỳ chọn) thêm **Tài khoản của nhà** để gắn nhãn Chồng/Vợ cho giao dịch.
4. Bấm **Quét ngay** (hoặc để tự quét nếu bật `HOUSEHOLD_POLL_MINUTES`).
5. Khi có cảnh báo **"Đang lẹm vào tiết kiệm"** → nhập lý do để xác nhận.

## Kỹ thuật

- Parser: `src/household/household-parser.ts` (regex theo nhãn tiếng Việt, có test
  `test/household-parser.test.js` dựng theo mẫu email thật).
- Đọc IMAP: `src/household/household-email.service.ts` (`imapflow` + `mailparser`).
- Sổ tiền: `src/household/household.service.ts` (`reconcileShortfall`, `summary`).
- Chống trùng: mỗi giao dịch upsert theo **Mã giao dịch** (`txn_code` unique).
