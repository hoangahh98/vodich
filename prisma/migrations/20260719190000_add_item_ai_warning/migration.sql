-- Cảnh báo an toàn của AI cho RIÊNG từng thuốc trong đơn (trùng hoạt chất, cùng nhóm
-- kháng sinh, tương tác với thuốc đang uống dở hoặc thuốc còn trong tủ).
-- Lưu theo từng dòng thuốc chứ không gộp vào aiSummary của cả đơn: cảnh báo gộp ở đầu
-- trang thì soát tới thuốc thứ 5 phải cuộn ngược lên đối chiếu, rất dễ bỏ sót.
-- Rỗng = không có gì đáng nói, màn hình im lặng.
ALTER TABLE "med_prescription_item" ADD COLUMN "ai_warn_level" VARCHAR(10) NOT NULL DEFAULT '';
ALTER TABLE "med_prescription_item" ADD COLUMN "ai_warn_note" TEXT NOT NULL DEFAULT '';
