-- Equipment off-hire reminders: who (if anyone) wants reminder emails for a
-- machine, plus a daily pg_cron sweep that invokes the offhire-reminder edge
-- function (one email per recipient covering every machine off-hiring
-- tomorrow or in exactly one week).
--
-- __ANON_KEY__ / __CRON_SECRET__ are substituted at apply time (see the apply
-- command in the repo docs): the anon key satisfies the edge function's JWT
-- gate, and CRON_SECRET (also set as an edge-function secret) authorises the
-- sweep action itself.

alter table resources add column if not exists offhire_reminder_email text;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-schedule idempotently (unschedule if it already exists).
do $$
begin
  perform cron.unschedule('offhire-reminder-sweep');
exception when others then null;
end $$;

-- 07:00 UTC daily.
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
