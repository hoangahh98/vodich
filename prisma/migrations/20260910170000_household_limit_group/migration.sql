-- Thẻ thông: các thẻ tín dụng dùng chung một hạn mức mang cùng mã nhóm (dạng `g<id thẻ gốc>`).
-- Quẹt thẻ A thì hạn mức khả dụng của thẻ B trong nhóm cũng giảm — không có nhóm thì app tưởng lệch.
ALTER TABLE "household_source" ADD COLUMN IF NOT EXISTS "limit_group" VARCHAR(40) NOT NULL DEFAULT '';
