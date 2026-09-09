-- Số dư ngân hàng báo kèm giao dịch (mail Timo có "Số dư hiện tại") để so với số app tính.
ALTER TABLE "household_transaction" ADD COLUMN IF NOT EXISTS "reported_balance" DECIMAL(14,2);
