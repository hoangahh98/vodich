-- Sửa dữ liệu một lần (4/10/2026), đội "Pickle ball TDH chiều chủ nhật" (team 10).
-- Ngày 28/9 diu (team_member 127) được thêm vào nhóm; app xếp luôn vào tháng 9 (lúc đó chưa chọn được tháng
-- bắt đầu) dù tháng 9 đã thu đủ 405k của 13 người → phí tháng 9 chia lại còn 377k cho 14 người. Diu không
-- đóng đồng nào tháng 9 và đã rời đội 3/10. Bỏ dòng tháng 9 của diu, chia lại phí tháng 9 cho 13 người
-- (cùng công thức suggestMonthlyFee), rồi ghi số dư tháng 9 sang dư đầu tháng 10 (cùng công thức
-- previousMonthBalance), và tháng 10 đang AUTO thì chia lại phí tháng 10 như recompute() tự lan. DB khác
-- (test/CI) không có các dòng này thì khối dưới không làm gì.
DO $$
DECLARE
  removed integer;
  fixed_count integer;
  sept_balance numeric;
BEGIN
  DELETE FROM "team_member_payment"
  WHERE "id" = 761 AND "member_id" = 127 AND "fund_month" = DATE '2026-09-01' AND "paid_amount" <= 0;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed = 0 THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO fixed_count
  FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
  WHERE m."team_id" = 10 AND x."fund_month" = DATE '2026-09-01' AND x."member_type" = 'FIXED';

  UPDATE "team_month_fund"
  SET "monthly_fee" = CASE
    WHEN fixed_count > 0 AND ("court_cost" + "other_cost" - "previous_balance") > 0
      THEN CEIL(("court_cost" + "other_cost" - "previous_balance") / fixed_count / 1000.0) * 1000
    ELSE 0
  END
  WHERE "team_id" = 10 AND "fund_month" = DATE '2026-09-01' AND "fee_mode" = 'AUTO';

  SELECT f."previous_balance" + f."monthly_fee" * fixed_count
    + COALESCE((SELECT SUM(x."paid_amount") FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
                WHERE m."team_id" = 10 AND x."fund_month" = f."fund_month" AND COALESCE(x."member_type", m."member_type") = 'GUEST' AND x."payment_status" = 'PAID'), 0)
    + COALESCE((SELECT SUM(r."amount") FROM "team_guest_receipt" r WHERE r."team_id" = 10 AND r."receipt_month" = f."fund_month"), 0)
    - f."court_cost"
    - COALESCE((SELECT SUM(e."amount") FROM "team_expense" e WHERE e."team_id" = 10 AND e."expense_month" = f."fund_month"), 0)
  INTO sept_balance
  FROM "team_month_fund" f
  WHERE f."team_id" = 10 AND f."fund_month" = DATE '2026-09-01';

  UPDATE "team_month_fund" SET "previous_balance" = sept_balance
  WHERE "team_id" = 10 AND "fund_month" = DATE '2026-10-01';

  SELECT COUNT(*) INTO fixed_count
  FROM "team_member_payment" x JOIN "team_member" m ON m."id" = x."member_id"
  WHERE m."team_id" = 10 AND x."fund_month" = DATE '2026-10-01' AND x."member_type" = 'FIXED';

  UPDATE "team_month_fund"
  SET "monthly_fee" = CASE
    WHEN fixed_count > 0 AND ("court_cost" + "other_cost" - "previous_balance") > 0
      THEN CEIL(("court_cost" + "other_cost" - "previous_balance") / fixed_count / 1000.0) * 1000
    ELSE 0
  END
  WHERE "team_id" = 10 AND "fund_month" = DATE '2026-10-01' AND "fee_mode" = 'AUTO';
END $$;
