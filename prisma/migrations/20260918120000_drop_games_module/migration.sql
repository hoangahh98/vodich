-- Gỡ hẳn module Học vui (8 game ở /games). Chủ dự án chốt xoá cả dữ liệu (18/9/2026).
--
-- Bảy game kia không đụng DB; chỉ game "Hiệp Sĩ Toán Học" có hai bảng lưu nhân vật và tiến
-- trình từng ải của bé. Muốn lấy lại dữ liệu ấy thì phải checkout commit NGAY TRƯỚC commit gỡ
-- rồi chạy restore ở đó — schema mới không còn bảng để nạp vào (giống hệt lần gỡ ba module
-- Y tế / Chi tiêu / Du lịch ngày 3/8/2026, xem migration 20260803180000).
--
-- XOÁ BẢNG CON TRƯỚC BẢNG CHA, và KHÔNG dùng DROP ... CASCADE — cùng lý do đã ghi ở migration
-- 20260803180000: CASCADE che mất việc xoá nhầm thứ tự, còn xoá đúng thứ tự thì sót bảng con
-- nào Postgres chặn ngay bằng SQLSTATE 2BP01 thay vì âm thầm xoá lan.

DROP TABLE IF EXISTS "knight_progress";
DROP TABLE IF EXISTS "knight_character";
