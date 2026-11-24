-- Where an Additional Info row came from: 'breakdown' = Movie Magic breakdown
-- upload (replaced on re-upload); null = typed by hand (never touched by imports).
-- Kept separate from link_key, which links Supporting Artist rows into groups.
alter table day_extras add column if not exists source text;
notify pgrst, 'reload schema';
