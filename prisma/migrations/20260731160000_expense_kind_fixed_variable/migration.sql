-- Loại CHI PHÍ tách `normal` thành hai kiểu: `fixed` (cố định, tháng nào cũng phải trả) và
-- `variable` (phát sinh). Chỉ `fixed` mới được chép sang tháng sau.
--
-- Loại THU NHẬP giữ nguyên `normal` — bên đó không có gì để tách.
--
-- Dữ liệu cũ rơi về `variable`: đó là phía AN TOÀN. Đoán nhầm một khoản phát sinh thành cố
-- định thì nút "chép tháng trước" sẽ bịa ra một khoản chưa hề tiêu; đoán nhầm chiều ngược lại
-- thì cùng lắm là phải gõ tay, không sinh ra số sai.
UPDATE "household_expense_category" SET "kind" = 'variable' WHERE "kind" = 'normal';

ALTER TABLE "household_expense_category" ALTER COLUMN "kind" SET DEFAULT 'variable';

-- Nới cột: 'variable' dài đúng 8 ký tự, chạm sát trần VARCHAR(8) — thêm một kiểu dài hơn là
-- gãy. Nới varchar không phải rewrite bảng và tương thích cả hai chiều nên làm luôn cho rảnh.
ALTER TABLE "household_expense_category" ALTER COLUMN "kind" TYPE VARCHAR(12);
