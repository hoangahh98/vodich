ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "group_count" INTEGER;
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "advance_per_group" INTEGER;
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "has_third_place" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "wildcard_teams" TEXT;
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "semi_draw_method" VARCHAR(20) DEFAULT 'FIXED';
