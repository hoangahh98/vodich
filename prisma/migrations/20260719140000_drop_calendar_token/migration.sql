-- Gỡ feed lịch đăng ký: quay về cơ chế thủ công (nạp nhóm lịch mới, xoá tay nhóm cũ).
--
-- Xoá cột chứ không để lại như ics_dose_count: cột này chứa TOKEN BÍ MẬT thay cho mật khẩu
-- vào lịch thuốc. Để lại một bí mật không ai dùng tới là rủi ro không đổi lấy gì.
DROP INDEX IF EXISTS "med_patient_calendar_token_key";
ALTER TABLE "med_patient" DROP COLUMN IF EXISTS "calendar_token";
