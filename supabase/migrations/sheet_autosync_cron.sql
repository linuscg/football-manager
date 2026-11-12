-- Live Google Sheet sync:
--   • sheet_pending flags crew rows auto-added from the sheet, awaiting the
--     "Allow sync" click in the Crew Tracker
--   • a pg_cron job pulls every linked sheet every 2 minutes and applies
--     changes to sheet-managed rows (crew-sheet-sync action 'auto-sync')
--
-- __ANON_KEY__ / __CRON_SECRET__ are substituted at apply time. This also
-- RE-schedules the off-hire sweep with the same secret, because applying this
-- file rotates CRON_SECRET and the old job body would stop matching it.

alter table resources add column if not exists sheet_pending boolean not null default false;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('crew-sheet-autosync');
exception when others then null;
end $$;

select cron.schedule(
  'crew-sheet-autosync',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://adwpnijxnaorobhfzdrk.supabase.co/functions/v1/crew-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer __ANON_KEY__'
    ),
    body    := jsonb_build_object(
      'action', 'auto-sync',
      'secret', '__CRON_SECRET__'
    )
  );
  $$
);

do $$
begin
  perform cron.unschedule('offhire-reminder-sweep');
exception when others then null;
end $$;

select cron.schedule(
  'offhire-reminder-sweep',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := 'https://adwpnijxnaorobhfzdrk.supabase.co/functions/v1/offhire-reminder',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer __ANON_KEY__'
    ),
    body    := jsonb_build_object(
      'action', 'sweep',
      'secret', '__CRON_SECRET__'
    )
  );
  $$
);

notify pgrst, 'reload schema';
