-- New Starters: "Security Pass" checkbox per starter.
alter table new_starter_status add column if not exists security_pass boolean not null default false;
notify pgrst, 'reload schema';
