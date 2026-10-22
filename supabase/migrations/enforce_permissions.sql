-- Server-side enforcement of per-user permissions (previously UI-only).
--
-- 1. Rates: the money columns move off `resources` into `resource_rates`,
--    whose RLS refuses rows to members flagged denyCrewRates — the database
--    withholds the data, not just the UI. Production owners always see rates.
-- 2. Module denials: RESTRICTIVE policies on cleanly-owned tables, driven by
--    the same production_members.permissions jsonb the admin checkboxes write.
--    Shared tables (resources, bookings, schedule, cast) stay membership-only
--    because several modules read them.

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.member_can_see_rates(prod uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select pm.role = 'owner'
        or not coalesce((pm.permissions->>'denyCrewRates')::boolean, false)
    from production_members pm
    where pm.production_id = prod and pm.user_id = auth.uid()
  ), false)
$$;

-- Tab/module access: owner bypasses; otherwise denied when the tab (or, when
-- given, the module) appears in the member's denial lists. Non-members: false.
create or replace function public.member_can_access(prod uuid, tab text, module text default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select pm.role = 'owner'
        or ( not coalesce(pm.permissions->'deniedTabs' ? tab, false)
         and (module is null or not coalesce(pm.permissions->'deniedModules' ? module, false)) )
    from production_members pm
    where pm.production_id = prod and pm.user_id = auth.uid()
  ), false)
$$;

revoke all on function public.member_can_see_rates(uuid) from public;
revoke all on function public.member_can_access(uuid, text, text) from public;
grant execute on function public.member_can_see_rates(uuid) to authenticated, anon;
grant execute on function public.member_can_access(uuid, text, text) to authenticated, anon;

-- ── 1. resource_rates ────────────────────────────────────────────────────────

create table if not exists public.resource_rates (
  resource_id      uuid primary key references public.resources(id) on delete cascade,
  production_id    uuid not null references public.production(id) on delete cascade,
  cost_amount      numeric,
  cost_type        text,
  week_type        text,
  ot_rate          numeric,
  sixth_day_rate   numeric,
  seventh_day_rate numeric,
  box_pw           numeric,
  car_allowance    numeric
);

insert into public.resource_rates
  (resource_id, production_id, cost_amount, cost_type, week_type,
   ot_rate, sixth_day_rate, seventh_day_rate, box_pw, car_allowance)
select id, production_id, cost_amount, cost_type, week_type,
       ot_rate, sixth_day_rate, seventh_day_rate, box_pw, car_allowance
from public.resources
on conflict (resource_id) do nothing;

alter table public.resource_rates enable row level security;

create policy "resource_rates_select" on public.resource_rates
  for select using (
    production_id in (select get_my_production_ids())
    and member_can_see_rates(production_id));
create policy "resource_rates_insert" on public.resource_rates
  for insert with check (
    production_id in (select get_my_production_ids())
    and member_can_see_rates(production_id));
create policy "resource_rates_update" on public.resource_rates
  for update using (
    production_id in (select get_my_production_ids())
    and member_can_see_rates(production_id));
create policy "resource_rates_delete" on public.resource_rates
  for delete using (
    production_id in (select get_my_production_ids())
    and member_can_see_rates(production_id));

revoke truncate, references, trigger on public.resource_rates from anon, authenticated;

-- The columns must leave `resources`, or any member could still read them.
alter table public.resources
  drop column if exists cost_amount,
  drop column if exists cost_type,
  drop column if exists week_type,
  drop column if exists ot_rate,
  drop column if exists sixth_day_rate,
  drop column if exists seventh_day_rate,
  drop column if exists box_pw,
  drop column if exists car_allowance;

-- ── 2. Module-denial restrictive policies ────────────────────────────────────
-- RESTRICTIVE policies AND with the existing permissive membership policies.

create policy "deny_module_budget_items" on public.budget_items
  as restrictive using (member_can_access(production_id, 'fm', 'budget'));
create policy "deny_module_budget_codes" on public.budget_codes
  as restrictive using (member_can_access(production_id, 'fm', 'budget'));
create policy "deny_module_timesheet_ot" on public.timesheet_ot
  as restrictive using (member_can_access(production_id, 'crew-times', 'ct-timesheets'));
create policy "deny_module_backpage_day" on public.backpage_day_settings
  as restrictive using (member_can_access(production_id, 'crew-times', 'ct-backpage'));
create policy "deny_module_backpage_dept" on public.backpage_dept_settings
  as restrictive using (member_can_access(production_id, 'crew-times', 'ct-backpage'));
create policy "deny_module_backpage_overrides" on public.backpage_member_overrides
  as restrictive using (member_can_access(production_id, 'crew-times', 'ct-backpage'));
create policy "deny_module_new_starters" on public.new_starter_status
  as restrictive using (member_can_access(production_id, 'crew-times', 'ct-starters'));
create policy "deny_tab_catering" on public.catering_collections
  as restrictive using (member_can_access(production_id, 'catering'));
create policy "deny_tab_accomm_hotels" on public.hotels
  as restrictive using (member_can_access(production_id, 'accomm'));
create policy "deny_tab_accomm_assignments" on public.crew_hotel_assignments
  as restrictive using (member_can_access(production_id, 'accomm'));
create policy "deny_tab_accomm_stays" on public.accom_stays
  as restrictive using (member_can_access(production_id, 'accomm'));
create policy "deny_tab_accomm_nights" on public.accom_nights
  as restrictive using (member_can_access(production_id, 'accomm'));
create policy "deny_tab_accomm_travel" on public.hotel_travel_times
  as restrictive using (member_can_access(production_id, 'accomm'));
create policy "deny_tab_dpr" on public.dpr_day
  as restrictive using (member_can_access(production_id, 'dpr'));

notify pgrst, 'reload schema';
