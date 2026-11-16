-- Transport module: trip log, per-day transport sheets, driver + location
-- databases. Membership-scoped RLS plus a restrictive per-user policy on the
-- new 'transport' tab (permissions registry id must match App.jsx).

create table if not exists transport_log (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references production(id) on delete cascade,
  type          text not null default 'Cab',
  date          date,
  time          text not null default '',
  description   text not null default '',
  from_location text not null default '',
  to_location   text not null default '',
  driver        text not null default '',
  supplier      text not null default '',
  po            text not null default '',
  cost          numeric,
  sort_order    bigint not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists transport_drivers (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references production(id) on delete cascade,
  name          text not null default '',
  phone         text not null default '',
  vehicle_reg   text not null default '',
  company       text not null default '',
  notes         text not null default '',
  sort_order    bigint not null default 0
);

create table if not exists transport_locations (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references production(id) on delete cascade,
  name          text not null default '',
  notes         text not null default ''
);

create table if not exists transport_sheet_rows (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references production(id) on delete cascade,
  date          date not null,
  section       text not null default 'pickups',   -- crew | pickups | returns | own
  time          text not null default '',
  description   text not null default '',
  from_location text not null default '',
  to_location   text not null default '',
  driver_contact text not null default '',
  sort_order    bigint not null default 0
);
create index if not exists transport_sheet_rows_day_idx on transport_sheet_rows (production_id, date);
create index if not exists transport_log_prod_idx on transport_log (production_id, date);

do $$
declare t text;
begin
  foreach t in array array['transport_log', 'transport_drivers', 'transport_locations', 'transport_sheet_rows'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s_member_all" on %I', t, t);
    execute format(
      'create policy "%s_member_all" on %I for all
         using (production_id in (select get_my_production_ids()))
         with check (production_id in (select get_my_production_ids()))', t, t);
    execute format('drop policy if exists "%s_tab_gate" on %I', t, t);
    execute format(
      'create policy "%s_tab_gate" on %I as restrictive
         using (member_can_access(production_id, ''transport''))', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
