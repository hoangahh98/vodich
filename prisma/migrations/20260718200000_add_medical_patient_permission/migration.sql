-- Phân quyền xem hồ sơ y tế theo từng người thân.
-- Trước đây owner_admin_id có ghi nhưng KHÔNG hề dùng để lọc, nên bất kỳ admin nào có
-- quyền tính năng MEDICAL đều xem được bệnh án gia đình người khác. Bảng này cùng mẫu
-- với travel_trip_permission / team_club_permission.

CREATE TABLE "med_patient_permission" (
  "id" BIGSERIAL NOT NULL,
  "patient_id" BIGINT NOT NULL,
  "admin_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "med_patient_permission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "med_patient_permission_patient_id_admin_id_key"
  ON "med_patient_permission"("patient_id", "admin_id");

ALTER TABLE "med_patient_permission"
  ADD CONSTRAINT "med_patient_permission_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "med_patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "med_patient_permission"
  ADD CONSTRAINT "med_patient_permission_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hồ sơ cũ chưa có chủ (tạo trước khi có cột owner) sẽ không ai xem được qua bộ lọc mới.
-- Gán về admin gốc để không mất dữ liệu; admin gốc tự cấp quyền lại cho người khác.
UPDATE "med_patient"
SET "owner_admin_id" = (SELECT MIN("id") FROM "app_user" WHERE "role" = 'ADMIN')
WHERE "owner_admin_id" IS NULL;
