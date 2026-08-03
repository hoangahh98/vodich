-- Gỡ hẳn ba module: Y tế, Chi tiêu, Du lịch. Chủ dự án chốt xoá cả dữ liệu (3/8/2026).
--
-- Bản backup cuối trước khi gỡ: backups/backup-2026-08-03T10-57-59-769Z.json (11.251 dòng,
-- đã diễn tập khôi phục thành công trên schema nháp Supabase cùng ngày). Muốn lấy lại dữ liệu
-- của ba module này thì phải checkout commit NGAY TRƯỚC commit gỡ rồi chạy restore ở đó —
-- schema mới không còn bảng để nạp vào.
--
-- XOÁ BẢNG CON TRƯỚC BẢNG CHA, và KHÔNG dùng DROP ... CASCADE.
-- Lý do (bài học migration 20260731120000, gãy thật trên Render ngày 31/7/2026): CASCADE che
-- mất việc mình xoá nhầm thứ tự — nó lẳng lặng kéo theo cả những thứ ngoài dự tính. Còn xoá
-- đúng thứ tự thì nếu danh sách này sót một bảng con nào, Postgres chặn lại ngay bằng
-- SQLSTATE 2BP01 thay vì âm thầm xoá lan.

-- ── Y tế ──────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "med_prescription_item";
DROP TABLE IF EXISTS "med_prescription";
DROP TABLE IF EXISTS "med_cabinet_item";
DROP TABLE IF EXISTS "med_patient_permission";
DROP TABLE IF EXISTS "med_patient";

-- ── Chi tiêu ──────────────────────────────────────────────────────────────
-- Khoản thu/chi trỏ vào loại + sổ nợ, nên xoá chúng trước; config là gốc nên xoá sau cùng.
DROP TABLE IF EXISTS "household_income";
DROP TABLE IF EXISTS "household_expense";
DROP TABLE IF EXISTS "household_chat_message";
DROP TABLE IF EXISTS "household_debt";
DROP TABLE IF EXISTS "household_income_category";
DROP TABLE IF EXISTS "household_expense_category";
DROP TABLE IF EXISTS "household_permission";
DROP TABLE IF EXISTS "household_config";

-- ── Du lịch ───────────────────────────────────────────────────────────────
-- travel_trip <-> travel_trip_member có khoá vòng (thủ quỹ), nên phải gỡ ràng buộc thủ quỹ
-- trước rồi mới xoá được hai bảng đó theo thứ tự thường.
ALTER TABLE "travel_trip" DROP CONSTRAINT IF EXISTS "travel_trip_treasurer_member_id_fkey";
DROP TABLE IF EXISTS "travel_trip_expense_split";
DROP TABLE IF EXISTS "travel_trip_expense";
DROP TABLE IF EXISTS "travel_trip_collection";
DROP TABLE IF EXISTS "travel_trip_permission";
DROP TABLE IF EXISTS "travel_trip_member";
DROP TABLE IF EXISTS "travel_trip";
DROP TABLE IF EXISTS "travel_suggestion";
DROP TABLE IF EXISTS "travel_person";
DROP TABLE IF EXISTS "travel_destination";

-- ── Quyền của ba module: gỡ khỏi bảng phân quyền admin ────────────────────
-- Không xoá thì admin nào từng được cấp vẫn còn dòng quyền trỏ tới feature không còn tồn tại.
DELETE FROM "admin_feature_permission" WHERE "feature" IN ('MEDICAL', 'HOUSEHOLD', 'TRAVEL');
