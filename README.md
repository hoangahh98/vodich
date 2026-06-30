# Duhy

Ứng dụng Flask quản lý giải đấu pickleball, đội bóng, thu chi chuyến đi và các công cụ giải trí/ghi điểm cho nhóm chơi.

## Chạy dự án

```bash
pip install -r requirements.txt
python init_db.py
python app.py
```

Cấu hình môi trường theo `.env.example`. Khi app khởi động, `ensure_all_schema()` tự tạo hoặc bổ sung bảng/cột còn thiếu.

## Đăng nhập và vai trò

- Admin đăng nhập bằng tài khoản trong bảng `users`.
- VĐV có sẵn đăng nhập bằng email trong `user_clients`, mật khẩu mặc định `123456789`.
- VĐV đăng ký ngoài đăng nhập bằng email đã dùng ở form đăng ký ngoài, mật khẩu mặc định `123456789`.
- VĐV chỉ thấy các giải/đội/chuyến đi gắn với mình hoặc email của mình.

## Quản lý giải đấu

Admin có thể:

- Tạo, sửa, xóa giải đấu.
- Nhập tên giải, địa điểm, thời gian, số sân, số người dự kiến.
- Chọn thi đơn hoặc thi đôi.
- Cấu hình luật điểm: điểm chạm và max điểm.
- Chọn thể thức vòng tròn hoặc đánh bảng kèm knockout.
- Cấu hình số đội mỗi bảng, số bảng, số đội vào vòng trong.
- Nhập chi phí sân bãi, ăn uống, giải thưởng, chi phí khác.
- Nhập tỷ lệ hoặc tiền giải nhất/nhì/ba.
- Cấp quyền admin khác cùng xem/quản lý giải.

## Đăng ký VĐV trong giải

Trong chi tiết giải, admin có thể:

- Thêm nhiều VĐV có sẵn từ bảng `user_clients`.
- Theo dõi số lượng đã đăng ký so với số người dự kiến.
- Cập nhật tiền đã đóng và trạng thái đóng phí hàng loạt.
- Copy danh sách email VĐV.
- Copy nội dung email mời tham gia giải.

## Đăng ký ngoài

Khi tạo hoặc sửa giải, admin có thể bật `Cho phép đăng ký ngoài`.

Khi bật:

- Chi tiết giải hiển thị link đăng ký ngoài.
- Người nhận link tự nhập họ tên, email và chọn trình độ A/B/C/D.
- Sau khi bấm đăng ký, hệ thống thêm người đó thẳng vào giải.
- Dữ liệu được lưu ở bảng riêng `dang_ky_giai_ngoai`, không ghi vào bảng VĐV nhập tay `user_clients`.
- Người đăng ký ngoài chỉ thuộc giải đã đăng ký bằng dòng dữ liệu đó.
- Nếu cùng email đăng ký nhiều giải, khi đăng nhập màn hình VĐV sẽ hiện nhiều giải tương ứng.
- Màn hình thành công trả về email đăng nhập, mật khẩu mặc định `123456789`, link đăng nhập và link xem giải.

## Bỏ giải và khôi phục

Đăng ký giải không còn bị xóa cứng khỏi dữ liệu.

- Nút cũ xóa đăng ký được thay bằng `Bỏ`.
- Khi bấm `Bỏ`, đăng ký chuyển trạng thái `withdrawn`.
- VĐV đã bỏ giải không còn nằm trong danh sách đang thi đấu, không được đưa vào tạo lịch và không tính vào bảng phí hiện tại.
- Các VĐV bỏ giải hiển thị ở nhóm `Bỏ giải`.
- Admin có thể bấm `Khôi phục` để đưa người đó trở lại giải.

Áp dụng cho cả đăng ký từ VĐV có sẵn và đăng ký ngoài.

## Lịch thi đấu và ghi điểm giải

Hệ thống hỗ trợ:

- Tự chia lịch theo thi đơn hoặc thi đôi.
- Ghép đôi thông minh theo trình độ cho thi đôi.
- Ghép đôi thủ công khi cần chọn cặp cụ thể.
- Chia vòng tròn hoặc đánh bảng kèm vòng trong.
- Ghi điểm trận đấu bằng modal.
- Tự lưu điểm khi thay đổi.
- Giới hạn điểm theo luật chạm điểm/max điểm.
- Chọn thứ tự đánh và đội đang giao.
- Đọc điểm bằng giọng nói tiếng Việt nếu trình duyệt hỗ trợ.
- Bảng xếp hạng tự cập nhật theo kết quả.

## Dashboard VĐV

