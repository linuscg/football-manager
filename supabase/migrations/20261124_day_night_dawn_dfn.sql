-- Movie Magic breakdowns use Dawn and DFN (day for night): allow both.
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_day_night_check;
ALTER TABLE scenes
  ADD CONSTRAINT scenes_day_night_check
  CHECK (day_night IN ('DAWN','MORNING','DAY','DUSK','EVENING','NIGHT','DFN'));
notify pgrst, 'reload schema';
