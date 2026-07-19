-- Tồn kho tại đúng lúc khai quyết định mua.
-- Phải chụp lại vì ngay sau khi khai, tủ bị trừ phần đơn này dùng nên không dựng lại được.
-- Thiếu = đơn_cần - đã_mua - tồn_lúc_khai. Không có cột này thì cảnh báo thiếu tính sai.
ALTER TABLE "med_prescription_item" ADD COLUMN "stock_at_purchase" INTEGER;
