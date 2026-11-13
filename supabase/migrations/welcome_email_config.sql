-- Welcome email template moves from per-browser localStorage into the DB,
-- one row per production, shared by everyone with New Starters access.
create table if not exists welcome_email_config (
  production_id uuid primary key references production(id) on delete cascade,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table welcome_email_config enable row level security;

drop policy if exists "wec_select_member" on welcome_email_config;
create policy "wec_select_member" on welcome_email_config
  for select using (production_id in (select get_my_production_ids()));

drop policy if exists "wec_insert_admin" on welcome_email_config;
create policy "wec_insert_admin" on welcome_email_config
  for insert with check (is_production_admin(production_id));

drop policy if exists "wec_update_admin" on welcome_email_config;
create policy "wec_update_admin" on welcome_email_config
  for update using (is_production_admin(production_id))
  with check (is_production_admin(production_id));

notify pgrst, 'reload schema';
