-- Security hardening wave 1: close the tenant-isolation holes found in the
-- 2026-10-22 security audit.

-- ── 1. production_members: no more self-service membership ───────────────────
-- Creator membership comes from the on_production_created trigger (definer);
-- invite acceptance moves into the accept_invite() RPC below. Direct INSERT is
-- for production admins only.
drop policy if exists "production_members_insert_owner" on public.production_members;
drop policy if exists "insert_as_owner" on public.production_members;
drop policy if exists "insert_via_invite" on public.production_members;
create policy "production_members_insert_admin" on public.production_members
  for insert with check (is_production_admin(production_id));

-- ── 2. invites: kill the tautological token policies ─────────────────────────
drop policy if exists "invites_select_token_or_member" on public.invites;
drop policy if exists "invites_update_token" on public.invites;
drop policy if exists "users can accept own invite" on public.invites;
create policy "invites_select_member" on public.invites
  for select using (production_id in (select get_my_production_ids()));
-- (kept: "users can view own invite" select, admin view/insert/delete policies)

-- ── 3. Token-capability RPCs for the accept flow ─────────────────────────────
create or replace function public.get_invite_by_token(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare inv record;
begin
  if auth.uid() is null then return null; end if;
  select i.*, p.name as production_name into inv
  from invites i left join production p on p.id = i.production_id
  where i.token = p_token and i.accepted = false and i.expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object(
    'id', inv.id, 'email', inv.email, 'role', inv.role,
    'production_id', inv.production_id, 'production_name', inv.production_name,
    'expires_at', inv.expires_at);
end $$;

create or replace function public.accept_invite(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare inv record;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated.');
  end if;
  select * into inv from invites
  where token = p_token and accepted = false and expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This invite link is invalid or has already been used.');
  end if;
  if lower(inv.email) <> lower(coalesce(auth.email(), '')) then
    return jsonb_build_object('ok', false, 'error', 'This invite was sent to ' || inv.email || '.');
  end if;
  insert into production_members (production_id, user_id, role)
  values (inv.production_id, auth.uid(),
          case when inv.role in ('member','admin') then inv.role else 'member' end)
  on conflict (production_id, user_id) do nothing;
  update invites set accepted = true where id = inv.id;
  return jsonb_build_object('ok', true, 'production_id', inv.production_id);
end $$;

revoke all on function public.get_invite_by_token(uuid) from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.get_invite_by_token(uuid) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ── 4. profiles.is_owner: API clients can never change it ────────────────────
create or replace function public.protect_profile_is_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_owner := false;
    else
      new.is_owner := old.is_owner;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_is_owner on public.profiles;
create trigger protect_is_owner
  before insert or update on public.profiles
  for each row execute function public.protect_profile_is_owner();

-- ── 5. invite_requests: owners only (any-production owner or app owner) ──────
drop policy if exists "invite_requests_auth_select" on public.invite_requests;
drop policy if exists "invite_requests_auth_delete" on public.invite_requests;
create policy "invite_requests_owner_select" on public.invite_requests
  for select using (
    is_app_owner() or exists (
      select 1 from production_members pm
      where pm.user_id = auth.uid() and pm.role = 'owner'));
create policy "invite_requests_owner_delete" on public.invite_requests
  for delete using (
    is_app_owner() or exists (
      select 1 from production_members pm
      where pm.user_id = auth.uid() and pm.role = 'owner'));
-- (kept: the public INSERT policy — the landing-page request form)

-- ── 6. accom_board: unused table, drop the anon free-for-all ─────────────────
drop policy if exists "accom_board anon select" on public.accom_board;
drop policy if exists "accom_board anon insert" on public.accom_board;
drop policy if exists "accom_board anon update" on public.accom_board;

-- ── 7. production: members can read, only admins can update ──────────────────
drop policy if exists "members can update production" on public.production;
create policy "production_update_admin" on public.production
  for update using (is_production_admin(id));

-- ── 8. Pin search_path on the two RLS helper functions ───────────────────────
alter function public.get_my_production_ids() set search_path = public;
alter function public.is_production_admin(uuid) set search_path = public;

-- ── 9. Trim blanket grants ───────────────────────────────────────────────────
-- TRUNCATE bypasses RLS entirely; REFERENCES/TRIGGER are never needed by the API.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke execute on function public.get_member_emails(uuid) from anon;
revoke execute on function public.handle_new_production() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
