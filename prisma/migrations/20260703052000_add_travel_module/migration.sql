CREATE TABLE IF NOT EXISTS "travel_destination" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL UNIQUE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "travel_suggestion" (
  "id" BIGSERIAL PRIMARY KEY,
  "destination_id" BIGINT NOT NULL REFERENCES "travel_destination"("id") ON DELETE CASCADE,
  "category" VARCHAR(80) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "address" TEXT NOT NULL DEFAULT '',
  "phone" VARCHAR(80) NOT NULL DEFAULT '',
  "opening_hours" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "map_url" TEXT NOT NULL DEFAULT '',
  "source_url" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "travel_suggestion_destination_category_name_key" UNIQUE ("destination_id", "category", "name")
);

CREATE TABLE IF NOT EXISTS "travel_person" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) NOT NULL DEFAULT '',
  "player_id" BIGINT REFERENCES "player"("id") ON DELETE SET NULL,
  "owner_admin_id" BIGINT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "travel_trip" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "owner_admin_id" BIGINT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "destination_id" BIGINT REFERENCES "travel_destination"("id") ON DELETE SET NULL,
  "treasurer_member_id" BIGINT UNIQUE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "travel_trip_permission" (
  "id" BIGSERIAL PRIMARY KEY,
  "trip_id" BIGINT NOT NULL REFERENCES "travel_trip"("id") ON DELETE CASCADE,
  "admin_id" BIGINT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "travel_trip_permission_trip_admin_key" UNIQUE ("trip_id", "admin_id")
);

CREATE TABLE IF NOT EXISTS "travel_trip_member" (
  "id" BIGSERIAL PRIMARY KEY,
  "trip_id" BIGINT NOT NULL REFERENCES "travel_trip"("id") ON DELETE CASCADE,
  "person_id" BIGINT REFERENCES "travel_person"("id") ON DELETE SET NULL,
  "player_id" BIGINT REFERENCES "player"("id") ON DELETE SET NULL,
  "name" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'travel_trip_treasurer_member_id_fkey'
      AND table_name = 'travel_trip'
  ) THEN
    ALTER TABLE "travel_trip"
      ADD CONSTRAINT "travel_trip_treasurer_member_id_fkey"
      FOREIGN KEY ("treasurer_member_id") REFERENCES "travel_trip_member"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "travel_trip_collection" (
  "id" BIGSERIAL PRIMARY KEY,
  "trip_id" BIGINT NOT NULL REFERENCES "travel_trip"("id") ON DELETE CASCADE,
  "member_id" BIGINT NOT NULL REFERENCES "travel_trip_member"("id") ON DELETE CASCADE,
  "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "travel_trip_collection_trip_member_key" UNIQUE ("trip_id", "member_id")
);

CREATE TABLE IF NOT EXISTS "travel_trip_expense" (
  "id" BIGSERIAL PRIMARY KEY,
  "trip_id" BIGINT NOT NULL REFERENCES "travel_trip"("id") ON DELETE CASCADE,
  "spent_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "title" VARCHAR(255) NOT NULL,
  "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "split_mode" VARCHAR(20) NOT NULL DEFAULT 'SHARED',
  "private_member_id" BIGINT REFERENCES "travel_trip_member"("id") ON DELETE SET NULL,
  "paid_by_member_id" BIGINT REFERENCES "travel_trip_member"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "travel_trip_expense_split" (
  "id" BIGSERIAL PRIMARY KEY,
  "expense_id" BIGINT NOT NULL REFERENCES "travel_trip_expense"("id") ON DELETE CASCADE,
  "member_id" BIGINT NOT NULL REFERENCES "travel_trip_member"("id") ON DELETE CASCADE,
  "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  CONSTRAINT "travel_trip_expense_split_expense_member_key" UNIQUE ("expense_id", "member_id")
);

CREATE INDEX IF NOT EXISTS "travel_trip_owner_idx" ON "travel_trip"("owner_admin_id");
CREATE INDEX IF NOT EXISTS "travel_trip_member_trip_idx" ON "travel_trip_member"("trip_id");
CREATE INDEX IF NOT EXISTS "travel_trip_expense_trip_idx" ON "travel_trip_expense"("trip_id");
CREATE INDEX IF NOT EXISTS "travel_trip_expense_split_member_idx" ON "travel_trip_expense_split"("member_id");
