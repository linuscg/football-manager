-- Add a free-text notes column to cast members (e.g. "Knock 2nd Cast / Hungarian").
ALTER TABLE cast_members ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