VĐV đăng nhập sẽ thấy:

- Các giải đã đăng ký.
- Chi tiết giải, danh sách VĐV, lịch thi đấu, bảng xếp hạng.
- Đội bóng mình thuộc về.
- Chuyến đi/thu chi mình được gắn.
- Công cụ đọc điểm giao lưu.
- Khu vực giải trí.

## Quản lý VĐV

Admin có thể:

- Thêm VĐV thủ công vào `user_clients`.
- Sửa họ tên, email, trình độ, ghi chú.
- Xóa VĐV thủ công nếu không còn dùng.
- VĐV thủ công dùng email để đăng nhập với mật khẩu mặc định `123456789`.

Đăng ký ngoài không tạo VĐV thủ công và không xuất hiện trong danh sách này.

## Quản lý đội bóng

Admin có thể:

- Tạo, sửa, xóa đội bóng.
- Thêm thành viên từ danh sách VĐV.
- Phân loại thành viên cố định hoặc vãng lai.
- Cấu hình phí tháng.
- Theo dõi tiền đóng từng tháng.
- Ghi khoản chi của đội.
- Tính quỹ đội theo tháng.
- Cấp quyền admin khác cùng xem/quản lý đội.

VĐV được gắn vào đội có thể xem thông tin đội trên dashboard.

## Thu chi chuyến đi

Module `travel_app` hỗ trợ:

- Quản lý chuyến đi.
- Quản lý người tham gia.
- Ghi khoản thu, khoản chi.
- Theo dõi người xem/chuyến đi theo quyền được gắn.
- Có đường dẫn legacy tự chuyển về `/thu-chi/...`.

## Giải trí

Trang `Giải trí` có ba công cụ và mỗi công cụ có nút `Hướng dẫn sử dụng` ngay cạnh nút mở.

### Ghi điểm đánh bài

- Tạo ván ghi điểm.
- Thêm người chơi.
- Ghi điểm từng trận.
- Dùng xúc xắc chọn người đánh trước.
- Xem bảng xếp hạng và kết thúc ván.

### Tố liêng

- Tạo bàn với min/max cược.
- Người chơi tự vào bàn.
- Quay vị trí.
- Tố hoặc bỏ theo lượt.
- Tự cộng pot cho người thắng.
- Lưu lịch sử hành động.

### 3 cây

Luồng cơ bản:

1. Tạo bàn với min/max cược.
2. Người chơi tự thêm mình vào bàn.
3. Quay hoặc chọn chương.
4. Chương bắt đầu ván.
5. Người không phải chương có 20 giây đặt cược.
6. Chương chốt từng người thắng/thua và chọn hệ số x1, x2, x3 hoặc x4.
7. Hệ thống cộng/trừ điểm và ghi lịch sử.

Tính năng gửi điểm:

- Người không phải chương có thể gửi điểm sang người chơi khác trong thời gian đặt cược.
- Nút `1x`: gửi `min điểm x 1`.
- Nút `2x`: gửi `min điểm x 2`.
- Không gửi sang chương và không gửi sang chính mình.
- Khoản gửi đi theo kết quả của người được gửi.
- Nếu A gửi theo B và B thắng chương x3, A cũng thắng khoản gửi x3 từ chương.
- Nếu B thua chương x3, A cũng thua khoản gửi x3 cho chương.
- Dữ liệu gửi điểm lưu ở `entertainment_ba_cay_point_transfers`.

## PWA và giao diện

- Có manifest, service worker và icon.
- Có partial `_pwa_head.html`, `_pwa_register.html`.
- Có feedback tương tác qua `_interaction_feedback.html` và `static/interaction-feedback.js`.

## Bảng dữ liệu chính

- `users`: tài khoản admin.
- `user_clients`: VĐV nhập tay.
- `giai_dau`: giải đấu.
- `dang_ky_giai`: đăng ký giải của VĐV nhập tay.
- `dang_ky_giai_ngoai`: đăng ký ngoài theo từng giải.
- `tran_dau`: lịch và điểm trận đấu.
- `giai_dau_admin_quyen`: phân quyền admin theo giải.
- `doi_bong`: đội bóng.
- `doi_bong_thanh_vien`: thành viên đội.
- `doi_bong_dong_phi`: đóng phí đội theo tháng.
- `doi_bong_khoan_chi`: khoản chi đội.
- `entertainment_*`: các bảng giải trí, ghi điểm, tố liêng và 3 cây.
- `app_logs`, `user_actions`: log hệ thống và thao tác.

## Kiểm tra nhanh

```bash
python -m py_compile app.py models.py schema.py validators.py
```
