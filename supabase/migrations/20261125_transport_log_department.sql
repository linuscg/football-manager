-- Transport log: which department each trip is charged to (per-department totals).
alter table transport_log add column if not exists department text not null default '';
notify pgrst, 'reload schema';
