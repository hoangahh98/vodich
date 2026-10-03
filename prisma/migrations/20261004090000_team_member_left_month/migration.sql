-- Tháng rời đội (4/10/2026). Luật chủ app chốt: đưa người ra khỏi nhóm thì ở tháng đó, ai ĐÃ ĐÓNG
-- tiền (paid_amount > 0) vẫn giữ dòng và tính bình thường; ai CHƯA ĐÓNG thì bỏ hẳn khỏi tháng, mức
-- phí chia lại cho người còn lại; các tháng sau mặc định không có người đó.
ALTER TABLE "team_member" ADD COLUMN IF NOT EXISTS "left_month" DATE;

-- Người đã rời trước khi có cột: lấy tháng có dòng phí muộn nhất (code cũ giữ dòng đã đóng của tháng
-- rời và xoá dòng chưa đóng từ tháng đó trở đi, nên tháng muộn nhất còn lại chính là tháng rời).
UPDATE "team_member" m
SET "left_month" = last_row.fund_month
FROM (SELECT "member_id", MAX("fund_month") AS fund_month FROM "team_member_payment" GROUP BY "member_id") last_row
WHERE last_row."member_id" = m."id" AND m."active" = false AND m."left_month" IS NULL;

-- Dòng 0đ của người đã rời, từ tháng rời trở đi: code cũ giữ dòng theo cờ PAID, nên dòng đã đóng rồi
-- được hoàn tiền (sửa về 0) vẫn nằm lại và vẫn bị đếm vào số người chia phí. Bỏ đi.
CREATE TEMP TABLE "_left_zero_rows" AS
SELECT p."id", m."team_id", p."fund_month"
FROM "team_member_payment" p
JOIN "team_member" m ON m."id" = p."member_id"
WHERE m."active" = false AND m."left_month" IS NOT NULL AND p."fund_month" >= m."left_month" AND p."paid_amount" <= 0;

DELETE FROM "team_member_payment" WHERE "id" IN (SELECT "id" FROM "_left_zero_rows");

-- Chia lại mức phí của các tháng AUTO vừa bớt người — cùng công thức suggestMonthlyFee
-- (team-month-report.ts): (tiền sân + tiền khác − dư tháng trước) ÷ số cố định, làm tròn lên nghìn.
-- Số dư mang sang tháng kế tiếp sẽ được app lan lại ở lần ghi kế tiếp lên tháng đó (recompute).
UPDATE "team_month_fund" f
SET "monthly_fee" = CASE
  WHEN c.fixed_count > 0 AND (f."court_cost" + f."other_cost" - f."previous_balance") > 0
    THEN CEIL((f."court_cost" + f."other_cost" - f."previous_balance") / c.fixed_count / 1000.0) * 1000
  ELSE 0
END
FROM (
  SELECT a."team_id", a."fund_month", (
    SELECT COUNT(*) FROM "team_member_payment" x
    JOIN "team_member" mm ON mm."id" = x."member_id"
    WHERE mm."team_id" = a."team_id" AND x."fund_month" = a."fund_month" AND x."member_type" = 'FIXED'
  ) AS fixed_count
  FROM (SELECT DISTINCT "team_id", "fund_month" FROM "_left_zero_rows") a
) c
WHERE f."team_id" = c."team_id" AND f."fund_month" = c."fund_month" AND f."fee_mode" = 'AUTO';

DROP TABLE "_left_zero_rows";
