-- Hạn mức khả dụng của thẻ tín dụng mà mail MSB báo kèm mỗi giao dịch. Chỉ để hiện lên thẻ và
-- để bắt lệch khi sổ thiếu giao dịch — mail không có hạn mức TỔNG nên app không suy ra dư nợ từ đây.
ALTER TABLE "household_transaction" ADD COLUMN IF NOT EXISTS "reported_available" DECIMAL(14,2);
