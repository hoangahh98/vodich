-- Chốt lịch uống thuốc: lưu ngày bắt đầu + cữ đầu tiên mà người dùng đã xác nhận.
-- Mục đích: máy khác lấy lịch về (hoặc lấy lại sau vài ngày) thì chỉ nạp phần liệu
-- trình CÒN LẠI tính từ hôm đó, không nạp lại những cữ đã uống xong.
-- Additive, an toàn: chỉ ADD COLUMN, đơn cũ có schedule_start = NULL (chưa chốt).

ALTER TABLE "med_prescription"
  ADD COLUMN "schedule_start" DATE,
  ADD COLUMN "schedule_slot" VARCHAR(10) NOT NULL DEFAULT '';
