-- Sửa dữ liệu một lần (4/10/2026), đội "Pickle ball TDH chiều chủ nhật" (team 10). Admin sửa khoản chi tháng 9
-- ("tien Giai mini va nuoc" 1.008.000 → 995.000) để tháng 9 hết −13k, nhưng thêm/xoá khoản chi hồi đó không
-- chốt lại tháng nên dư đầu tháng 10 vẫn −13k (code đã sửa: TeamExpenseService gọi ensureMonth/recompute).
-- Tính lại dư tháng 9 theo đúng công thức previousMonthBalance, ghi sang tháng 10, rồi chia lại phí tháng 10
-- nếu đang AUTO. Chỉ chạy khi tháng 10 còn đúng số cũ −13.000; DB khác không có dòng này thì không làm gì.
DO $$
DECLARE
  sept_fixed integer;
  oct_fixed integer;
  sept_balance numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "team_month_fund" WHERE "team_id" = 10 AND "fund_month" = DATE '2026-10-01' AND "previous_balance" = -13000) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO sept_fixed
  FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
  WHERE m."team_id" = 10 AND x."fund_month" = DATE '2026-09-01' AND COALESCE(x."member_type", m."member_type") = 'FIXED';

  SELECT f."previous_balance" + f."monthly_fee" * sept_fixed
    + COALESCE((SELECT SUM(x."paid_amount") FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
                WHERE m."team_id" = 10 AND x."fund_month" = f."fund_month" AND COALESCE(x."member_type", m."member_type") = 'GUEST' AND x."payment_status" = 'PAID'), 0)
    + COALESCE((SELECT SUM(r."amount") FROM "team_guest_receipt" r WHERE r."team_id" = 10 AND r."receipt_month" = f."fund_month"), 0)
    - f."court_cost"
    - COALESCE((SELECT SUM(e."amount") FROM "team_expense" e WHERE e."team_id" = 10 AND e."expense_month" = f."fund_month"), 0)
  INTO sept_balance
  FROM "team_month_fund" f
  WHERE f."team_id" = 10 AND f."fund_month" = DATE '2026-09-01';

  IF sept_balance IS NULL THEN
    RETURN;
  END IF;

  UPDATE "team_month_fund" SET "previous_balance" = sept_balance
  WHERE "team_id" = 10 AND "fund_month" = DATE '2026-10-01';

  SELECT COUNT(*) INTO oct_fixed
  FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
  WHERE m."team_id" = 10 AND x."fund_month" = DATE '2026-10-01' AND x."member_type" = 'FIXED';

  UPDATE "team_month_fund"
  SET "monthly_fee" = CASE
    WHEN oct_fixed > 0 AND ("court_cost" + "other_cost" - "previous_balance") > 0
      THEN CEIL(("court_cost" + "other_cost" - "previous_balance") / oct_fixed / 1000.0) * 1000
    ELSE 0
  END
  WHERE "team_id" = 10 AND "fund_month" = DATE '2026-10-01' AND "fee_mode" = 'AUTO';
END $$;
