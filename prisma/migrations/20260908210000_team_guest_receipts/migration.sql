-- Khoản thu vãng lai của đội bóng: mỗi lần người ngoài đến chơi là một dòng (ngày + số tiền),
-- không còn nhét vào dòng phí tháng của thành viên. Thành viên đội giờ đi theo nhóm (toàn cố định).
CREATE TABLE IF NOT EXISTS "team_guest_receipt" (
  "id" BIGSERIAL PRIMARY KEY,
  "team_id" BIGINT NOT NULL REFERENCES "team_club"("id") ON DELETE CASCADE,
  "player_id" BIGINT REFERENCES "player"("id") ON DELETE SET NULL,
  "guest_name" VARCHAR(255),
  "receipt_month" DATE NOT NULL,
  "receipt_date" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "team_guest_receipt_team_month_idx" ON "team_guest_receipt"("team_id", "receipt_month");

-- Bỏ ô tích "đã thu": cột paid_amount từ nay là tiền THẬT đã thu. Dòng chưa thu trước đây chứa mức phí
-- mặc định để tiện gõ, nay phải về 0 kẻo bị coi là đã đóng.
UPDATE "team_member_payment" SET "paid_amount" = 0 WHERE "payment_status" <> 'PAID';
