-- Module Chi tiêu gia đình (9/2026). Dựng lại từ đầu với lõi nhỏ: hộ, nguồn tiền, mục đích, giao
-- dịch, khoản định kỳ, hộp thư Telegram. Bảng cũ household_* đã bị gỡ ngày 3/8/2026 nên không có
-- gì phải chuyển đổi. Tạo bảng cha trước, bảng con sau; không CASCADE ở DROP (không có DROP).

CREATE TABLE IF NOT EXISTS "household" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "owner_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "telegram_chat_id" VARCHAR(40),
  "telegram_link_code" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "household_permission" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "admin_id" BIGINT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_permission_household_id_admin_id_key" UNIQUE ("household_id", "admin_id")
);

CREATE TABLE IF NOT EXISTS "player_household_access" (
  "id" BIGSERIAL PRIMARY KEY,
  "player_id" BIGINT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "granted_by_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_household_access_player_id_household_id_key" UNIQUE ("player_id", "household_id")
);
CREATE INDEX IF NOT EXISTS "player_household_access_household_id_idx" ON "player_household_access"("household_id");

CREATE TABLE IF NOT EXISTS "household_source" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(12) NOT NULL DEFAULT 'BANK',
  "bank" VARCHAR(20) NOT NULL DEFAULT '',
  "match_key" VARCHAR(40) NOT NULL DEFAULT '',
  "owner_name" VARCHAR(120) NOT NULL DEFAULT '',
  "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "credit_limit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "interest_rate" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "statement_day" INTEGER NOT NULL DEFAULT 0,
  "due_day" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "household_source_household_id_idx" ON "household_source"("household_id");

CREATE TABLE IF NOT EXISTS "household_purpose" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(12) NOT NULL DEFAULT 'LIVING',
  "monthly_plan" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "household_purpose_household_id_idx" ON "household_purpose"("household_id");

CREATE TABLE IF NOT EXISTS "household_recurring" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(10) NOT NULL DEFAULT 'EXPENSE',
  "source_id" BIGINT REFERENCES "household_source"("id") ON DELETE SET NULL,
  "target_source_id" BIGINT REFERENCES "household_source"("id") ON DELETE SET NULL,
  "purpose_id" BIGINT REFERENCES "household_purpose"("id") ON DELETE SET NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "interest_mode" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  "day_of_month" INTEGER NOT NULL DEFAULT 1,
  "start_month" VARCHAR(7) NOT NULL,
  "end_month" VARCHAR(7),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "household_recurring_household_id_idx" ON "household_recurring"("household_id");

CREATE TABLE IF NOT EXISTS "household_transaction" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "kind" VARCHAR(10) NOT NULL DEFAULT 'EXPENSE',
  "source_id" BIGINT NOT NULL REFERENCES "household_source"("id") ON DELETE CASCADE,
  "target_source_id" BIGINT REFERENCES "household_source"("id") ON DELETE SET NULL,
  "purpose_id" BIGINT REFERENCES "household_purpose"("id") ON DELETE SET NULL,
  "recurring_id" BIGINT REFERENCES "household_recurring"("id") ON DELETE SET NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "month" VARCHAR(7) NOT NULL,
  "description" VARCHAR(255) NOT NULL DEFAULT '',
  "raw_text" TEXT,
  "external_id" VARCHAR(120),
  "status" VARCHAR(10) NOT NULL DEFAULT 'CONFIRMED',
  "telegram_chat_id" VARCHAR(40),
  "telegram_msg_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_transaction_household_id_external_id_key" UNIQUE ("household_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "household_transaction_household_id_month_idx" ON "household_transaction"("household_id", "month");
CREATE INDEX IF NOT EXISTS "household_transaction_source_id_idx" ON "household_transaction"("source_id");

CREATE TABLE IF NOT EXISTS "household_inbox" (
  "id" BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT REFERENCES "household"("id") ON DELETE CASCADE,
  "chat_id" VARCHAR(40) NOT NULL,
  "message_id" BIGINT NOT NULL,
  "text" TEXT NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'UNPARSED',
  "transaction_id" BIGINT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_inbox_chat_id_message_id_key" UNIQUE ("chat_id", "message_id")
);
CREATE INDEX IF NOT EXISTS "household_inbox_household_id_status_idx" ON "household_inbox"("household_id", "status");
