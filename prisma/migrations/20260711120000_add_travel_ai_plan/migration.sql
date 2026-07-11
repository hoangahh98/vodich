-- Thêm nơi lưu kế hoạch/gợi ý AI cho từng chuyến đi (additive, an toàn).
ALTER TABLE "travel_trip" ADD COLUMN "ai_plan" TEXT;
ALTER TABLE "travel_trip" ADD COLUMN "ai_plan_at" TIMESTAMP(3);
