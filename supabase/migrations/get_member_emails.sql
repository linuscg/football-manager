-- Expose production members' auth emails to that production's owners/admins
-- (profiles has no email; auth.users is unreadable from the client).
create or replace function public.get_member_emails(prod_id uuid)
returns table(user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  join public.production_members pm
    on pm.user_id = u.id and pm.production_id = prod_id
  where exists (
    select 1 from public.production_members me
    where me.production_id = prod_id
      and me.user_id = auth.uid()
      and me.role in ('owner', 'admin')
  )
$$;

revoke all on function public.get_member_emails(uuid) from public, anon;
grant execute on function public.get_member_emails(uuid) to authenticated;
