-- Cho phép cấu hình giờ nhắc uống thuốc theo nếp sinh hoạt từng nhà.
-- Đặt ở người thân (không phải ở đơn thuốc) để dùng chung cho mọi đơn, khỏi khai lại.
-- Additive, an toàn: chỉ ADD COLUMN kèm DEFAULT đúng bằng mốc giờ đang dùng.

ALTER TABLE "med_patient"
  ADD COLUMN "dose_time_morning" VARCHAR(5) NOT NULL DEFAULT '07:00',
  ADD COLUMN "dose_time_noon" VARCHAR(5) NOT NULL DEFAULT '12:00',
  ADD COLUMN "dose_time_evening" VARCHAR(5) NOT NULL DEFAULT '19:00',
  ADD COLUMN "dose_time_bedtime" VARCHAR(5) NOT NULL DEFAULT '20:30';
