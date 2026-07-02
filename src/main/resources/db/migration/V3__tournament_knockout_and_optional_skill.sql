ALTER TABLE player ALTER COLUMN skill_level DROP NOT NULL;
ALTER TABLE player ALTER COLUMN skill_level DROP DEFAULT;

ALTER TABLE tournament_registration ALTER COLUMN skill_level DROP NOT NULL;
ALTER TABLE tournament_registration ALTER COLUMN skill_level DROP DEFAULT;

ALTER TABLE tournament
    ADD COLUMN IF NOT EXISTS knockout_qualifier_count INTEGER NOT NULL DEFAULT 4;

ALTER TABLE match_game
    ADD COLUMN IF NOT EXISTS stage VARCHAR(40) NOT NULL DEFAULT 'Vòng tròn';

ALTER TABLE match_game
    ADD COLUMN IF NOT EXISTS group_name VARCHAR(20);
