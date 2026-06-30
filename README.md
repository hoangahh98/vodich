# Duhy

Ứng dụng Flask quản lý giải đấu pickleball và các công cụ giải trí/ghi điểm cho nhóm chơi.

## Tính năng chính

- Đăng nhập theo vai trò admin và người chơi.
- Quản lý vận động viên, đội bóng, giải đấu, đăng ký giải và lịch thi đấu.
- Theo dõi chi phí, quỹ, giải thưởng và lịch sử thao tác.
- PWA cơ bản với manifest, service worker và icon cài đặt.
- Khu vực giải trí gồm ghi điểm đánh bài, tố liêng và 3 cây.

## Chạy dự án

1. Tạo môi trường Python và cài thư viện:

```bash
pip install -r requirements.txt
```

2. Cấu hình biến môi trường theo `.env.example`.

3. Khởi tạo/cập nhật schema:

```bash
python init_db.py
```

4. Chạy ứng dụng:

```bash
python app.py
```

Ứng dụng tự gọi `ensure_all_schema()` khi khởi động để bổ sung các bảng/cột còn thiếu.

## Khu vực giải trí

Vào mục `Giải trí` để mở ba công cụ:

- `Mở ghi điểm`: ghi điểm đánh bài tự do.
- `Mở tố liêng`: tạo bàn tố liêng, tố/bỏ theo lượt và cộng pot cho người thắng.
- `Mở 3 cây`: tạo bàn 3 cây, chọn chương, đặt cược và chốt thắng/thua.

Ngay cạnh từng nút mở có nút `Hướng dẫn sử dụng`. Nút này mở hướng dẫn nhanh ngay trong trang, không cần rời màn hình.

## Ghi điểm đánh bài

- Tạo ván ghi điểm.
- Thêm người chơi vào ván.
- Dùng xúc xắc để chọn ngẫu nhiên người đánh trước nếu cần.
- Nhập điểm từng trận cho từng người.
- Xem bảng xếp hạng và bảng điểm cuối ván khi kết thúc.

## Tố liêng

- Tạo bàn với min cược và max cược tùy chọn.
- Người chơi tự thêm mình vào bàn.
- Có thể quay vị trí để sắp xếp lượt.
- Người chơi tố hoặc bỏ theo lượt trong thời gian quy định.
- Người thắng nhận pot, hệ thống tự cộng điểm và ghi lịch sử.

## 3 cây

Luồng cơ bản:

1. Tạo bàn với min cược và max cược tùy chọn.
2. Người chơi tự thêm mình vào bàn.
3. Quay hoặc chọn chương.
4. Chương bấm `Bắt đầu ván`.
5. Người không phải chương có 20 giây để đặt cược.
6. Chương chốt từng người là `Thắng` hoặc `Thua`, chọn hệ số trả thưởng x1, x2, x3 hoặc x4.
7. Hệ thống cộng/trừ điểm giữa chương và từng người chơi, ghi lịch sử, rồi đưa bàn về trạng thái chờ ván mới.

### Gửi điểm trong 3 cây

Trong thời gian đặt cược, người không phải chương có thể gửi điểm sang người chơi khác:

- Nút `1x`: gửi một khoản bằng `min điểm x 1`.
- Nút `2x`: gửi một khoản bằng `min điểm x 2`.
- Không được gửi sang chương.
- Không được gửi sang chính mình.
- Có thể gửi nhiều lần nếu muốn ghi nhiều khoản riêng.

Khoản gửi không chuyển điểm trực tiếp cho người nhận. Khoản gửi đi theo kết quả của người nhận khi chương chốt ván.

Ví dụ:

- Bàn có min điểm là 10.
- A bấm `2x` gửi theo B, khoản gửi là 20 điểm.
- Nếu chương chốt B thắng x3, B được cộng tiền cược x3 từ chương, đồng thời A cũng được cộng `20 x 3 = 60` điểm từ chương.
- Nếu chương chốt B thua x3, B bị trừ tiền cược x3 trả cho chương, đồng thời A cũng bị trừ `20 x 3 = 60` điểm trả cho chương.

Các khoản gửi đang chờ được hiển thị trong bàn chơi và được ghi lại trong lịch sử khi chốt ván.

## Dữ liệu 3 cây liên quan

- `entertainment_ba_cay_games`: thông tin bàn, trạng thái, min/max cược, chương và hạn đặt cược.
- `entertainment_ba_cay_participants`: người chơi, ghế, cược hiện tại và tổng điểm.
- `entertainment_ba_cay_actions`: lịch sử thao tác và kết quả.
- `entertainment_ba_cay_point_transfers`: các khoản gửi điểm 1x/2x theo từng ván.

## Kiểm tra nhanh

```bash
python -m py_compile app.py models.py schema.py
```
