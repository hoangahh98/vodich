-- Thẻ thông đổi từ "cụm chung" sang QUAN HỆ CÓ HƯỚNG (chủ app 10/9/2026): giao dịch của thẻ A cũng
-- làm đổi hạn mức khả dụng của thẻ B mà A trỏ tới. Thẻ 4768 và 8867 mỗi thẻ hạn mức riêng nhưng đều
-- trỏ về 3065 (3065 ăn theo cả hai); hai thẻ thông nhau thì trỏ LẪN NHAU.
ALTER TABLE "household_source" ADD COLUMN IF NOT EXISTS "limit_shares_with" BIGINT;

-- Chuyển dữ liệu cụm cũ (`g<id thẻ gốc>`): thành viên trỏ về thẻ gốc.
UPDATE "household_source" s SET "limit_shares_with" = substring(s."limit_group" from 2)::bigint
WHERE s."limit_group" <> '' AND s."limit_group" <> ('g' || s.id::text);

-- Cụm chỉ có ĐÚNG HAI thẻ là hai thẻ thông nhau: thẻ gốc trỏ ngược lại thẻ kia.
UPDATE "household_source" s SET "limit_shares_with" = other.id
FROM "household_source" other
WHERE s."limit_group" <> '' AND s."limit_group" = ('g' || s.id::text)
  AND other."limit_group" = s."limit_group" AND other.id <> s.id
  AND (SELECT count(*) FROM "household_source" x WHERE x."limit_group" = s."limit_group") = 2;

ALTER TABLE "household_source" DROP COLUMN IF EXISTS "limit_group";
