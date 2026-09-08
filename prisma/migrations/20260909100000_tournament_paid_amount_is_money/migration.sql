-- Từ 9/2026 paid_amount là tiền THẬT đã thu (như quỹ đội bóng), trạng thái suy ra từ tiền so với lệ phí.
-- Trước đây dòng chưa đóng vẫn mang sẵn mức phí mặc định trong paid_amount → đưa về 0.
UPDATE "tournament_registration" SET "paid_amount" = 0 WHERE "payment_status" <> 'PAID';
