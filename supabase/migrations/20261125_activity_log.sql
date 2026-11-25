-- Activity log: every change to production data, whoever makes it.
--
-- A row-level AFTER trigger on each logged table writes one activity_log row
-- per changed row: who (auth.uid + their name), how (app | assistant |
-- system), what (table, row, op) and the field-level diff. "assistant" means
-- the change came through an OAuth token (Claude / ChatGPT via the fm-mcp
-- server) — those tokens carry a client_id claim; normal app sessions don't.
-- "system" is service-role work (crew sheet sync, cron jobs); an edge
-- function can name itself by sending an x-fm-source header.
--
-- Nested trigger work (cascaded deletes, sync_scene_children) is skipped —
-- the top-level change that caused it is what gets logged.
-- Rate values are never copied into the log (only which fields changed),
-- because log readers may be denied rates.
--
-- Read access: production owners/admins and the app owner. No write
-- policies — only the SECURITY DEFINER trigger function inserts.
-- A logging failure only raises a warning; it never blocks the write.

create table if not exists activity_log (
  id            bigint generated always as identity primary key,
  production_id uuid not null references production(id) on delete cascade,
  at            timestamptz not null default now(),
  actor_id      uuid,
  actor_name    text,
  source        text not null default 'app',   -- app | assistant | system | <x-fm-source>
  client_id     text,
  table_name    text not null,
  row_id        text,
  op            text not null,                 -- insert | update | delete
  label         text,
  changes       jsonb
);
create index if not exists activity_log_prod_id_idx on activity_log (production_id, id desc);

alter table activity_log enable row level security;
drop policy if exists "activity_log_admin_read" on activity_log;
create policy "activity_log_admin_read" on activity_log for select
  using (is_production_admin(production_id) or is_app_owner());

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n      jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o      jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r      jsonb;
  prod   uuid;
  diff   jsonb := '{}'::jsonb;
  k      text;
  skip   text[] := array['created_at', 'updated_at', 'sort_order'];
  hide   boolean := tg_table_name = 'resource_rates';
  claims jsonb;
  hdrs   jsonb;
  src    text;
  uid    uuid := auth.uid();
  who    text;
  lbl    text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_table_name = 'production' and tg_op = 'DELETE' then return null; end if;
  r := coalesce(n, o);

  -- Which production this row belongs to
  if tg_table_name = 'production' then
    prod := (r->>'id')::uuid;
  elsif r->>'production_id' is not null then
    prod := (r->>'production_id')::uuid;
  elsif tg_table_name = 'resource_bookings' then
    select production_id into prod from resources where id = (r->>'resource_id')::uuid;
  elsif r->>'day_id' is not null then
    select production_id into prod from shoot_days where id = (r->>'day_id')::uuid;
  end if;
  if prod is null then return null; end if;

  -- What changed (update) or what the row held (insert/delete)
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      continue when k = any(skip);
      if (n->k) is distinct from (o->k) then
        diff := diff || jsonb_build_object(k,
          case when hide then null else jsonb_build_array(o->k, n->k) end);
      end if;
    end loop;
    if diff = '{}'::jsonb then return null; end if;
  else
    for k in select jsonb_object_keys(r) loop
      continue when k = any(skip || array['id', 'production_id']);
      continue when r->k is null or r->k in ('""'::jsonb, '[]'::jsonb, '{}'::jsonb);
      diff := diff || jsonb_build_object(k, case when hide then null else r->k end);
    end loop;
  end if;

  -- Human label for the row
  if tg_table_name in ('resource_bookings', 'resource_rates', 'timesheet_ot') then
    select name into lbl from resources where id = (r->>'resource_id')::uuid;
  elsif tg_table_name = 'scenes' then
    lbl := 'Sc ' || coalesce(r->>'scene_number', '?');
  elsif tg_table_name = 'shoot_days' then
    lbl := coalesce(nullif(r->>'day_label', ''), 'Day ' || coalesce(r->>'day_number', '?'))
           || coalesce(' (' || (r->>'date') || ')', '');
  elsif tg_table_name = 'production_members' then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into lbl from profiles where id = (r->>'user_id')::uuid;
  elsif tg_table_name = 'accom_nights' then
    select name into lbl from accom_stays where id = (r->>'stay_id')::uuid;
  end if;
  lbl := left(coalesce(lbl,
    nullif(r->>'name', ''), nullif(r->>'sa_name', ''), nullif(r->>'description', ''),
    nullif(r->>'person_name', ''), nullif(r->>'code', '')), 140);

  -- Who, and through what
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then claims := null; end;
  begin hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then hdrs := null; end;

  if claims->>'client_id' is not null then
    src := 'assistant';
  elsif uid is null then
    src := coalesce(nullif(hdrs->>'x-fm-source', ''), 'system');
  else
    src := 'app';
  end if;
  if uid is not null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into who from profiles where id = uid;
    who := coalesce(who, claims->>'email');
  end if;

  insert into activity_log (production_id, actor_id, actor_name, source, client_id,
                            table_name, row_id, op, label, changes)
  values (prod, uid, who, src, claims->>'client_id',
          tg_table_name, coalesce(r->>'id', r->>'resource_id', r->>'production_id'),
          lower(tg_op), lbl, diff);
  return null;
exception when others then
  -- Logging must never block the change itself.
  raise warning 'activity_log skipped (%.%): %', tg_table_name, tg_op, sqlerrm;
  return null;
end $$;

-- Attach to every table that holds production data (skips any that don't exist).
do $$
declare t text;
begin
  foreach t in array array[
    'production', 'production_members',
    'resources', 'resource_rates', 'resource_bookings', 'timesheet_ot', 'new_starter_status',
    'fulltime_crew', 'hods',
    'shoot_days', 'scenes', 'day_extras', 'cast_members',
    'transport_log', 'transport_sheet_rows', 'transport_drivers', 'transport_locations',
    'accom_stays', 'accom_nights', 'hotels', 'hotel_travel_times', 'crew_hotel_assignments',
    'budget_items', 'budget_codes',
    'dpr_day', 'catering_collections',
    'backpage_day_settings', 'backpage_dept_settings', 'backpage_member_overrides'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zz_activity_log on %I', t);
    execute format('create trigger zz_activity_log after insert or update or delete on %I
                    for each row execute function log_activity()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
