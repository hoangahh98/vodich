-- Gỡ hẳn module Chi tiêu gia đình (chủ app chốt 30/9/2026). Đây là lần gỡ THỨ HAI của module này
-- (lần đầu 3/8/2026, migration 20260803180000; dựng lại 9/2026 rồi lại gỡ).
--
-- Dữ liệu đã xuất ra Excel (backups/chi-tieu-xuat-2026-09-30.xlsx, không commit) ngay trước khi gỡ,
-- và backup hằng đêm (BACKUP_KEEP=30) còn giữ đủ 9 bảng. Muốn nạp lại thì phải checkout commit NGAY
-- TRƯỚC commit gỡ rồi restore ở đó — schema mới không còn bảng để nạp vào.
--
-- XOÁ BẢNG CON TRƯỚC BẢNG CHA, KHÔNG dùng DROP ... CASCADE (lý do ghi ở migration 20260803180000:
-- CASCADE che mất việc xoá nhầm thứ tự, xoá đúng thứ tự thì sót bảng con nào Postgres chặn bằng 2BP01).

DROP TABLE IF EXISTS "household_inbox";
DROP TABLE IF EXISTS "household_transaction";
DROP TABLE IF EXISTS "household_recurring";
DROP TABLE IF EXISTS "household_purpose";
DROP TABLE IF EXISTS "household_source";
DROP TABLE IF EXISTS "household_source_kind";
DROP TABLE IF EXISTS "player_household_access";
DROP TABLE IF EXISTS "household_permission";
DROP TABLE IF EXISTS "household";

-- Quyền module của admin phụ: dòng HOUSEHOLD không còn nghĩa, xoá để trang Phân quyền không hiện tính năng ma.
DELETE FROM "admin_feature_permission" WHERE "feature" = 'HOUSEHOLD';
