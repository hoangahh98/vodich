-- Nhóm thành viên: gom sẵn người hay chơi chung để tạo đội bóng / thêm vào giải bằng một cú tích.
CREATE TABLE IF NOT EXISTS "player_group" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "owner_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "player_group_owner_idx" ON "player_group"("owner_admin_id");

CREATE TABLE IF NOT EXISTS "player_group_member" (
  "id" BIGSERIAL PRIMARY KEY,
  "group_id" BIGINT NOT NULL REFERENCES "player_group"("id") ON DELETE CASCADE,
  "player_id" BIGINT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_group_member_group_player_key" UNIQUE ("group_id", "player_id")
);
CREATE INDEX IF NOT EXISTS "player_group_member_player_idx" ON "player_group_member"("player_id");

-- Đội bóng liên kết với nhóm: thêm người vào nhóm là tự vào đội.
CREATE TABLE IF NOT EXISTS "team_club_group" (
  "id" BIGSERIAL PRIMARY KEY,
  "team_id" BIGINT NOT NULL REFERENCES "team_club"("id") ON DELETE CASCADE,
  "group_id" BIGINT NOT NULL REFERENCES "player_group"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_club_group_team_group_key" UNIQUE ("team_id", "group_id")
);
CREATE INDEX IF NOT EXISTS "team_club_group_group_idx" ON "team_club_group"("group_id");
