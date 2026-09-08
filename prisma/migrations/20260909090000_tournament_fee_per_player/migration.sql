-- Lệ phí / người nhập tay ở Cài đặt giải; 0 = giải cũ, vẫn suy từ tổng chi phí như trước.
ALTER TABLE "tournament" ADD COLUMN "fee_per_player" DECIMAL(14,2) NOT NULL DEFAULT 0;
