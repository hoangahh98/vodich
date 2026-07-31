-- Module Quản Lý Chi Tiêu: BỎ HẾT rule cũ của bảng tính chiphi.xlsx, thay bằng mô hình
-- "khai thu / khai chi theo loại tự định nghĩa, tiết kiệm dồn qua các tháng, sổ nợ hai chiều".
--
-- Bỏ hẳn: trần chi phí cố định, kiểu chi once/gradual/weekly, mức sinh hoạt tuần, quỹ
-- `reserve` dồn sang quỹ `fun` cuối tháng, bảng "chi phí phát sinh" tách riêng.
--
-- KHÁC với hai lần dựng lại trước: lần này KHÔNG xoá dữ liệu cũ. Mọi dòng chủ sổ đã gõ tay
-- (khoản thu, lần chi, phát sinh, nạp/rút quỹ, gốc & lãi đã trả) đều được chuyển sang mô
-- hình mới; các danh mục cũ (quỹ, khoản cố định) trở thành LOẠI CHI PHÍ tương ứng.
-- Riêng phần trước đây hệ thống TỰ ĐIỀN (mức nạp hàng tháng của quỹ) được ghi thành khoản
-- chi thật, vì mô hình mới không tự điền gì cả — không ghi ra thì số dư tiết kiệm về 0.

-- ─── 1. Bảng mới ───

CREATE TABLE "household_income_category" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'normal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_income_category_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_income_category_household_id_idx" ON "household_income_category"("household_id");
ALTER TABLE "household_income_category"
  ADD CONSTRAINT "household_income_category_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_expense_category" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'normal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_expense_category_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_expense_category_household_id_idx" ON "household_expense_category"("household_id");
ALTER TABLE "household_expense_category"
  ADD CONSTRAINT "household_expense_category_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_expense" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "category_id" BIGINT,
    "month" VARCHAR(7) NOT NULL,
    "occurred_at" DATE NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "principal" BIGINT NOT NULL DEFAULT 0,
    "interest" BIGINT NOT NULL DEFAULT 0,
    "debt_id" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_expense_household_id_month_idx" ON "household_expense"("household_id", "month");
