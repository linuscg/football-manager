-- Owner Admin: app-owner-only cross-production user/project management.

alter table public.production
  add column if not exists disabled boolean not null default false;

-- True when the caller's profile is flagged as app owner.
create or replace function public.is_app_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false)
$$;

-- Full dataset for the Owner Admin page.
create or replace function public.owner_admin_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Owner only';
  end if;

  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'is_owner', coalesce(p.is_owner, false),
        'last_sign_in_at', u.last_sign_in_at,
        'created_at', u.created_at
      ) order by u.created_at)
      from auth.users u
      left join public.profiles p on p.id = u.id
    ), '[]'::jsonb),
    'productions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'disabled', pr.disabled
      ) order by pr.created_at)
      from public.production pr
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', pm.user_id, 'production_id', pm.production_id, 'role', pm.role
      ))
      from public.production_members pm
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'production_id', i.production_id,
        'role', i.role, 'expires_at', i.expires_at, 'created_at', i.created_at
      ) order by i.created_at desc)
      from public.invites i
      where i.accepted = false
    ), '[]'::jsonb)
  );
end;
$$;

-- Assign a user to a production (or change their role).
create or replace function public.owner_admin_set_member(p_user uuid, p_prod uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then raise exception 'Owner only'; end if;
  if p_role not in ('owner', 'admin', 'member') then raise exception 'Invalid role'; end if;
  insert into public.production_members (production_id, user_id, role)
  values (p_prod, p_user, p_role)
  on conflict (production_id, user_id) do update set role = excluded.role;
end;
$$;

-- Remove a user from a production.
create or replace function public.owner_admin_remove_member(p_user uuid, p_prod uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then raise exception 'Owner only'; end if;
  delete from public.production_members where user_id = p_user and production_id = p_prod;
end;
$$;

-- Enable/disable a production.
create or replace function public.owner_admin_set_production_disabled(p_prod uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then raise exception 'Owner only'; end if;
  update public.production set disabled = p_disabled where id = p_prod;
end;
$$;

-- Revoke a pending invite.
create or replace function public.owner_admin_delete_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then raise exception 'Owner only'; end if;
  delete from public.invites where id = p_invite and accepted = false;
end;
$$;

revoke all on function public.is_app_owner() from public, anon;
revoke all on function public.owner_admin_data() from public, anon;
revoke all on function public.owner_admin_set_member(uuid, uuid, text) from public, anon;
revoke all on function public.owner_admin_remove_member(uuid, uuid) from public, anon;
revoke all on function public.owner_admin_set_production_disabled(uuid, boolean) from public, anon;
revoke all on function public.owner_admin_delete_invite(uuid) from public, anon;
grant execute on function public.is_app_owner() to authenticated;
grant execute on function public.owner_admin_data() to authenticated;
grant execute on function public.owner_admin_set_member(uuid, uuid, text) to authenticated;
grant execute on function public.owner_admin_remove_member(uuid, uuid) to authenticated;
grant execute on function public.owner_admin_set_production_disabled(uuid, boolean) to authenticated;
grant execute on function public.owner_admin_delete_invite(uuid) to authenticated;
