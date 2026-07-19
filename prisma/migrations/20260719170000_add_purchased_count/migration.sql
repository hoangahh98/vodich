-- Số lượng người dùng thật sự mua cho từng thuốc trong đơn. NULL = chưa quyết định.
-- Đơn cần 10, nhà còn 7: có người mua 3 cho vừa đủ, có người mua đủ 10 để còn dư.
-- Không suy ra được nên phải hỏi, và phải lưu để lần sửa sau còn biết chênh bao nhiêu.
ALTER TABLE "med_prescription_item" ADD COLUMN "purchased_count" INTEGER;
