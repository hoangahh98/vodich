-- Quỹ đội bóng: mỗi tháng là một ảnh chụp riêng.
--
-- 1) Loại thành viên (cố định / vãng lai) ghi vào dòng phí của TỪNG THÁNG. Trước đây chỉ có một cột
--    trên team_member nên đổi loại là đổi luôn quá khứ, và người rời đội thì biến mất khỏi cả các
--    tháng đã đóng tiền.
ALTER TABLE "team_member_payment" ADD COLUMN IF NOT EXISTS "member_type" VARCHAR(20);

-- 2) Chế độ tính phí của tháng: AUTO (tự chia đều theo số cố định) hoặc MANUAL (admin gõ).
ALTER TABLE "team_month_fund" ADD COLUMN IF NOT EXISTS "fee_mode" VARCHAR(10) NOT NULL DEFAULT 'AUTO';

-- 3) Dữ liệu cũ: tháng đã có số thì giữ nguyên số đó (MANUAL), loại lấy theo cột hiện tại của
--    thành viên. Người đã rời đội: dòng CHƯA đóng của họ bỏ đi (họ không nợ), dòng ĐÃ đóng giữ lại.
UPDATE "team_month_fund" SET "fee_mode" = 'MANUAL';
UPDATE "team_member_payment" p SET "member_type" = m."member_type"
FROM "team_member" m WHERE p."member_id" = m."id" AND p."member_type" IS NULL;
DELETE FROM "team_member_payment" p USING "team_member" m
WHERE p."member_id" = m."id" AND m."active" = FALSE AND p."payment_status" <> 'PAID';
