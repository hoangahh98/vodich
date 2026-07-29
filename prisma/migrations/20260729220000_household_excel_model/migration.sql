-- Module Quản Lý Chi Tiêu: dựng lại đúng theo bảng tính chiphi.xlsx của chủ nhà.
--
-- Mô hình cũ (ví tiền tuần/tháng cho từng thành viên + "khoản trích tay" gộp chung) được
-- thay bằng 5 phần tách bạch: Thu · Tiết kiệm · Trả nợ · Chi phí cố định · Chi phí phát sinh.
-- Chủ sổ đã chốt XOÁ dữ liệu cũ (28/7/2026 hỏi trước khi làm), nên 3 bảng của mô hình cũ
-- bị bỏ hẳn. Bảng `household_income` giữ nguyên vì phần "Thu" không đổi.

-- ─── 1. Bỏ mô hình ví tiền tuần cũ ───
DROP TABLE IF EXISTS "household_txn";
DROP TABLE IF EXISTS "household_member";
DROP TABLE IF EXISTS "household_allocation";

-- ─── 2. Cấu hình: mức tiêu tuần/người → mức SINH HOẠT tuần của khoản chi cố định kiểu tuần ───
ALTER TABLE "household_config" RENAME COLUMN "weekly_allowance" TO "weekly_rate";

-- ─── 3. Tiết kiệm ───
CREATE TABLE "household_fund" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'accumulate',
    "monthly_amount" BIGINT NOT NULL DEFAULT 0,
    "start_month" VARCHAR(7) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_fund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_fund_household_id_idx" ON "household_fund"("household_id");
ALTER TABLE "household_fund"
  ADD CONSTRAINT "household_fund_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_fund_entry" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "fund_id" BIGINT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "occurred_at" DATE NOT NULL,
    "direction" VARCHAR(3) NOT NULL DEFAULT 'out',
    "amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_fund_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_fund_entry_household_id_month_idx" ON "household_fund_entry"("household_id", "month");
CREATE INDEX "household_fund_entry_fund_id_idx" ON "household_fund_entry"("fund_id");
ALTER TABLE "household_fund_entry"
  ADD CONSTRAINT "household_fund_entry_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_fund_entry"
  ADD CONSTRAINT "household_fund_entry_fund_id_fkey"
  FOREIGN KEY ("fund_id") REFERENCES "household_fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. Trả nợ ───
CREATE TABLE "household_debt" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "initial_amount" BIGINT NOT NULL DEFAULT 0,
    "start_month" VARCHAR(7) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_debt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_debt_household_id_idx" ON "household_debt"("household_id");
ALTER TABLE "household_debt"
  ADD CONSTRAINT "household_debt_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_debt_payment" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "debt_id" BIGINT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "principal" BIGINT NOT NULL DEFAULT 0,
    "interest" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_debt_payment_pkey" PRIMARY KEY ("id")
);
-- Mỗi khoản nợ chỉ một dòng mỗi tháng: sửa là ghi đè, không bao giờ cộng trùng gốc/lãi.
CREATE UNIQUE INDEX "household_debt_payment_debt_id_month_key" ON "household_debt_payment"("debt_id", "month");
CREATE INDEX "household_debt_payment_household_id_month_idx" ON "household_debt_payment"("household_id", "month");
ALTER TABLE "household_debt_payment"
  ADD CONSTRAINT "household_debt_payment_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_debt_payment"
  ADD CONSTRAINT "household_debt_payment_debt_id_fkey"
  FOREIGN KEY ("debt_id") REFERENCES "household_debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 5. Chi phí cố định ───
CREATE TABLE "household_fixed_cost" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'once',
    "cap_amount" BIGINT NOT NULL DEFAULT 0,
    "weekly_rate" BIGINT,
    "start_month" VARCHAR(7) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_fixed_cost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_fixed_cost_household_id_idx" ON "household_fixed_cost"("household_id");
ALTER TABLE "household_fixed_cost"
  ADD CONSTRAINT "household_fixed_cost_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_fixed_spend" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "cost_id" BIGINT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "occurred_at" DATE NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_fixed_spend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_fixed_spend_household_id_month_idx" ON "household_fixed_spend"("household_id", "month");
CREATE INDEX "household_fixed_spend_cost_id_idx" ON "household_fixed_spend"("cost_id");
ALTER TABLE "household_fixed_spend"
  ADD CONSTRAINT "household_fixed_spend_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_fixed_spend"
  ADD CONSTRAINT "household_fixed_spend_cost_id_fkey"
  FOREIGN KEY ("cost_id") REFERENCES "household_fixed_cost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 6. Chi phí phát sinh ───
CREATE TABLE "household_extra_cost" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "occurred_at" DATE NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "source" VARCHAR(8) NOT NULL DEFAULT 'new',
    "fixed_cost_id" BIGINT,
    "fund_id" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_extra_cost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_extra_cost_household_id_month_idx" ON "household_extra_cost"("household_id", "month");
ALTER TABLE "household_extra_cost"
  ADD CONSTRAINT "household_extra_cost_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_extra_cost"
  ADD CONSTRAINT "household_extra_cost_fixed_cost_id_fkey"
  FOREIGN KEY ("fixed_cost_id") REFERENCES "household_fixed_cost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "household_extra_cost"
  ADD CONSTRAINT "household_extra_cost_fund_id_fkey"
  FOREIGN KEY ("fund_id") REFERENCES "household_fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
