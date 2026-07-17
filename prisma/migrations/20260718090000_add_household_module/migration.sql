-- Module quản lý chi tiêu (household): quét email VPBank, ngân sách tuần, tiết kiệm tháng.
-- Additive, an toàn: chỉ tạo bảng mới.

CREATE TABLE "household_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "weekly_budget" BIGINT NOT NULL DEFAULT 0,
  "monthly_savings" BIGINT NOT NULL DEFAULT 0,
  "week_start_dow" INTEGER NOT NULL DEFAULT 1,
  "anchor_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "household_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "household_account" (
  "id" BIGSERIAL NOT NULL,
  "account_number" VARCHAR(40) NOT NULL,
  "owner_label" VARCHAR(80) NOT NULL,
  "kind" VARCHAR(20) NOT NULL DEFAULT 'spending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "household_account_account_number_key" ON "household_account"("account_number");

CREATE TABLE "household_txn" (
  "id" BIGSERIAL NOT NULL,
  "txn_code" VARCHAR(160) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "performed_by" VARCHAR(255) NOT NULL DEFAULT '',
  "debit_account" VARCHAR(40) NOT NULL DEFAULT '',
  "credit_account" VARCHAR(40) NOT NULL DEFAULT '',
  "beneficiary" VARCHAR(255) NOT NULL DEFAULT '',
  "amount" BIGINT NOT NULL DEFAULT 0,
  "fee" BIGINT NOT NULL DEFAULT 0,
  "description" TEXT NOT NULL DEFAULT '',
  "category" VARCHAR(20) NOT NULL DEFAULT 'spending',
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_txn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "household_txn_txn_code_key" ON "household_txn"("txn_code");
CREATE INDEX "household_txn_occurred_at_idx" ON "household_txn"("occurred_at");

CREATE TABLE "household_savings_entry" (
  "id" BIGSERIAL NOT NULL,
  "kind" VARCHAR(20) NOT NULL DEFAULT 'topup',
  "amount" BIGINT NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "needs_note" BOOLEAN NOT NULL DEFAULT false,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_savings_entry_pkey" PRIMARY KEY ("id")
);
