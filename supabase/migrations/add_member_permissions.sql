-- Per-member UI permissions (denial lists + feature flags), managed from
-- Admin → User Management. Empty object = everything visible (default).
ALTER TABLE production_members ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
