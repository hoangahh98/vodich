-- Số ngày dùng thuốc phải là số thực, không phải số nguyên.
-- Đơn hay cấp theo số lượng chứ không theo ngày: Budesonid 5 ống, khí dung ngày 2 lần
-- = 2,5 ngày. Để INTEGER thì 2,5 bị làm tròn -> sai số liều.
-- Thêm quantity_count để suy ra số ngày khi đơn không ghi (5 ống / 2 lần = 2,5 ngày).

ALTER TABLE "med_prescription_item"
  ALTER COLUMN "days" TYPE DOUBLE PRECISION;

ALTER TABLE "med_prescription_item"
  ADD COLUMN "quantity_count" INTEGER NOT NULL DEFAULT 0;