CREATE INDEX "household_expense_category_id_idx" ON "household_expense"("category_id");
CREATE INDEX "household_expense_debt_id_idx" ON "household_expense"("debt_id");
ALTER TABLE "household_expense"
  ADD CONSTRAINT "household_expense_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_expense"
  ADD CONSTRAINT "household_expense_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "household_expense_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "household_chat_message" (
    "id" BIGSERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "role" VARCHAR(9) NOT NULL,
    "content" TEXT NOT NULL,
    "asked_by" VARCHAR(80) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_chat_message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "household_chat_message_household_id_id_idx" ON "household_chat_message"("household_id", "id");
ALTER TABLE "household_chat_message"
  ADD CONSTRAINT "household_chat_message_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "household_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2. Khoản thu: thêm cột của mô hình mới ───
-- `occurred_at` chưa từng có (mô hình cũ chỉ ghi tháng) nên điền tạm ngày mùng 1 của tháng đó.

ALTER TABLE "household_income" ADD COLUMN "category_id" BIGINT;
ALTER TABLE "household_income" ADD COLUMN "occurred_at" DATE;
ALTER TABLE "household_income" ADD COLUMN "principal" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "household_income" ADD COLUMN "interest" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "household_income" ADD COLUMN "debt_id" BIGINT;
UPDATE "household_income" SET "occurred_at" = to_date("month" || '-01', 'YYYY-MM-DD') WHERE "occurred_at" IS NULL;
ALTER TABLE "household_income" ALTER COLUMN "occurred_at" SET NOT NULL;

-- ─── 3. Mỗi "nguồn thu" gõ tay trước đây trở thành một LOẠI THU NHẬP ───

INSERT INTO "household_income_category" ("household_id", "name", "kind", "sort_order")
SELECT DISTINCT ON ("household_id", lower("source")) "household_id", "source", 'normal', 0
FROM "household_income"
WHERE btrim("source") <> ''
ORDER BY "household_id", lower("source"), "id";

UPDATE "household_income" i
SET "category_id" = c."id"
FROM "household_income_category" c
WHERE c."household_id" = i."household_id" AND lower(c."name") = lower(i."source");

ALTER TABLE "household_income" DROP COLUMN "source";

-- ─── 4. Sổ nợ: nợ một chiều → hai chiều, mốc theo tháng → theo ngày ───

ALTER TABLE "household_debt" ADD COLUMN "direction" VARCHAR(4) NOT NULL DEFAULT 'owe';
ALTER TABLE "household_debt" ADD COLUMN "counterparty" VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE "household_debt" ADD COLUMN "start_date" DATE;
ALTER TABLE "household_debt" ADD COLUMN "due_date" DATE;
UPDATE "household_debt" SET "start_date" = to_date("start_month" || '-01', 'YYYY-MM-DD') WHERE "start_date" IS NULL;
ALTER TABLE "household_debt" ALTER COLUMN "start_date" SET NOT NULL;
ALTER TABLE "household_debt" DROP COLUMN "start_month";

-- ─── 5. Quỹ tiết kiệm & chi phí cố định cũ → LOẠI CHI PHÍ ───
-- Hai cột `legacy_*` chỉ sống trong file migration này để nối dòng cũ với loại mới, cuối file xoá đi.

ALTER TABLE "household_expense_category" ADD COLUMN "legacy_fund_id" BIGINT;
ALTER TABLE "household_expense_category" ADD COLUMN "legacy_cost_id" BIGINT;

INSERT INTO "household_expense_category" ("household_id", "name", "kind", "active", "sort_order", "note", "legacy_fund_id")
SELECT "household_id", "name", 'saving', "active", "sort_order", '', "id"
FROM "household_fund";

INSERT INTO "household_expense_category" ("household_id", "name", "kind", "active", "sort_order", "note", "legacy_cost_id")
SELECT "household_id", "name", 'normal', "active", 100 + "sort_order", "note", "id"
FROM "household_fixed_cost";

INSERT INTO "household_expense_category" ("household_id", "name", "kind", "sort_order")
SELECT DISTINCT "household_id", 'Trả nợ', 'debt', 900
FROM "household_debt";

INSERT INTO "household_expense_category" ("household_id", "name", "kind", "sort_order")
SELECT DISTINCT "household_id", 'Chi phí phát sinh', 'normal', 800
FROM "household_extra_cost";

-- Rút tiết kiệm ra tiêu: mô hình mới coi là một LOẠI THU (tiền từ két về ví), không phải thu nhập.
INSERT INTO "household_income_category" ("household_id", "name", "kind", "sort_order")
SELECT DISTINCT "household_id", 'Rút tiết kiệm', 'saving', 900
FROM (
  SELECT "household_id" FROM "household_fund_entry" WHERE "direction" = 'out'
  UNION
  SELECT "household_id" FROM "household_extra_cost" WHERE "source" = 'fund' AND "fund_id" IS NOT NULL
) t;

-- ─── 6. Chuyển từng dòng dữ liệu sang bảng mới ───

-- 6a. Mỗi lần chi cho khoản cố định → một khoản chi của loại tương ứng.
INSERT INTO "household_expense" ("household_id", "category_id", "month", "occurred_at", "amount", "note", "created_at")
SELECT s."household_id", c."id", s."month", s."occurred_at", s."amount", s."note", s."created_at"
FROM "household_fixed_spend" s
JOIN "household_expense_category" c ON c."legacy_cost_id" = s."cost_id";

-- 6b. Chi phí phát sinh → khoản chi. Khai "lấy từ chi phí cố định" thì về đúng loại đó,
--     còn lại gom vào loại "Chi phí phát sinh". Tên khoản gộp vào ghi chú (mô hình mới không
--     có ô tên riêng cho từng dòng).
INSERT INTO "household_expense" ("household_id", "category_id", "month", "occurred_at", "amount", "note", "created_at")
SELECT e."household_id",
       COALESCE(fc."id", pc."id"),
       e."month", e."occurred_at", e."amount",
       CASE WHEN btrim(e."note") = '' THEN e."name" ELSE e."name" || ' · ' || e."note" END,
       e."created_at"
FROM "household_extra_cost" e
LEFT JOIN "household_expense_category" fc ON fc."legacy_cost_id" = e."fixed_cost_id"
LEFT JOIN "household_expense_category" pc
       ON pc."household_id" = e."household_id" AND pc."name" = 'Chi phí phát sinh' AND pc."kind" = 'normal';

-- 6c. Phát sinh khai "lấy từ quỹ tiết kiệm": ngoài khoản chi ở trên còn phải ghi thêm một
--     lần RÚT tiết kiệm, nếu không số dư tiết kiệm sẽ không giảm như mô hình cũ.
INSERT INTO "household_income" ("household_id", "category_id", "month", "occurred_at", "amount", "note", "created_at")
SELECT e."household_id", ic."id", e."month", e."occurred_at", e."amount",
       'Rút quỹ chi cho: ' || e."name", e."created_at"
FROM "household_extra_cost" e
JOIN "household_income_category" ic
  ON ic."household_id" = e."household_id" AND ic."name" = 'Rút tiết kiệm' AND ic."kind" = 'saving'
WHERE e."source" = 'fund' AND e."fund_id" IS NOT NULL;

-- 6d. Nạp thêm quỹ → khoản chi loại tiết kiệm.
INSERT INTO "household_expense" ("household_id", "category_id", "month", "occurred_at", "amount", "note", "created_at")
SELECT fe."household_id", c."id", fe."month", fe."occurred_at", fe."amount", fe."note", fe."created_at"
FROM "household_fund_entry" fe
JOIN "household_expense_category" c ON c."legacy_fund_id" = fe."fund_id"
WHERE fe."direction" = 'in';

-- 6e. Rút quỹ → khoản thu loại "Rút tiết kiệm".
INSERT INTO "household_income" ("household_id", "category_id", "month", "occurred_at", "amount", "note", "created_at")
SELECT fe."household_id", ic."id", fe."month", fe."occurred_at", fe."amount",
       CASE WHEN btrim(fe."note") = '' THEN 'Rút quỹ ' || f."name" ELSE 'Rút quỹ ' || f."name" || ' · ' || fe."note" END,
       fe."created_at"
FROM "household_fund_entry" fe
JOIN "household_fund" f ON f."id" = fe."fund_id"
JOIN "household_income_category" ic
  ON ic."household_id" = fe."household_id" AND ic."name" = 'Rút tiết kiệm' AND ic."kind" = 'saving'
WHERE fe."direction" = 'out';

-- 6f. Mức nạp hàng tháng của quỹ: mô hình cũ TỰ CỘNG mà không có dòng nào trong DB. Mô hình
--     mới không tự điền gì, nên phải ghi ra thành khoản chi thật cho từng tháng từ lúc quỹ
--     bắt đầu tới tháng hiện tại — nếu không, số dư tiết kiệm của chủ sổ về 0 sau khi nâng cấp.
--     Quỹ đang tạm dừng thì dừng ở tháng trước, đúng như quy tắc cũ.
INSERT INTO "household_expense" ("household_id", "category_id", "month", "occurred_at", "amount", "note")
SELECT f."household_id", c."id", to_char(m, 'YYYY-MM'), m::date, f."monthly_amount",
       'Mức nạp hàng tháng của quỹ (chuyển từ mô hình cũ)'
FROM "household_fund" f
JOIN "household_expense_category" c ON c."legacy_fund_id" = f."id"
CROSS JOIN LATERAL generate_series(
    to_date(f."start_month" || '-01', 'YYYY-MM-DD'),
    date_trunc('month', CURRENT_DATE)::date,
    interval '1 month') AS m
WHERE f."monthly_amount" > 0
  AND (f."active" OR m < date_trunc('month', CURRENT_DATE));

-- 6g. Gốc & lãi đã trả → khoản chi loại "Trả nợ", gắn thẳng vào khoản nợ.
INSERT INTO "household_expense" ("household_id", "category_id", "month", "occurred_at", "amount", "principal", "interest", "debt_id", "note", "created_at")
SELECT p."household_id", c."id", p."month",
       to_date(p."month" || '-01', 'YYYY-MM-DD'),
       p."principal" + p."interest", p."principal", p."interest", p."debt_id", p."note", p."created_at"
FROM "household_debt_payment" p
JOIN "household_expense_category" c
  ON c."household_id" = p."household_id" AND c."name" = 'Trả nợ' AND c."kind" = 'debt'
WHERE p."principal" + p."interest" > 0;

-- ─── 7. Dọn mô hình cũ ───

ALTER TABLE "household_expense_category" DROP COLUMN "legacy_fund_id";
ALTER TABLE "household_expense_category" DROP COLUMN "legacy_cost_id";

-- Thứ tự CÓ Ý NGHĨA: bảng CON trước, bảng CHA sau. `household_extra_cost` có khoá ngoại trỏ
-- vào cả `household_fund` lẫn `household_fixed_cost`, nên xoá quỹ trước nó thì Postgres chặn
-- (SQLSTATE 2BP01) và cả migration rollback.
-- Cố ý KHÔNG dùng `DROP ... CASCADE`: cascade sẽ xoá im lặng mọi thứ phụ thuộc, kể cả thứ
-- mình không lường trước. Xoá đúng thứ tự thì thêm một ràng buộc lạ là migration gãy ngay
-- và mình biết, thay vì mất dữ liệu mà không hay.
DROP TABLE IF EXISTS "household_fund_entry";
DROP TABLE IF EXISTS "household_extra_cost";
DROP TABLE IF EXISTS "household_fixed_spend";
DROP TABLE IF EXISTS "household_debt_payment";
DROP TABLE IF EXISTS "household_fund";
DROP TABLE IF EXISTS "household_fixed_cost";

-- Mức sinh hoạt tuần & thứ bắt đầu tuần chỉ phục vụ khoản chi cố định kiểu `weekly` — đã bỏ.
ALTER TABLE "household_config" DROP COLUMN IF EXISTS "weekly_rate";
ALTER TABLE "household_config" DROP COLUMN IF EXISTS "week_start_dow";

-- ─── 8. Khoá ngoại & chỉ mục cho các cột mới của bảng khoản thu ───

CREATE INDEX "household_income_category_id_idx" ON "household_income"("category_id");
CREATE INDEX "household_income_debt_id_idx" ON "household_income"("debt_id");
ALTER TABLE "household_income"
  ADD CONSTRAINT "household_income_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "household_income_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "household_income"
  ADD CONSTRAINT "household_income_debt_id_fkey"
  FOREIGN KEY ("debt_id") REFERENCES "household_debt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "household_expense"
  ADD CONSTRAINT "household_expense_debt_id_fkey"
  FOREIGN KEY ("debt_id") REFERENCES "household_debt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
