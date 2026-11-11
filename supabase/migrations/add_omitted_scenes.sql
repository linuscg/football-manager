-- Scene Order view: scene numbers marked "omitted" from the script (as
-- opposed to genuinely missing from the schedule). Array of strings.
alter table production add column if not exists omitted_scenes jsonb not null default '[]';
notify pgrst, 'reload schema';
