-- Cài đặt hiển thị cho loại nguồn tiền của từng hộ (chủ app 21/9/2026).
--
-- Hộ bật/tắt loại mình dùng và đặt lại tên cho dễ hiểu. KHÔNG tạo được loại mới: mỗi `kind` gắn một
-- luật tính tiền viết sẵn trong code (tài khoản/tiền mặt giữ số dư, thẻ/khoản vay giữ dư nợ, cho vay
-- là người ta nợ mình...), nên đây chỉ là nhãn và cờ ẩn/hiện.
--
-- Thiếu dòng cho một loại = loại đó vẫn bật, dùng nhãn mặc định. Vì vậy KHÔNG cần chèn sẵn 7 dòng
-- cho mọi hộ đang có — hộ nào vào Cài đặt sửa thì lúc ấy mới sinh dòng.

CREATE TABLE IF NOT EXISTS "household_source_kind" (
  "id"           BIGSERIAL PRIMARY KEY,
  "household_id" BIGINT       NOT NULL,
  "kind"         VARCHAR(10)  NOT NULL,
  "label"        VARCHAR(60)  NOT NULL DEFAULT '',
  "active"       BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"   INTEGER      NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_source_kind_household_id_fkey"
    FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE
);

-- Mỗi hộ mỗi loại đúng một dòng.
CREATE UNIQUE INDEX IF NOT EXISTS "household_source_kind_household_id_kind_key"
  ON "household_source_kind"("household_id", "kind");
