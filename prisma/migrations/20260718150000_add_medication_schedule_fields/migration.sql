-- Lên lịch nhắc uống thuốc: bổ sung các trường định lượng cho từng thuốc trong đơn.
-- Additive, an toàn: chỉ ADD COLUMN kèm DEFAULT nên đơn cũ giữ nguyên dữ liệu.
-- Đơn cũ có times_per_day = 0 -> màn hình lịch sẽ hỏi người dùng điền lại, không đoán bừa.

ALTER TABLE "med_prescription_item"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "times_per_day" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quantity" VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN "route" VARCHAR(20) NOT NULL DEFAULT '',
  ADD COLUMN "timing" VARCHAR(20) NOT NULL DEFAULT '';
