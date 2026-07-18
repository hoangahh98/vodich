-- Tủ thuốc gia đình: theo dõi thuốc còn tồn sau khi đổi đơn, để lần kê đơn sau biết
-- nhà còn bao nhiêu gói/viên. Chỉ dạng đếm được; chai/lọ/siro bỏ qua vì mở nắp rồi
-- thì hạn dùng phụ thuộc bảo quản, đếm tồn không có ý nghĩa.
-- Additive, an toàn: chỉ tạo bảng mới.

CREATE TABLE "med_cabinet_item" (
  "id" BIGSERIAL NOT NULL,
  "owner_admin_id" BIGINT NOT NULL,
  "drug_name" VARCHAR(255) NOT NULL,
  "match_key" VARCHAR(255) NOT NULL,
  "unit" VARCHAR(20) NOT NULL DEFAULT '',
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "purchased_at" DATE,
  "expiry_date" DATE,
  "ai_expiry_note" TEXT,
  "ai_expiry_risk" VARCHAR(20),
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "med_cabinet_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "med_cabinet_item_owner_admin_id_match_key_idx"
  ON "med_cabinet_item"("owner_admin_id", "match_key");
