-- Một lần RÚT tiết kiệm giờ nói rõ rút từ MỤC nào (trỏ sang loại chi phí kiểu `saving`).
-- Cột để RỖNG được: dữ liệu cũ khai tay không có mục, và container CŨ trong lúc deploy vẫn
-- ghi được vì Prisma liệt kê cột tường minh chứ không SELECT *.
ALTER TABLE "household_income" ADD COLUMN "source_category_id" BIGINT;

CREATE INDEX "household_income_source_category_id_idx" ON "household_income"("source_category_id");

ALTER TABLE "household_income"
  ADD CONSTRAINT "household_income_source_category_id_fkey"
  FOREIGN KEY ("source_category_id") REFERENCES "household_expense_category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
