-- AlterTable
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "quarter_draw_method" VARCHAR(20) DEFAULT 'FIXED';
