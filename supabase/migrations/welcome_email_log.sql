-- Welcome email history: every send (incl. tests) logged server-side by the
-- send-welcome-email function; the resend-webhook marks rows delivered.
create table if not exists welcome_email_log (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references production(id) on delete cascade,
  sent_by       uuid,
  sent_by_email text not null default '',
  person_name   text not null default '',
  recipient     text not null default '',
  subject       text not null default '',
  is_test       boolean not null default false,
  resend_id     text,
  delivered     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists welcome_email_log_prod_idx on welcome_email_log (production_id, created_at desc);
alter table welcome_email_log enable row level security;

-- Members can read their production's history; writes happen only via the
-- service role inside edge functions (no client insert/update policies).
drop policy if exists "wel_select_member" on welcome_email_log;
create policy "wel_select_member" on welcome_email_log
  for select using (production_id in (select get_my_production_ids()));

notify pgrst, 'reload schema';
