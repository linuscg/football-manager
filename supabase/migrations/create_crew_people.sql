-- The crew_people table (cross-production contact database) was referenced by
-- the app since the people-linking feature shipped, but never created — every
-- page load 404'd on it and linking silently no-oped. Create it, plus the
-- resources.person_id link column the app also expects.

create table if not exists public.crew_people (
  id          uuid primary key,
  name        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  notes       text not null default '',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.crew_people enable row level security;

-- Shared contact book: visible/editable to anyone who is a member of at least
-- one production (not the anon role).
create policy "crew_people_member_select" on public.crew_people
  for select using (exists (select 1 from production_members pm where pm.user_id = auth.uid()));
create policy "crew_people_member_insert" on public.crew_people
  for insert with check (exists (select 1 from production_members pm where pm.user_id = auth.uid()));
create policy "crew_people_member_update" on public.crew_people
  for update using (exists (select 1 from production_members pm where pm.user_id = auth.uid()));
create policy "crew_people_member_delete" on public.crew_people
  for delete using (exists (select 1 from production_members pm where pm.user_id = auth.uid()));

revoke truncate, references, trigger on public.crew_people from anon, authenticated;

alter table public.resources
  add column if not exists person_id uuid references public.crew_people(id) on delete set null;
