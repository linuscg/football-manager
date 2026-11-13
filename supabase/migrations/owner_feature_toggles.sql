-- Owner feature toggles + invite access pre-selection.
--
-- 1. production.feature_flags jsonb — per-production function switches edited
--    on the owner-only "Feature Toggles" settings page. Convention: a feature
--    is ON unless its key is present and false (e.g. {"dealMemoSend": false}).
-- 2. invites.permissions jsonb — access (deniedTabs / deniedModules /
--    denyCrewRates) chosen when the invite is sent; accept_invite() copies it
--    onto the new production_members row so the user lands with the right
--    visibility before they ever sign in.

alter table production add column if not exists feature_flags jsonb not null default '{}';
alter table invites    add column if not exists permissions jsonb;

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
  insert into production_members (production_id, user_id, role, permissions)
  values (inv.production_id, auth.uid(),
          case when inv.role in ('member','admin') then inv.role else 'member' end,
          coalesce(inv.permissions, '{}'::jsonb))
  on conflict (production_id, user_id) do nothing;
  update invites set accepted = true where id = inv.id;
  return jsonb_build_object('ok', true, 'production_id', inv.production_id);
end $$;
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

notify pgrst, 'reload schema';
