-- Day-level cast attendance (used for rehearsal days where cast attend the day
-- rather than specific scenes).
ALTER TABLE shoot_days ADD COLUMN IF NOT EXISTS cast_member_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
