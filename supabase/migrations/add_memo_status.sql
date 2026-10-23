-- Deal memo sent/delivered indicators on the New Starters tracker,
-- mirroring the welcome email pair.
alter table public.new_starter_status
  add column if not exists memo_sent boolean not null default false,
  add column if not exists memo_delivered boolean not null default false;
