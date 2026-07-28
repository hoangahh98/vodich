-- Module Quản Lý Chi Tiêu: thêm CHỦ SỞ HỮU + PHÂN QUYỀN, giống giải đấu / đội bóng.
--
-- Trước đây household_config là singleton id = 1 và các bảng con không có cột chủ,
-- nên mọi admin được cấp feature HOUSEHOLD đều đọc chung một sổ. Migration này biến
-- household_config thành GỐC PHÂN QUYỀN ("sổ chi tiêu") và cho mọi bảng con trỏ về nó.
--
-- Dữ liệu cũ được giữ nguyên: gom hết vào sổ sẵn có (hoặc sổ id = 1 tạo mới nếu chưa
-- có dòng nào), chủ sổ gán cho admin có id nhỏ nhất — chính là admin gốc do
-- AuthService.onModuleInit tạo ra đầu tiên.

-- ─── 1. Đảm bảo tồn tại đúng một sổ để gắn dữ liệu cũ vào ───
INSERT INTO "household_config" ("id", "updated_at")
SELECT 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "household_config");

-- ─── 2. id: từ hằng số 1 sang chuỗi tăng tự động (nhiều sổ) ───
ALTER TABLE "household_config" ALTER COLUMN "id" DROP DEFAULT;
CREATE SEQUENCE IF NOT EXISTS "household_config_id_seq" AS INTEGER OWNED BY "household_config"."id";
SELECT setval('household_config_id_seq', GREATEST(COALESCE((SELECT MAX("id") FROM "household_config"), 0), 1), true);
ALTER TABLE "household_config" ALTER COLUMN "id" SET DEFAULT nextval('household_config_id_seq');
ALTER TABLE "household_config" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- ─── 3. Chủ sở hữu ───
ALTER TABLE "household_config" ADD COLUMN IF NOT EXISTS "owner_admin_id" BIGINT;
ALTER TABLE "household_config" ADD COLUMN IF NOT EXISTS "name" VARCHAR(120) NOT NULL DEFAULT 'Sổ chi tiêu gia đình';

UPDATE "household_config"
SET "owner_admin_id" = (SELECT "id" FROM "app_user" WHERE "role" = 'ADMIN' ORDER BY "id" ASC LIMIT 1)
WHERE "owner_admin_id" IS NULL;

ALTER TABLE "household_config"
  ADD CONSTRAINT "household_config_owner_admin_id_fkey"
  FOREIGN KEY ("owner_admin_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "household_config_owner_admin_id_idx" ON "household_config"("owner_admin_id");

-- ─── 4. Bảng phân quyền ───
CREATE TABLE "household_permission" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "admin_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "household_permission_household_id_admin_id_key"
  ON "household_permission"("household_id", "admin_id");
ALTER TABLE "household_permission"
  ADD CONSTRAINT "household_permission_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_permission"
  ADD CONSTRAINT "household_permission_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 5. Bảng con trỏ về sổ ───
ALTER TABLE "household_member" ADD COLUMN "household_id" INTEGER;
ALTER TABLE "household_income" ADD COLUMN "household_id" INTEGER;
ALTER TABLE "household_allocation" ADD COLUMN "household_id" INTEGER;
ALTER TABLE "household_txn" ADD COLUMN "household_id" INTEGER;

UPDATE "household_member" SET "household_id" = (SELECT MIN("id") FROM "household_config") WHERE "household_id" IS NULL;
UPDATE "household_income" SET "household_id" = (SELECT MIN("id") FROM "household_config") WHERE "household_id" IS NULL;
UPDATE "household_allocation" SET "household_id" = (SELECT MIN("id") FROM "household_config") WHERE "household_id" IS NULL;
UPDATE "household_txn" SET "household_id" = (SELECT MIN("id") FROM "household_config") WHERE "household_id" IS NULL;

ALTER TABLE "household_member" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "household_income" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "household_allocation" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "household_txn" ALTER COLUMN "household_id" SET NOT NULL;

ALTER TABLE "household_member"
  ADD CONSTRAINT "household_member_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_income"
  ADD CONSTRAINT "household_income_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_allocation"
  ADD CONSTRAINT "household_allocation_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_txn"
  ADD CONSTRAINT "household_txn_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 6. Index: mọi truy vấn giờ luôn kèm household_id nên đánh index theo cặp ───
DROP INDEX IF EXISTS "household_income_month_idx";
DROP INDEX IF EXISTS "household_allocation_month_idx";
DROP INDEX IF EXISTS "household_txn_occurred_at_idx";

CREATE INDEX "household_member_household_id_idx" ON "household_member"("household_id");
CREATE INDEX "household_income_household_id_month_idx" ON "household_income"("household_id", "month");
CREATE INDEX "household_allocation_household_id_month_idx" ON "household_allocation"("household_id", "month");
CREATE INDEX "household_txn_household_id_occurred_at_idx" ON "household_txn"("household_id", "occurred_at");
