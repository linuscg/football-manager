-- Add department column to hods table
ALTER TABLE hods ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
