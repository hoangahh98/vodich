-- Module chi tiêu: bỏ hoàn toàn phần quét email VPBank, chuyển sang sổ nhập tay.
-- Các bảng cũ (giao dịch quét từ email, tài khoản ngân hàng, sổ tiết kiệm tự bù)
-- không còn ý nghĩa trong mô hình mới nên xoá hẳn thay vì cố chuyển đổi.
DROP TABLE IF EXISTS "household_savings_entry";
DROP TABLE IF EXISTS "household_account";
DROP TABLE IF EXISTS "household_txn";

-- Cấu hình: thay ngân sách tuần / tiết kiệm tháng bằng mức tiền tiêu tuần mỗi người.
ALTER TABLE "household_config" DROP COLUMN IF EXISTS "weekly_budget";
ALTER TABLE "household_config" DROP COLUMN IF EXISTS "monthly_savings";
ALTER TABLE "household_config" ADD COLUMN IF NOT EXISTS "weekly_allowance" BIGINT NOT NULL DEFAULT 500000;

-- Người được phát tiền tiêu. cycle = weekly (nhận mỗi tuần) | monthly (con, nhận mỗi tháng).
CREATE TABLE "household_member" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "cycle" VARCHAR(10) NOT NULL DEFAULT 'weekly',
    "allowance" BIGINT,
    "started_on" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_member_pkey" PRIMARY KEY ("id")
);

-- Tiền vào quỹ chung theo tháng (lương, thưởng...).
CREATE TABLE "household_income" (
    "id" BIGSERIAL NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_income_pkey" PRIMARY KEY ("id")
);

-- Khoản trích ra khỏi quỹ chung mỗi tháng (tiết kiệm, trả nợ, khác).
CREATE TABLE "household_allocation" (
    "id" BIGSERIAL NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'other',
    "name" VARCHAR(80) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_allocation_pkey" PRIMARY KEY ("id")
);

-- Khoản chi thực tế: member_id NULL = chi chung (trừ quỹ chung).
CREATE TABLE "household_txn" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "member_id" BIGINT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_txn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "household_income_month_idx" ON "household_income"("month");
CREATE INDEX "household_allocation_month_idx" ON "household_allocation"("month");
CREATE INDEX "household_txn_occurred_at_idx" ON "household_txn"("occurred_at");
CREATE INDEX "household_txn_member_id_idx" ON "household_txn"("member_id");

ALTER TABLE "household_txn" ADD CONSTRAINT "household_txn_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "household_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
