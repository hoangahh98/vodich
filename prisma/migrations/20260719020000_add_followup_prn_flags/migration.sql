-- Ba bổ sung cho lịch nhắc:
-- 1) follow_up_date: ngày tái khám ghi trong đơn, để sinh thêm lời nhắc sáng hôm đó.
-- 2) as_needed: thuốc dùng KHI CẦN (hạ sốt khi sốt, khí dung khi khó thở). Nhắc đều đặn
--    loại này là sai, nên không lên lịch — nhưng vẫn đếm vào tủ thuốc.
-- 3) days_from_quantity: đánh dấu số ngày được SUY RA từ số lượng chứ không phải đơn
--    ghi. Khi đó số ngày và số lượng khớp theo định nghĩa nên không được cảnh báo lệch.
-- Additive, an toàn: chỉ ADD COLUMN.

ALTER TABLE "med_prescription"
  ADD COLUMN "follow_up_date" DATE;

ALTER TABLE "med_prescription_item"
  ADD COLUMN "as_needed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "days_from_quantity" BOOLEAN NOT NULL DEFAULT false;
