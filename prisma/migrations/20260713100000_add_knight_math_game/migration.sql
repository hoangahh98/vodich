-- Game "Hiệp Sĩ Toán Học": hồ sơ nhân vật + tiến trình từng ải (additive, an toàn).
CREATE TABLE "knight_character" (
  "id" BIGSERIAL NOT NULL,
  "owner_user_id" BIGINT NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "gender" VARCHAR(10) NOT NULL DEFAULT 'boy',
  "age" INTEGER NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "current_stage" INTEGER NOT NULL DEFAULT 1,
  "hp" INTEGER NOT NULL DEFAULT 10,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knight_character_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knight_progress" (
  "id" BIGSERIAL NOT NULL,
  "character_id" BIGINT NOT NULL,
  "stage_number" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'CLEARED',
  "stars" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knight_progress_pkey" PRIMARY KEY ("id")
);

-- Tra cứu tiến trình bằng khoá chính xác (character + ải), không lọc theo khoảng.
CREATE UNIQUE INDEX "knight_progress_character_id_stage_number_key" ON "knight_progress"("character_id", "stage_number");
CREATE INDEX "knight_character_owner_user_id_idx" ON "knight_character"("owner_user_id");

ALTER TABLE "knight_character" ADD CONSTRAINT "knight_character_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knight_progress" ADD CONSTRAINT "knight_progress_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "knight_character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
