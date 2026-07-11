-- Module y tế: bệnh nhân, đơn thuốc, thuốc trong đơn (additive, an toàn).
CREATE TABLE "med_patient" (
  "id" BIGSERIAL NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "birth_year" INTEGER,
  "gender" VARCHAR(20),
  "allergies" TEXT,
  "conditions" TEXT,
  "notes" TEXT,
  "owner_admin_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "med_patient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "med_prescription" (
  "id" BIGSERIAL NOT NULL,
  "patient_id" BIGINT NOT NULL,
  "prescribed_date" DATE,
  "doctor" VARCHAR(255) NOT NULL DEFAULT '',
  "clinic" VARCHAR(255) NOT NULL DEFAULT '',
  "diagnosis" TEXT NOT NULL DEFAULT '',
  "image_data" TEXT,
  "image_mime" VARCHAR(80),
  "ai_summary" TEXT,
  "ai_risk" VARCHAR(20),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "med_prescription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "med_prescription_item" (
  "id" BIGSERIAL NOT NULL,
  "prescription_id" BIGINT NOT NULL,
  "drug_name" VARCHAR(255) NOT NULL,
  "is_antibiotic" BOOLEAN NOT NULL DEFAULT false,
  "dosage" TEXT NOT NULL DEFAULT '',
  "frequency" TEXT NOT NULL DEFAULT '',
  "duration" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "med_prescription_item_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "med_prescription" ADD CONSTRAINT "med_prescription_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "med_patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "med_prescription_item" ADD CONSTRAINT "med_prescription_item_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "med_prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
