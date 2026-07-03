ALTER TABLE "tournament"
  ADD COLUMN "knockout_touch_score" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "knockout_max_score" INTEGER NOT NULL DEFAULT 19;
