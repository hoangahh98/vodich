-- Quy tắc ghép cặp đôi cho một giải: 'BY_SKILL' (cân bằng theo trình, hành vi cũ) hoặc
-- 'RANDOM' (bỏ qua trình, xáo thuần).
--
-- DEFAULT 'BY_SKILL' là bắt buộc chứ không phải cho tiện: mọi giải đã tạo trước migration này
-- đều được bốc theo trình, đặt mặc định khác đi là lặng lẽ đổi cách sinh lịch của giải cũ.
ALTER TABLE "tournament" ADD COLUMN "pairing_rule" VARCHAR(20) NOT NULL DEFAULT 'BY_SKILL';
