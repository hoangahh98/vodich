-- Khoản chi CỐ ĐỊNH có hai con số: mức DỰ KIẾN (sizing) và tiền ĐÃ CHI thật.
--
-- `amount` giữ nguyên nghĩa "tiền đã chi thật" nên mọi công thức cũ không đổi một chữ;
-- thêm `planned_amount` để màn hình đối chiếu được "dự kiến 2tr · đã chi 1tr5".
--
-- Thêm cột (có DEFAULT) là thay đổi TƯƠNG THÍCH HAI CHIỀU: trong lúc deploy, container cũ
-- không biết cột này vẫn chạy bình thường, còn container mới ghi thì cột đã sẵn sàng.
-- Đây là cách tránh cửa sổ "code cũ gặp schema mới" từng làm cả module 500 hôm 31/7/2026.
ALTER TABLE "household_expense" ADD COLUMN "planned_amount" BIGINT NOT NULL DEFAULT 0;
