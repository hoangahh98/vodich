-- Lưu tiến trình theo từng con quái trong ải (chơi tiếp đúng chỗ). Additive, an toàn.
ALTER TABLE "knight_character" ADD COLUMN "mob_index" INTEGER NOT NULL DEFAULT 0;
