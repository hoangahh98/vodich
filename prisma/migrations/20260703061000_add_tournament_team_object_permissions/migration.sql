ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "owner_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL;
ALTER TABLE "team_club" ADD COLUMN IF NOT EXISTS "owner_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "tournament_permission" (
  "id" BIGSERIAL PRIMARY KEY,
  "tournament_id" BIGINT NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "admin_id" BIGINT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tournament_permission_tournament_admin_key" UNIQUE ("tournament_id", "admin_id")
);

CREATE TABLE IF NOT EXISTS "team_club_permission" (
  "id" BIGSERIAL PRIMARY KEY,
  "team_id" BIGINT NOT NULL REFERENCES "team_club"("id") ON DELETE CASCADE,
  "admin_id" BIGINT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_club_permission_team_admin_key" UNIQUE ("team_id", "admin_id")
);

CREATE INDEX IF NOT EXISTS "tournament_owner_idx" ON "tournament"("owner_admin_id");
CREATE INDEX IF NOT EXISTS "team_club_owner_idx" ON "team_club"("owner_admin_id");
