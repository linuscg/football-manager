-- Extend scene day_night from DAY/NIGHT to the full set used on one-line schedules.
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_day_night_check;
ALTER TABLE scenes
  ADD CONSTRAINT scenes_day_night_check
  CHECK (day_night IN ('MORNING','DAY','DUSK','EVENING','NIGHT'));
