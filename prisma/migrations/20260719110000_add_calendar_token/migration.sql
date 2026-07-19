-- Token bí mật cho feed lịch đăng ký (/lich/<token>.ics).
-- Nullable: hồ sơ cũ chưa có token, cấp khi người dùng bấm tạo liên kết.
ALTER TABLE "med_patient" ADD COLUMN "calendar_token" VARCHAR(64);

-- UNIQUE để tra token -> hồ sơ chỉ một kết quả, và chặn trùng khi sinh lại.
-- Postgres cho phép nhiều NULL trong cột UNIQUE nên hồ sơ chưa cấp token không xung đột.
CREATE UNIQUE INDEX "med_patient_calendar_token_key" ON "med_patient"("calendar_token");
