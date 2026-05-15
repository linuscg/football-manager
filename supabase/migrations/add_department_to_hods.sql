-- Add department, start_date, end_date columns to hods table
ALTER TABLE hods ADD COLUMN IF NOT EXISTS department  text NOT NULL DEFAULT '';
ALTER TABLE hods ADD COLUMN IF NOT EXISTS start_date  date;
ALTER TABLE hods ADD COLUMN IF NOT EXISTS end_date    date;
ALTER TABLE hods ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
ALTER TABLE fulltime_crew ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 5;
