-- Nhớ số cữ của lần xuất .ics gần nhất.
-- Lần xuất sau ít cữ hơn (bỏ bớt thuốc, rút ngắn liệu trình) thì phần dôi ra phải được
-- gửi lệnh huỷ, nếu không chúng nằm lại trong Lịch iPhone mãi vì không có gì ghi đè lên.
-- Additive, an toàn: chỉ ADD COLUMN kèm DEFAULT.

ALTER TABLE "med_prescription"
  ADD COLUMN "ics_dose_count" INTEGER NOT NULL DEFAULT 0;
