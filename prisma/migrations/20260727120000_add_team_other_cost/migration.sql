-- Các khoản tiền khác dự kiến trong tháng (nước, ăn uống, bóng...) bên cạnh tiền sân.
-- Chỉ dùng để gợi ý mức phí tháng / người và hiển thị chi tiết ô Tổng thu; KHÔNG trừ
-- vào quỹ còn lại (khoản chi thật đã nằm ở bảng team_expense, trừ hai lần sẽ sai quỹ).
ALTER TABLE "team_month_fund" ADD COLUMN "other_cost" DECIMAL(14,2) NOT NULL DEFAULT 0;
