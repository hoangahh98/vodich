-- Đánh dấu đơn cũ đã bị dừng khi có đơn mới thay thế.
-- Cố ý KHÔNG xoá schedule_start: vẫn cần dựng lại đúng các cữ đã từng xuất ra iPhone
-- để file .ics của đơn mới gửi kèm lệnh huỷ chúng.
-- Additive, an toàn: chỉ ADD COLUMN kèm DEFAULT.

ALTER TABLE "med_prescription"
  ADD COLUMN "schedule_stopped" BOOLEAN NOT NULL DEFAULT false;
