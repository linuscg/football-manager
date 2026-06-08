-- Manual wrap time for non-shoot days (prep / rehearsal / etc.) where the
-- auto-calculated wrap (call + work hours) doesn't apply.
ALTER TABLE shoot_days ADD COLUMN IF NOT EXISTS wrap_time text;
