-- 1) Quyền XEM của thành viên: một thành viên chỉ thấy giải/đội đã được cấp quyền ở màn hình
--    Thành viên. Trước đây "đang đăng ký giải" = "được xem giải", nay tách thành bảng riêng để
--    admin chủ động cấp/thu hồi, và để cấp quyền xem cho người không thi đấu (ví dụ người nhà).
CREATE TABLE IF NOT EXISTS "player_tournament_access" (
  "id" BIGSERIAL PRIMARY KEY,
  "player_id" BIGINT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "tournament_id" BIGINT NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "granted_by_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_tournament_access_player_tournament_key" UNIQUE ("player_id", "tournament_id")
);
CREATE INDEX IF NOT EXISTS "player_tournament_access_tournament_idx" ON "player_tournament_access"("tournament_id");

CREATE TABLE IF NOT EXISTS "player_team_access" (
  "id" BIGSERIAL PRIMARY KEY,
  "player_id" BIGINT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "team_id" BIGINT NOT NULL REFERENCES "team_club"("id") ON DELETE CASCADE,
  "granted_by_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_team_access_player_team_key" UNIQUE ("player_id", "team_id")
);
CREATE INDEX IF NOT EXISTS "player_team_access_team_idx" ON "player_team_access"("team_id");

-- 2) Không ai mất quyền xem ngay lúc deploy: ai đang có tên trong giải (chính thức/dự bị) hay
--    đang là thành viên đội thì được cấp sẵn. Từ đây về sau admin thêm/bớt trên màn hình Thành viên.
INSERT INTO "player_tournament_access" ("player_id", "tournament_id")
SELECT DISTINCT "player_id", "tournament_id"
FROM "tournament_registration"
WHERE "player_id" IS NOT NULL AND "status" IN ('ACTIVE', 'RESERVE')
ON CONFLICT DO NOTHING;

INSERT INTO "player_team_access" ("player_id", "team_id")
SELECT "player_id", "team_id"
FROM "team_member"
WHERE "active" = TRUE
ON CONFLICT DO NOTHING;
