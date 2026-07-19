-- Ghi nhớ đơn GỐC của thuốc được chuyển sang đơn mới.
-- NULL = thuốc mới kê trong chính đơn đang chứa nó.
--
-- Cố ý KHÔNG đặt khoá ngoại: xoá đơn cũ thì thuốc đã chuyển vẫn phải sống tiếp ở đơn mới.
ALTER TABLE "med_prescription_item" ADD COLUMN "carried_from_id" BIGINT;
