-- Crew detail "On/Off Set" dropdown; null means on set (the default).
alter table resources add column if not exists set_status text;
notify pgrst, 'reload schema';
